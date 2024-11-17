---
layout: post
title:  "019.Full text search with Rails and PostgreSQL."
author: thach
categories: [ Coding, Ruby, Postgres]
image: assets/images/post_019/full_text_search.png
---
#### 1. Vì sao lại cần full text search
Có 2 trường hợp mình nghĩ tới **full text search**, đó là khi mình cần query với từ khóa mềm dẻo hơn, hoặc là khi mình cần cần tốc độ với những table chứa lượng lớn record.

Khi mà bạn dùng **LIKE** (hoặc **ILIKE**) thì bắt buộc keyword của người dùng phải trùng khớp hoàn toàn với một phần của kết quả. Nếu tài liệu bạn cần tìm là **"The quick brown fox jumps over the lazy dog"**, thì bạn **không** thể tìm ra với những từ khóa như **"fox jump dog"**, **"dog fox"**, **"fox jump over"** ... được.

Trường hợp thứ 2 là khi data table của bạn chứa quá nhiều record, khoảng 10 triệu, thì hiệu suất của query **LIKE**, và **ILIKE** sẽ bắt đầu chậm, nhất là với những query với **%{keyword},** khi đó thì index của data table sẽ không còn hiệu lực nữa.

#### 2. Cơ chế
Về cơ bản thì cách làm việc của full text search trong PostgreSQL sẽ dựa trên các hàm <mark>to_tsvector</mark>, <mark>to_tsquery</mark> và <mark>@@</mark>, các hệ quản trị CSQL khác chắc là cũng có các hàm này hoặc tương tự.

**to_tsvector** sẽ chuyển dữ liệu kiểu string thành kiểu **vector**.

```sql
--
SELECT to_tsvector('english', 'The quick brown fox jumps over the lazy dog');
--                      to_tsvector
---------------------------------------------------------
-- 'brown':3 'dog':9 'fox':4 'jump':5 'lazi':8 'quick':2
--(1 row)
```
Có thể về sau mình sẽ viết thêm về kiểu dữ liệu **vector**, còn giờ thì các bạn để ý thấy, chữ <mark>The</mark> đã bị bỏ đi, và <mark>jumps</mark> thì đã trở về nguyên mẫu không có **s**. Lý do ở đây là vì chúng ta đã có config từ điển là **english** cho hàm **to_tsvector**.

**to_tsquery** sẽ chuyển dữ liệu kiểu string thành kiểu **tsquery**.
```sql
SELECT to_tsquery('english', 'Fox & Dog & jumps');
--       to_tsquery
--------------------------
-- 'fox' & 'dog' & 'jump'
--(1 row)
```
Lấy trường hợp các bạn muốn tìm sao cho các từ khóa **fox**, **dog**, **jumps** cùng xuất hiện trong câu. Và một lần nữa, chúng ta cũng có thể config từ điển là **english** cho hàm **to_tsquery**.

**@@** là toán tử dùng để so sánh 2 kiểu dữ liệu **vector** và **tsquery**, nếu kết quả trùng khớp thì sẽ trả về **true**, ngược lại thì sẽ trả về **false**.

```sql
-- t tức là true
SELECT to_tsvector('english', 'The quick brown fox jumps over the lazy dog') @@ to_tsquery('english', 'Fox & Dog & jumps');
-- ?column?
------------
-- t
--(1 row)
```
Giờ thử sử dụng toàn bộ 3 hàm trên để tìm kiếm trong table **posts**.

```sql
INSERT INTO posts (title, content)
VALUES ('The quick brown fox jumps over the lazy dog', 'something');
-- INSERT 0 1
--
SELECT id, title FROM posts WHERE to_tsvector('english', posts.title) @@ to_tsquery('english', 'Fox & Dog & jumps');
-- id |                    title
------+---------------------------------------------
--  1 | The quick brown fox jumps over the lazy dog
--(1 row)
```
Tada, full text search đã hoạt động. 	:clap:
