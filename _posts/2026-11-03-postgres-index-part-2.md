---
layout: post
title:  "112. PostgreSQL Index (Expression, Trigram, GIN & BRIN)."
date:   2026-11-03 02:02:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_112/postgres-index-gin.png
---
B-tree chỉ giúp được khi query so sánh **trực tiếp** giá trị của cột: <mark>=</mark>, <mark><</mark>, <mark>></mark>, <mark>BETWEEN</mark>, <mark>IN</mark>, <mark>ORDER BY</mark>. Bài này đi qua những trường hợp B-tree thường không giúp được và cách xử lý từng trường hợp. Dữ liệu mẫu tiếp tục từ bài 111.

#### Hàm trên cột
Đăng nhập không phân biệt hoa thường
```sql
CREATE INDEX users_email_idx ON users (email);

EXPLAIN ANALYZE SELECT * FROM users WHERE lower(email) = 'user1234@example.com';
```
```
Seq Scan on users  (cost=0.00..2636.00 rows=500 width=58) (actual time=0.412..20.201 rows=1 loops=1)
  Filter: (lower(email) = 'user1234@example.com'::text)
  Rows Removed by Filter: 99999
Execution Time: 20.215 ms
```
Có index trên <mark>email</mark> nhưng vẫn Seq Scan. Index sắp xếp theo <mark>email</mark>, còn query hỏi theo <mark>lower(email)</mark>, là một giá trị khác, PostgreSQL không thể suy ra. Quy tắc: **bọc cột trong hàm là mất index**. Cách sửa: tạo index trên đúng biểu thức đó, gọi là **expression index**
```sql
CREATE INDEX users_lower_email_idx ON users (lower(email));
```
```
Bitmap Heap Scan on users  (actual time=0.037..0.037 rows=1 loops=1)
  ->  Bitmap Index Scan on users_lower_email_idx  (actual time=0.033..0.033 rows=1 loops=1)
        Index Cond: (lower(email) = 'user1234@example.com'::text)
Execution Time: 0.077 ms
```
```ruby
add_index :users, "lower(email)", name: "users_lower_email_idx", unique: true
```
Query phải viết **y hệt** biểu thức trong index. <mark>LOWER(email)</mark> và <mark>lower(email)</mark> thì giống nhau, nhưng <mark>lower(trim(email))</mark> thì không.

Lưu ý: với email, cách tốt hơn là chuẩn hóa về chữ thường **trước khi lưu** (bài 096 có ví dụ với value object), rồi chỉ cần index thường. Expression index hợp lý hơn với những thứ như <mark>date(created_at)</mark>, <mark>(attrs->>'brand')</mark>.

#### LIKE theo tiền tố
```sql
EXPLAIN ANALYZE SELECT * FROM users WHERE email LIKE 'user1234%';
```
```
Seq Scan on users  (actual time=0.056..3.918 rows=11 loops=1)
  Filter: (email ~~ 'user1234%'::text)
```
Đã có <mark>users_email_idx</mark> mà vẫn Seq Scan? Nguyên nhân nằm ở **collation**: database tạo với locale <mark>en_US.UTF-8</mark> (mặc định của Docker image và nhiều server) sắp xếp chuỗi theo quy tắc ngôn ngữ, không theo từng byte, nên không bảo đảm được mọi chuỗi bắt đầu bằng "user1234" nằm liền nhau trong index. Cách sửa: tạo index với **operator class** <mark>text_pattern_ops</mark>, sắp xếp theo byte
```sql
CREATE INDEX users_email_pattern_idx ON users (email text_pattern_ops);
```
```
Index Scan using users_email_pattern_idx on users  (actual time=0.059..0.061 rows=11 loops=1)
  Index Cond: ((email ~>=~ 'user1234'::text) AND (email ~<~ 'user1235'::text))
  Filter: (email ~~ 'user1234%'::text)
```
Planner tự chuyển <mark>LIKE 'user1234%'</mark> thành khoảng <mark>>= 'user1234' AND < 'user1235'</mark>. Index này chỉ dùng cho <mark>LIKE</mark>, so sánh <mark>=</mark> vẫn dùng index thường.
```ruby
add_index :users, :email, opclass: :text_pattern_ops, name: "users_email_pattern_idx"
```
Nếu database tạo với locale <mark>C</mark> thì index thường đã dùng được cho LIKE tiền tố. Kiểm tra bằng <mark>SELECT datcollate FROM pg_database WHERE datname = current_database();</mark>

