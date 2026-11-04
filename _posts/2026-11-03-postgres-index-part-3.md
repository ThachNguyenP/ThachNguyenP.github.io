---
layout: post
title:  "113. PostgreSQL Index (Tối ưu query)."
date:   2026-11-03 02:04:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_113/postgres-index-optimize.png
---
Đã có index rồi mà vẫn chậm. Bài này đi qua các bước: **tìm** query chậm, **đọc** plan để biết chậm ở đâu, và các lỗi hay gặp nhất cùng cách sửa. Dữ liệu mẫu tiếp tục từ bài 111.

#### Bước 1: Tìm query chậm
Đừng đoán, hãy đo. Extension <mark>pg_stat_statements</mark> ghi lại thống kê của mọi query đã chạy
```
# postgresql.conf (hoặc -c shared_preload_libraries=pg_stat_statements khi chạy Docker)
shared_preload_libraries = 'pg_stat_statements'
```
```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

SELECT round(total_exec_time::numeric) AS total_ms,
       calls,
       round(mean_exec_time::numeric, 1) AS mean_ms,
       left(query, 70) AS query
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 10;
```
```
total_ms | calls | mean_ms | query
---------+-------+---------+----------------------------------------------------------
     255 |     1 |   255.3 | SELECT * FROM orders ORDER BY id LIMIT $1 OFFSET $2
     246 |     2 |   122.9 | SELECT * FROM orders WHERE status = $1
      90 |     1 |    90.3 | SELECT count(*) FROM orders WHERE created_at > now() -
```
Sắp theo <mark>total_exec_time</mark> (tổng thời gian) chứ không chỉ <mark>mean</mark>: một query 5ms nhưng chạy 100.000 lần mỗi giờ tốn tài nguyên hơn query 2 giây chạy 1 lần. Tham số đã được thay bằng <mark>$1</mark>, <mark>$2</mark> nên các query cùng dạng được gom lại.

Thêm vài nguồn khác:
- Bảng nào bị Seq Scan nhiều: <mark>SELECT relname, seq_scan, idx_scan FROM pg_stat_user_tables ORDER BY seq_scan DESC;</mark>
- Rails log: đặt <mark>config.active_record.verbose_query_logs = true</mark> ở development để biết query sinh ra từ dòng code nào.
- Gem <mark>pghero</mark>: giao diện web gom tất cả những thứ trên, gợi ý index còn thiếu và index không dùng.
- APM (Sentry, Datadog, New Relic) báo request nào chậm và query nào chiếm thời gian trong request đó (series Observability, bài 071 - 074).

#### Bước 2: Đọc plan với BUFFERS
```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT * FROM orders WHERE user_id = 12345 ORDER BY created_at DESC LIMIT 10;
```
```
Limit  (actual time=0.092..0.244 rows=10 loops=1)
  Buffers: shared hit=3 read=13
  ->  Index Scan using orders_user_id_created_at_idx on orders  (actual time=0.091..0.242 rows=10 loops=1)
        Index Cond: (user_id = 12345)
        Buffers: shared hit=3 read=13
Execution Time: 0.277 ms
```
<mark>Buffers</mark> cho biết query đọc bao nhiêu block 8KB: <mark>hit</mark> là có sẵn trong RAM, <mark>read</mark> là phải đọc từ đĩa. Cùng một query, lần chạy đầu <mark>read</mark> nhiều nên chậm, chạy lại thì <mark>hit</mark> hết và nhanh. Vì vậy khi đo, hãy chạy 2 - 3 lần và lấy lần sau. Query đọc hàng chục nghìn buffer để trả về vài dòng là dấu hiệu rõ ràng của thiếu index hoặc index sai.

