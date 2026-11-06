---
layout: post
title:  "111. PostgreSQL Index (B-tree & EXPLAIN)."
date:   2026-10-03 02:00:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_111/postgres-index-btree.png
---
Trang "Đơn hàng của tôi" mất 2 giây để load. Thêm một dòng <mark>add_index :orders, :user_id</mark>, còn 2 mili giây. Index là thứ mang lại hiệu quả lớn nhất với công sức ít nhất khi tối ưu database, nhưng cũng rất dễ dùng sai: thêm index mà query vẫn chậm, hoặc thêm quá nhiều làm ghi chậm đi. Series này gồm 3 bài: index B-tree và cách đọc <mark>EXPLAIN</mark>, các loại index khác, và tối ưu những query hay gặp.

Version sử dụng: PostgreSQL 17, Rails 8. Mọi số liệu trong bài là chạy thật trên máy tôi (Apple M-series), với dữ liệu mẫu bên dưới.

#### Dữ liệu mẫu
Để làm theo, tạo 2 bảng và sinh 100.000 user, 2 triệu đơn hàng
```sql
CREATE TABLE users (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE orders (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL,
  status text NOT NULL,
  total bigint NOT NULL,
  created_at timestamptz NOT NULL
);

INSERT INTO users (email, name, created_at)
SELECT 'user' || g || '@example.com', 'User ' || g, now() - (random() * 730) * interval '1 day'
FROM generate_series(1, 100000) g;

INSERT INTO orders (user_id, status, total, created_at)
SELECT (random() * 99999)::int + 1,
       CASE WHEN r < 0.02 THEN 'pending' WHEN r < 0.05 THEN 'paid'
            WHEN r < 0.08 THEN 'cancelled' ELSE 'shipped' END,
       ((random() * 5000)::int + 1) * 1000,
       now() - (random() * 730) * interval '1 day'
FROM (SELECT random() r FROM generate_series(1, 2000000)) t;

VACUUM ANALYZE users;
VACUUM ANALYZE orders;
```
Bảng <mark>orders</mark> khoảng 200MB, 92% đơn ở trạng thái <mark>shipped</mark>, 2% <mark>pending</mark>. <mark>VACUUM ANALYZE</mark> ở cuối để PostgreSQL thu thập thống kê về dữ liệu, planner cần thống kê này để chọn cách chạy query.

#### Không có index thì sao
Lấy đơn hàng của một user
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 12345;
```
```
Gather  (cost=1000.00..29175.77 rows=21 width=79) (actual time=3.474..48.383 rows=16 loops=1)
  Workers Planned: 2
  Workers Launched: 2
  ->  Parallel Seq Scan on orders  (cost=0.00..28173.67 rows=9 width=79) (actual time=3.920..41.703 rows=5 loops=3)
        Filter: (user_id = 12345)
        Rows Removed by Filter: 666661
Planning Time: 0.298 ms
Execution Time: 48.439 ms
```
<mark>Seq Scan</mark> (sequential scan): đọc **toàn bộ** 2 triệu dòng, kiểm tra từng dòng, bỏ đi 1.999.984 dòng để giữ lại 16. Mất 48ms. Dữ liệu càng lớn càng chậm, và trong lúc đó nó chiếm CPU và RAM của database, làm mọi query khác chậm theo.

#### Index B-tree
Index là một cấu trúc dữ liệu **riêng**, nằm cạnh bảng, được **sắp xếp sẵn** theo cột đã chọn. Loại mặc định là **B-tree**: một cây cân bằng, lá là các giá trị đã sắp xếp kèm địa chỉ dòng tương ứng trong bảng. Tìm một giá trị chỉ cần đi từ gốc xuống lá, vài bước là tới, giống tra từ điển thay vì đọc từ trang đầu.
```sql
CREATE INDEX orders_user_id_idx ON orders (user_id);
-- Time: 439 ms

EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 12345;
```
```
Bitmap Heap Scan on orders  (cost=4.59..86.69 rows=21 width=79) (actual time=0.033..0.078 rows=16 loops=1)
  Recheck Cond: (user_id = 12345)
  Heap Blocks: exact=16
  ->  Bitmap Index Scan on orders_user_id_idx  (cost=0.00..4.58 rows=21 width=0) (actual time=0.024..0.024 rows=16 loops=1)
        Index Cond: (user_id = 12345)
Planning Time: 0.163 ms
Execution Time: 0.108 ms
```
Từ 48ms xuống **0.1ms**, nhanh hơn 450 lần. Trong Rails
```ruby
# db/migrate/xxx_add_user_id_index_to_orders.rb

class AddUserIdIndexToOrders < ActiveRecord::Migration[8.0]
  def change
    add_index :orders, :user_id
  end
end
```
Trường hợp hay quên nhất: <mark>belongs_to</mark> mà không có index. <mark>t.references</mark> trong migration tự thêm index, nhưng <mark>t.bigint :user_id</mark> thì không.

#### Đọc EXPLAIN
<mark>EXPLAIN</mark> cho biết planner **định** chạy query như thế nào. <mark>EXPLAIN ANALYZE</mark> chạy thật và cho biết **thực tế** ra sao. Đọc từ **trong ra ngoài** (node thụt vào sâu nhất chạy trước), mỗi node có:

| Phần | Ý nghĩa |
|---|---|
| <mark>cost=4.59..86.69</mark> | Chi phí **ước lượng**: để lấy dòng đầu tiên..tất cả các dòng. Đơn vị tương đối, không phải ms. Dùng để so sánh các cách chạy với nhau |
| <mark>rows=21</mark> (ước lượng) | Planner **đoán** có bao nhiêu dòng |
| <mark>actual time=0.033..0.078</mark> | Thời gian thật (ms), dòng đầu..dòng cuối |
| <mark>rows=16</mark> (thực tế) | Số dòng thật. Nếu lệch xa với ước lượng (gấp 10 lần trở lên) thì thống kê đã cũ, chạy <mark>ANALYZE orders</mark> |
| <mark>loops=3</mark> | Node chạy mấy lần. Thời gian và rows là **trung bình mỗi lần** |

Vài node hay gặp:

| Node | Ý nghĩa |
|---|---|
| <mark>Seq Scan</mark> | Đọc cả bảng. Chậm với bảng lớn, nhưng là lựa chọn đúng với bảng nhỏ hoặc khi cần phần lớn dữ liệu |
| <mark>Index Scan</mark> | Đi theo index, với mỗi kết quả nhảy vào bảng lấy dòng đầy đủ |
| <mark>Bitmap Index Scan</mark> + <mark>Bitmap Heap Scan</mark> | Đi theo index gom danh sách địa chỉ trước, rồi vào bảng đọc theo thứ tự vật lý. Dùng khi kết quả vừa phải |
| <mark>Index Only Scan</mark> | Mọi cột cần lấy đều có trong index, không cần vào bảng. Nhanh nhất |
| <mark>Sort</mark> | Sắp xếp trong bộ nhớ (hoặc trên đĩa nếu quá lớn). Dấu hiệu nên có index theo cột <mark>ORDER BY</mark> |
| <mark>Nested Loop</mark>, <mark>Hash Join</mark>, <mark>Merge Join</mark> | Các cách join, bài 113 |

Trong Rails console có thể xem plan trực tiếp
```ruby
Order.where(user_id: 12345).explain(:analyze)
```

#### Có index mà không dùng
Thêm index cho <mark>status</mark> rồi tìm đơn <mark>shipped</mark>
```sql
CREATE INDEX orders_status_idx ON orders (status);

EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'shipped';
```
```
Seq Scan on orders  (cost=0.00..42757.00 rows=1838867 width=79) (actual time=0.011..145.243 rows=1839279 loops=1)
  Filter: (status = 'shipped'::text)
  Rows Removed by Filter: 160721