#### LIKE chứa chuỗi: trigram
Ô tìm kiếm tên khách hàng <mark>ILIKE '%ser 1234%'</mark>: không có tiền tố, không index B-tree nào giúp được. Extension <mark>pg_trgm</mark> cắt chuỗi thành các bộ 3 ký tự ("use", "ser", "er ", ...) và index các bộ đó bằng **GIN**
```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;

EXPLAIN ANALYZE SELECT * FROM users WHERE name ILIKE '%ser 1234%';
-- Seq Scan, 28.004 ms

CREATE INDEX users_name_trgm_idx ON users USING gin (name gin_trgm_ops);

EXPLAIN ANALYZE SELECT * FROM users WHERE name ILIKE '%ser 1234%';
```
```
Bitmap Heap Scan on users  (actual time=0.509..0.514 rows=11 loops=1)
  Recheck Cond: (name ~~* '%ser 1234%'::text)
  ->  Bitmap Index Scan on users_name_trgm_idx  (actual time=0.502..0.503 rows=11 loops=1)
        Index Cond: (name ~~* '%ser 1234%'::text)
Execution Time: 0.524 ms
```
28ms xuống 0.5ms, và dùng được cho cả <mark>ILIKE</mark> (không phân biệt hoa thường) lẫn tìm gần đúng với toán tử <mark>%</mark> (similarity).
```ruby
# db/migrate/xxx_add_trgm_index_to_users.rb

class AddTrgmIndexToUsers < ActiveRecord::Migration[8.0]
  def change
    enable_extension "pg_trgm"
    add_index :users, :name, using: :gin, opclass: :gin_trgm_ops
  end
end
```
Chuỗi tìm nên từ 3 ký tự trở lên, ngắn hơn thì trigram không lọc được gì. Nếu cần tìm kiếm thật sự (nhiều cột, xếp hạng, không dấu), xem full-text search của PostgreSQL (bài 019, 020) hoặc Elasticsearch (bài 105 - 110).

#### GIN cho JSONB và mảng
Bài 038 và 039 đã dùng cột <mark>text[]</mark> và <mark>jsonb</mark>. B-tree không index được **bên trong** chúng. GIN (Generalized Inverted Index) thì được: nó lập chỉ mục cho **từng phần tử** (mỗi key/value của JSON, mỗi phần tử của mảng), giống inverted index của Elasticsearch.
```sql
CREATE TABLE products (id bigserial PRIMARY KEY, name text, attrs jsonb, tags text[]);
-- 300.000 sản phẩm, attrs dạng {"brand": "Sony", "color": "blue", "weight": 120}, tags dạng {sale,phone}

EXPLAIN ANALYZE SELECT count(*) FROM products WHERE attrs @> '{"brand": "Sony", "color": "blue"}';
-- Parallel Seq Scan, 26.717 ms

CREATE INDEX products_attrs_idx ON products USING gin (attrs);

EXPLAIN ANALYZE SELECT count(*) FROM products WHERE attrs @> '{"brand": "Sony", "color": "blue"}';
```
```
Aggregate  (actual time=15.287..15.288 rows=1 loops=1)
  ->  Bitmap Heap Scan on products  (actual time=7.759..14.727 rows=18651 loops=1)
        Recheck Cond: (attrs @> '{"brand": "Sony", "color": "blue"}'::jsonb)
        ->  Bitmap Index Scan on products_attrs_idx  (actual time=7.327..7.328 rows=18651 loops=1)
```
Chỉ nhanh hơn gần 2 lần, vì kết quả là 18.651 dòng (6%), phần lớn thời gian là đọc bảng. Lọc điều kiện chặt hơn (ít kết quả hơn) thì chênh lệch sẽ lớn hơn nhiều.

Điều quan trọng: GIN trên jsonb chỉ phục vụ các toán tử <mark>@></mark> (chứa), <mark>?</mark> (có key), <mark>?|</mark>, <mark>?&</mark>. Viết theo kiểu <mark>attrs->>'brand' = 'Sony'</mark> thì **không** dùng được index
```sql
EXPLAIN ANALYZE SELECT count(*) FROM products WHERE attrs->>'brand' = 'Sony';
-- Parallel Seq Scan, 23.812 ms, dù đã có GIN
```
Vì vậy trong Rails, viết điều kiện bằng <mark>@></mark>
```ruby
Product.where("attrs @> ?", { brand: "Sony" }.to_json)
```
Hoặc nếu chỉ hay lọc theo một key cụ thể, tạo B-tree expression index cho key đó: <mark>add_index :products, "(attrs->>'brand')"</mark>, nhỏ và nhanh hơn GIN.