Khi nhìn vào plan, tìm theo thứ tự:
1. **Seq Scan** trên bảng lớn với <mark>Rows Removed by Filter</mark> rất lớn.
2. **Sort** với <mark>Sort Method: external merge Disk</mark>: sắp xếp tràn ra đĩa.
3. **rows ước lượng lệch xa thực tế**: planner chọn sai cách vì thống kê cũ, chạy <mark>ANALYZE</mark>.
4. **Nested Loop** có <mark>loops</mark> rất lớn mà node bên trong là Seq Scan: join thiếu index.

Nếu plan quá dài, dán vào <mark>explain.dalibo.com</mark> hoặc <mark>explain.depesz.com</mark>, chúng tô màu node tốn thời gian nhất.

#### Lỗi 1: Hàm bọc cột
Báo cáo đơn hàng theo ngày
```ruby
Order.where("date(created_at) = ?", Date.new(2026, 10, 1))
```
```
Parallel Seq Scan on orders  (actual time=0.126..64.140 rows=890 loops=3)
  Filter: (date(created_at) = '2026-10-01'::date)
Execution Time: 70.368 ms
```
Đã có index trên <mark>created_at</mark> nhưng bị bọc trong <mark>date()</mark> (bài 112). Sửa thành khoảng
```ruby
day = Date.new(2026, 10, 1)
Order.where(created_at: day.beginning_of_day..day.end_of_day)
# hoặc Order.where(created_at: day.all_day)
```
```
Index Only Scan using orders_created_at_idx on orders  (actual rows=2670 loops=1)
  Index Cond: ((created_at >= '2026-10-01 00:00:00+00') AND (created_at < '2026-10-02 00:00:00+00'))
Execution Time: 0.332 ms
```
Cùng dạng lỗi: <mark>WHERE created_at + interval '7 days' > now()</mark> (viết thành <mark>created_at > now() - interval '7 days'</mark>), <mark>WHERE id::text = '123'</mark>, <mark>WHERE EXTRACT(year FROM created_at) = 2026</mark>.

#### Lỗi 2: OFFSET lớn
Phân trang kiểu <mark>page=75000</mark>
```ruby
Order.order(:id).limit(20).offset(1_500_000)
```
```
Limit  (actual time=255.131..255.144 rows=20 loops=1)
  ->  Index Scan using orders_pkey on orders  (actual time=0.036..222.485 rows=1500020 loops=1)
Execution Time: 255.165 ms
```
Để lấy 20 dòng, PostgreSQL phải đọc và **bỏ đi 1.5 triệu dòng** trước đó. Càng về sau càng chậm, và đây là món khoái khẩu của bot scraping (bài 092). Thay bằng **keyset pagination**: nhớ id cuối cùng của trang trước
```ruby
Order.where("id > ?", last_id).order(:id).limit(20)
```
```
Limit  (actual time=0.036..0.039 rows=20 loops=1)
  ->  Index Scan using orders_pkey on orders  (actual rows=20 loops=1)
        Index Cond: (id > 1500000)
Execution Time: 0.048 ms
```
5.000 lần nhanh hơn, và tốc độ không đổi dù ở trang nào. Sắp theo cột khác thì dùng cặp <mark>(created_at, id)</mark> để không bị trùng, giống <mark>search_after</mark> của Elasticsearch (bài 109). Với giao diện có số trang, giới hạn tối đa khoảng 100 trang là đủ.

#### Lỗi 3: COUNT trên bảng lớn
```ruby
Order.count # => SELECT count(*) FROM orders
```
```
Parallel Seq Scan on orders  (actual rows=666667 loops=3)
Execution Time: 70.993 ms
```
PostgreSQL phải đếm thật từng dòng (do cơ chế MVCC, không có sẵn con số). 2 triệu dòng mất 70ms, mà trang danh sách nào cũng đếm để hiện "Trang 1 / 100.000". Cách xử lý:
- Hiển thị số **ước lượng** từ thống kê, đủ cho UI: <mark>SELECT reltuples::bigint FROM pg_class WHERE relname = 'orders';</mark> (trả về 2000000, tức thì).
- **Counter cache** của Rails (<mark>belongs_to :user, counter_cache: true</mark>) cho các số đếm theo cha: số đơn của user, số bình luận của bài viết.
- Không đếm: chỉ hiện nút "Trang sau" nếu còn dữ liệu (lấy <mark>limit + 1</mark> dòng).
- Đếm có điều kiện thì đảm bảo có index để <mark>count</mark> đi qua Index Only Scan, như ở lỗi 1.

#### Lỗi 4: ORDER BY + LIMIT không có index
Top 10 đơn giá trị cao nhất
```ruby
Order.order(total: :desc).limit(10)
```
```
Limit  (actual time=77.001..80.100 rows=10 loops=1)
  ->  Gather Merge
        ->  Sort  (actual time=73.599..73.599 rows=10 loops=3)
              Sort Key: total DESC
              Sort Method: top-N heapsort  Memory: 26kB
              ->  Parallel Seq Scan on orders  (actual rows=666667 loops=3)
Execution Time: 80.123 ms
```
Để lấy 10 dòng, phải đọc cả 2 triệu dòng rồi sắp xếp. Có index thì chỉ đọc 10 dòng từ cuối index
```sql
CREATE INDEX orders_total_idx ON orders (total);
```
```
Limit  (actual time=0.025..0.054 rows=10 loops=1)
  ->  Index Scan Backward using orders_total_idx on orders  (actual rows=10 loops=1)
Execution Time: 0.062 ms
```
Để ý <mark>Index Scan Backward</mark>: B-tree đọc được cả 2 chiều, nên không cần tạo index <mark>DESC</mark> riêng cho một cột. Chỉ cần <mark>DESC</mark> khi index nhiều cột mà các cột sắp theo chiều khác nhau, ví dụ <mark>(user_id ASC, created_at DESC)</mark> ở bài 111.

#### Lỗi 5: JOIN thiếu index ở bảng kia
Tìm đơn hàng theo email khách
```ruby
Order.joins(:user).where(users: { email: "user500@example.com" })
```
```
Nested Loop  (actual time=0.084..10.600 rows=21 loops=1)
  ->  Seq Scan on users u  (actual time=0.055..10.494 rows=1 loops=1)
        Filter: (email = 'user500@example.com'::text)
        Rows Removed by Filter: 99999
  ->  Bitmap Heap Scan on orders o  (actual rows=21 loops=1)
        ->  Bitmap Index Scan on orders_user_id_created_at_idx
Execution Time: 10.612 ms
```
<mark>orders.user_id</mark> có index, nhưng <mark>users.email</mark> thì không, nên phải quét cả bảng users trước. Thêm index cho <mark>users.email</mark> thì cả 2 bước đều đi qua index, còn 0.07ms. Khi join, hãy nhìn **từng node**: mỗi bảng tham gia join đều cần index cho cột lọc hoặc cột join của nó.

3 cách join sẽ thấy trong plan:

| Node | Khi nào planner chọn |
|---|---|
| <mark>Nested Loop</mark> | Một bên rất ít dòng, bên kia có index theo cột join. Tốt khi đúng, thảm họa nếu bên trong là Seq Scan |
| <mark>Hash Join</mark> | Hai bên đều nhiều dòng, không có index phù hợp. Xây hash table từ bên nhỏ hơn |
| <mark>Merge Join</mark> | Hai bên đều đã sắp xếp theo cột join |