Execution Time: 188.405 ms
```
Planner **bỏ qua index** và đọc cả bảng. Không phải lỗi: 92% dòng là <mark>shipped</mark>, đi theo index rồi nhảy vào bảng 1.8 triệu lần còn chậm hơn đọc thẳng cả bảng một lượt. Cùng index đó với <mark>status = 'pending'</mark> (2%) thì được dùng.

Index chỉ có ích khi điều kiện **lọc được nhiều**, gọi là độ chọn lọc (selectivity). Cột chỉ có vài giá trị, phân bố lệch (status, boolean, giới tính) thường không đáng đánh index một mình.

#### Index nhiều cột
Màn hình "Đơn hàng của tôi" lấy đơn **mới nhất** của user
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE user_id = 12345 ORDER BY created_at DESC LIMIT 10;
```
```
Limit  (actual time=0.074..0.075 rows=10 loops=1)
  ->  Sort  (actual time=0.073..0.073 rows=10 loops=1)
        Sort Key: created_at DESC
        Sort Method: quicksort  Memory: 26kB
        ->  Bitmap Heap Scan on orders  (actual time=0.026..0.064 rows=16 loops=1)
              Recheck Cond: (user_id = 12345)
              ->  Bitmap Index Scan on orders_user_id_idx  (actual rows=16 loops=1)
```
Dùng index để lấy 16 đơn, rồi phải **Sort**. 16 dòng thì không sao, nhưng với user có 50.000 đơn (tài khoản doanh nghiệp) thì bước sort tốn kém. Index trên cả 2 cột, đúng thứ tự cần
```sql
CREATE INDEX orders_user_id_created_at_idx ON orders (user_id, created_at DESC);
```
```
Limit  (actual time=0.092..0.109 rows=10 loops=1)
  ->  Index Scan using orders_user_id_created_at_idx on orders  (actual time=0.091..0.108 rows=10 loops=1)
        Index Cond: (user_id = 12345)
```
Không còn Sort: index đã sắp sẵn theo <mark>user_id</mark>, trong mỗi <mark>user_id</mark> sắp theo <mark>created_at</mark> giảm dần, nên chỉ cần đọc 10 dòng đầu rồi dừng.
```ruby
add_index :orders, [:user_id, :created_at], order: { created_at: :desc }
```
**Thứ tự cột rất quan trọng.** Index <mark>(user_id, created_at)</mark> giống danh bạ sắp theo họ rồi tới tên: tìm theo họ thì nhanh, tìm theo họ và tên càng nhanh, nhưng tìm theo **tên** thì vô dụng. Query chỉ lọc <mark>created_at</mark> không dùng được index này
```sql
EXPLAIN ANALYZE SELECT count(*) FROM orders WHERE created_at > now() - interval '1 day';
```
```
Parallel Seq Scan on orders  (actual time=0.159..82.907 rows=898 loops=3)
  Filter: (created_at > (now() - '1 day'::interval))
```
Quy tắc đặt thứ tự: cột lọc bằng **dấu bằng** đứng trước, cột lọc theo **khoảng** hoặc **sắp xếp** đứng sau.

Có index <mark>(user_id, created_at)</mark> rồi thì index <mark>(user_id)</mark> riêng không cần nữa, xóa đi cho đỡ tốn.

#### Partial index
Màn hình admin "Đơn chờ xử lý" chỉ quan tâm 2% đơn <mark>pending</mark>. Thay vì index cả 2 triệu dòng, chỉ index những dòng cần
```sql
CREATE INDEX orders_pending_idx ON orders (created_at) WHERE status = 'pending';
```
```
partial_size | full_size
-------------+----------
904 kB       | 15 MB
```
Nhỏ hơn 17 lần, ghi nhanh hơn (đơn <mark>shipped</mark> không cần cập nhật index này), và query đúng điều kiện thì dùng được ngay
```sql
EXPLAIN ANALYZE SELECT * FROM orders WHERE status = 'pending' ORDER BY created_at LIMIT 20;
```
```
Limit  (actual time=0.020..0.062 rows=20 loops=1)
  ->  Index Scan using orders_pending_idx on orders  (actual time=0.019..0.060 rows=20 loops=1)
```
```ruby
add_index :orders, :created_at, where: "status = 'pending'", name: "orders_pending_idx"
```
Điều kiện trong query phải **khớp** với điều kiện của index. <mark>WHERE status IN ('pending', 'paid')</mark> sẽ không dùng được index này.