Với mảng cũng vậy
```sql
CREATE INDEX products_tags_idx ON products USING gin (tags);

EXPLAIN ANALYZE SELECT count(*) FROM products WHERE tags @> ARRAY['vip'];
-- Bitmap Index Scan on products_tags_idx, 9.457 ms (trước đó Seq Scan 26.979 ms)
```
```ruby
add_index :products, :attrs, using: :gin
add_index :products, :tags, using: :gin
```
Nhược điểm của GIN: **ghi chậm** hơn B-tree đáng kể, và index khá lớn. Chỉ tạo khi thật sự có query lọc bên trong JSON/mảng.

#### BRIN cho bảng log
Bảng <mark>events</mark>, <mark>logs</mark>, <mark>audit_trails</mark>: chỉ insert, không bao giờ update, <mark>created_at</mark> tăng dần theo thứ tự ghi vào. B-tree trên <mark>created_at</mark> cho 2 triệu dòng tốn 43MB. **BRIN** (Block Range Index) không lưu từng giá trị, chỉ lưu **min/max của mỗi nhóm block** trên đĩa
```sql
CREATE TABLE events (id bigserial PRIMARY KEY, kind text, created_at timestamptz NOT NULL);
-- 2 triệu dòng, created_at tăng dần

CREATE INDEX events_created_at_brin ON events USING brin (created_at);
```
```
btree | brin  | table
------+-------+-------
43 MB | 24 kB | 100 MB
```
Nhỏ hơn **1.800 lần**. Query theo khoảng thời gian
```sql
EXPLAIN ANALYZE SELECT count(*) FROM events WHERE created_at BETWEEN '2025-03-01' AND '2025-03-02';
```
```
Bitmap Heap Scan on events  (actual time=0.236..1.176 rows=2881 loops=1)
  Rows Removed by Index Recheck: 17215
  Heap Blocks: lossy=128
  ->  Bitmap Index Scan on events_created_at_brin  (actual time=0.037..0.038 rows=1280 loops=1)
Execution Time: 1.301 ms
```
BRIN chỉ khoanh vùng 128 block có thể chứa kết quả, rồi đọc và lọc lại (<mark>Rows Removed by Index Recheck</mark>). Chậm hơn B-tree một chút nhưng với log hàng trăm triệu dòng thì tiết kiệm được rất nhiều.

BRIN **chỉ hiệu quả khi giá trị tương quan với vị trí trên đĩa**. Bảng <mark>orders</mark> ở bài 111 có <mark>created_at</mark> ngẫu nhiên nên BRIN vô dụng. Kiểm tra bằng <mark>SELECT correlation FROM pg_stats WHERE tablename = 'events' AND attname = 'created_at';</mark>, gần 1 là tốt.
```ruby
add_index :events, :created_at, using: :brin
```

#### Unique index
<mark>validates :email, uniqueness: true</mark> của Rails **không đủ**: 2 request cùng lúc đều kiểm tra "chưa có" rồi cùng insert (race condition, bài 081). Chỉ có unique index ở database mới chặn được chắc chắn
```ruby
add_index :users, :email, unique: true, algorithm: :concurrently
```
Rails sẽ raise <mark>ActiveRecord::RecordNotUnique</mark> khi vi phạm, bắt lỗi này để báo cho user. Unique index cũng là index thường, nên query theo <mark>email</mark> dùng được luôn.

#### Chọn loại nào

| Trường hợp | Index |
|---|---|
| <mark>=</mark>, <mark><</mark>, <mark>></mark>, <mark>BETWEEN</mark>, <mark>ORDER BY</mark>, foreign key | B-tree (mặc định) |
| Hàm trên cột: <mark>lower()</mark>, <mark>date()</mark> | B-tree trên biểu thức |
| <mark>LIKE 'abc%'</mark> | B-tree với <mark>text_pattern_ops</mark> |
| <mark>LIKE '%abc%'</mark>, <mark>ILIKE</mark>, tìm gần đúng | GIN với <mark>pg_trgm</mark> |
| <mark>jsonb @></mark>, <mark>text[] @></mark>, full-text <mark>tsvector</mark> | GIN |
| Bảng log rất lớn, chỉ insert, lọc theo thời gian | BRIN |
| Chỉ cần một phần dòng (<mark>status = 'pending'</mark>, <mark>deleted_at IS NULL</mark>) | Partial (bài 111) |
| Dữ liệu không gian, khoảng (<mark>tstzrange</mark>), tìm lân cận | GiST |

Chưa nhắc tới GiST ở trên: nó dùng cho tọa độ (PostGIS), kiểu khoảng (<mark>daterange</mark> với ràng buộc không trùng lịch), và cũng có <mark>gist_trgm_ops</mark>. Với ứng dụng web thông thường, B-tree, partial, expression và GIN là đủ dùng 95% trường hợp.

Bài cuối sẽ nói về những query hay chậm trong Rails dù đã có index, và cách tìm ra chúng.