#### Lỗi 6: NOT IN với subquery
Tìm user chưa từng đặt hàng
```ruby
User.where.not(id: Order.select(:user_id)) # => id NOT IN (SELECT user_id FROM orders)
```
Trên 2 triệu đơn, query này chạy hơn **20 giây** rồi bị tôi cắt bằng <mark>statement_timeout</mark>. Viết lại bằng <mark>NOT EXISTS</mark>
```ruby
User.where("NOT EXISTS (SELECT 1 FROM orders WHERE orders.user_id = users.id)")
```
Mất **48ms**. <mark>NOT IN</mark> với subquery lớn buộc PostgreSQL so sánh từng dòng với cả danh sách, và còn có bẫy ngữ nghĩa: chỉ cần một <mark>NULL</mark> trong danh sách là kết quả rỗng. <mark>NOT EXISTS</mark> (hoặc <mark>LEFT JOIN ... WHERE ... IS NULL</mark>) được planner chuyển thành Anti Join hiệu quả. Với <mark>IN</mark> (không có NOT) thì PostgreSQL xử lý tốt, không cần đổi.

#### Lỗi 7: N+1
Không phải lỗi của database, nhưng là nguyên nhân số một làm trang Rails chậm
```ruby
orders = Order.order(created_at: :desc).limit(50)
orders.each { |order| puts order.user.name } # 1 query lấy orders + 50 query lấy user
```
Mỗi query chỉ 0.1ms nhưng 50 lần đi về giữa app và database thì thành 20 - 50ms. Sửa bằng <mark>includes</mark>
```ruby
Order.includes(:user).order(created_at: :desc).limit(50) # 2 query
```
Phát hiện bằng gem <mark>bullet</mark> ở development, hoặc <mark>config.active_record.strict_loading_by_default = true</mark> để Rails raise lỗi khi có lazy loading.

#### Khi index đúng mà vẫn chậm
- **Thống kê cũ**: rows ước lượng lệch xa thực tế. Autovacuum thường lo việc này, nhưng sau khi import lớn hãy chạy <mark>ANALYZE</mark> tay.
- **Bloat**: bảng update/delete nhiều mà autovacuum không theo kịp, bảng và index phình to toàn dòng chết. Xem <mark>n_dead_tup</mark> trong <mark>pg_stat_user_tables</mark>, chỉnh autovacuum mạnh hơn cho bảng đó, hoặc <mark>REINDEX CONCURRENTLY</mark>.
- **Cấu hình**: <mark>shared_buffers</mark> mặc định chỉ 128MB (nên khoảng 25% RAM), <mark>work_mem</mark> 4MB (Sort tràn đĩa), <mark>random_page_cost</mark> mặc định 4 là cho ổ HDD, với SSD đặt 1.1 để planner mạnh dạn dùng index hơn. Dùng <mark>pgtune</mark> để có điểm khởi đầu.
- **Lock**: query không chậm, chỉ đang chờ transaction khác (bài 082). Xem <mark>pg_stat_activity</mark> với <mark>wait_event_type = 'Lock'</mark>.
- **Quá nhiều dữ liệu thật sự**: 100 triệu dòng log thì không index nào cứu được báo cáo tổng hợp. Lúc đó cần bảng tổng hợp sẵn (materialized view, rollup table), partition theo thời gian, hoặc chuyển sang kho dữ liệu riêng.

#### Tổng kết

| Bài | Nội dung | Một câu |
|---|---|---|
| 111 | B-tree & EXPLAIN | Index foreign key, đọc plan, thứ tự cột, partial, covering |
| 112 | Expression, Trigram, GIN & BRIN | Hàm trên cột cần expression index, LIKE cần trigram, JSON/mảng cần GIN |
| 113 | Tối ưu query | Đo bằng pg_stat_statements, 7 lỗi hay gặp |
| 114 | Migration & Gem | Migration không lock bảng, gem tự phát hiện query dở |

Bài tiếp theo sẽ nói về cách đưa những thứ này vào dự án Rails: migration an toàn và các gem tự động phát hiện query dở.

Quy trình tôi hay làm: mở <mark>pg_stat_statements</mark> mỗi tuần, lấy 5 query tốn nhiều thời gian nhất, chạy <mark>EXPLAIN (ANALYZE, BUFFERS)</mark>, sửa theo danh sách lỗi ở trên, đo lại. Thường chỉ cần sửa 2 - 3 query là database nhẹ đi rõ rệt.