#### Covering index
Nếu query chỉ cần vài cột và tất cả đều nằm trong index, PostgreSQL không cần vào bảng
```sql
CREATE INDEX orders_user_id_total_idx ON orders (user_id) INCLUDE (total);

EXPLAIN ANALYZE SELECT user_id, total FROM orders WHERE user_id = 12345;
```
```
Index Only Scan using orders_user_id_total_idx on orders  (actual time=0.028..0.029 rows=16 loops=1)
  Index Cond: (user_id = 12345)
  Heap Fetches: 0
```
<mark>INCLUDE</mark> thêm cột vào lá của index mà không dùng để sắp xếp. <mark>Heap Fetches: 0</mark> nghĩa là không chạm vào bảng. Đây cũng là lý do nên <mark>select</mark> đúng cột cần thay vì <mark>SELECT *</mark>.
```ruby
add_index :orders, :user_id, include: [:total]
```

#### Index không miễn phí
Mỗi <mark>INSERT</mark>, <mark>UPDATE</mark>, <mark>DELETE</mark> phải cập nhật **tất cả** index của bảng. Thử insert 200.000 dòng
```
Bảng không có index:  120 ms
Bảng có 5 index:     1389 ms
```
Chậm hơn 11 lần. Ngoài ra index chiếm đĩa (index 2 cột ở trên là 60MB), và chiếm RAM cache. Định kỳ xem index nào không được dùng để xóa đi
```sql
SELECT indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan;
```
```
indexrelname                  | idx_scan | size
------------------------------+----------+-------
orders_pending_idx            |        1 | 904 kB
orders_user_id_idx            |        2 | 15 MB
orders_user_id_created_at_idx |        2 | 60 MB
```
<mark>idx_scan = 0</mark> sau vài tuần chạy production là ứng viên để xóa.

#### Tạo index trên production
<mark>CREATE INDEX</mark> **khóa ghi** bảng cho tới khi xong. Với bảng vài chục triệu dòng có thể mất nhiều phút, trong lúc đó không ai đặt hàng được. Dùng <mark>CONCURRENTLY</mark>: chậm hơn nhưng không khóa
```ruby
class AddUserIdIndexToOrders < ActiveRecord::Migration[8.0]
  disable_ddl_transaction! # CONCURRENTLY không chạy được trong transaction

  def change
    add_index :orders, :user_id, algorithm: :concurrently
  end
end
```
Gem <mark>strong_migrations</mark> sẽ nhắc nếu quên, và còn chặn nhiều migration nguy hiểm khác.

#### Tóm tắt
- Index là bản sao đã sắp xếp của cột, giúp tìm mà không đọc cả bảng. Mặc định là B-tree.
- Luôn index **foreign key** và những cột hay nằm trong <mark>WHERE</mark>, <mark>ORDER BY</mark>, <mark>JOIN</mark>.
- Đọc <mark>EXPLAIN ANALYZE</mark>: tìm <mark>Seq Scan</mark> trên bảng lớn, <mark>Sort</mark>, và chênh lệch giữa rows ước lượng với thực tế.
- Index chỉ được dùng khi lọc được nhiều. Cột ít giá trị thì dùng **partial index**.
- Index nhiều cột: cột **dấu bằng** trước, **khoảng/sắp xếp** sau. Thêm <mark>INCLUDE</mark> để có Index Only Scan.
- Index làm ghi chậm, xóa index không dùng. Production thì tạo với <mark>CONCURRENTLY</mark>.

Bài tiếp theo: B-tree không giải quyết được <mark>LIKE '%abc%'</mark>, <mark>lower(email)</mark>, cột JSON hay mảng. Đó là lúc cần các loại index khác.
