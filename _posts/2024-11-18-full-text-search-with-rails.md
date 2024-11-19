---
layout: post
title:  "020.Full text search in PostgreSQL (with Rails)."
author: thach
categories: [ Coding, Ruby, Postgres]
image: assets/images/post_019/full_text_search.png
---
#### 1. Gem pg_search
Đây là cái gem dễ dùng nhất rồi, nếu mà các bạn thích dùng PostgreSQL, còn một vài gem khác như **search_cop**, **litesearch** thì bạn có thể mó tay vào thử.

**pg_search** có 2 tính năng chính là <mark>search_scope</mark> và <mark>multisearch</mark>, tức là tìm kiếm trong một table, hoặc là tìm kiếm trong nhiều table khác nhau.

Thử với một model **Post**, bài toán vẫn là tìm kiếm theo title **"The quick brown fox jumps over the lazy dog"**.
```ruby
# Gemfile
gem 'pg_search'
```
```ruby
class Post < ApplicationRecord
  include PgSearch::Model
  pg_search_scope :search_title, against: :title
end
```
Setup vậy thôi đó các bạn, giờ đã có thể dùng **full text search** rồi.
```ruby
Post.search_title('Fox')
# Post Load (576.8ms)  SELECT "posts".* FROM "posts" INNER JOIN (SELECT "posts"."id" AS pg_search_id, (ts_rank((to_tsvector('english', coalesce(("posts"."title")::text, ''))), (to_tsquery('english', ''' ' || 'Fox' || ' ''')), 0)) AS rank FROM "posts" WHERE ((to_tsvector('english', coalesce(("posts"."title")::text, ''))) @@ (to_tsquery('english', ''' ' || 'Fox' || ' ''')))) AS pg_search_a44f1b975171163546d46b ON "posts"."id" = pg_search_a44f1b975171163546d46b.pg_search_id ORDER BY pg_search_a44f1b975171163546d46b.rank DESC, "posts"."id" ASC
```
Mình test thử với 1 triệu record, mất khoảng chừng 500ms để trả về kết quả, xem chừng vẫn miễn cưỡng chấp nhận được, nhưng vẫn chậm hơn so với query **LIKE** là 100ms.

```ruby
Post.where('title ilike ?',"%Fox%")
# Post Load (98.9ms)  SELECT "posts".* FROM "posts" WHERE (title ilike '%Fox%')
```
#### 2. Speed up truy vấn
Hãy thử nhìn lại câu truy vấn được tạo ra bởi **pg_search**.
```sql
SELECT
  "posts".*
FROM
  "posts"
  INNER JOIN (
    SELECT
      "posts"."id" AS pg_search_id,
      (
        ts_rank(
          (
            to_tsvector('english', coalesce(("posts"."title")::TEXT, ''))
          ),
          (to_tsquery('english', ''' ' || 'Fox' || ' ''')),
          0
        )
      ) AS RANK
    FROM
      "posts"
    WHERE
      (
        (
          to_tsvector('english', coalesce(("posts"."title")::TEXT, ''))
        ) @@ (to_tsquery('english', ''' ' || 'Fox' || ' '''))
      )
  ) AS pg_search_a44f1b975171163546d46b ON "posts"."id" = pg_search_a44f1b975171163546d46b.pg_search_id
ORDER BY
  pg_search_a44f1b975171163546d46b.rank DESC,
  "posts"."id" ASC
```
Hoặc là thôi, đừng nhìn nữa :man_shrugging:

Giải đáp luôn cho các bạn, phần ngốn thời gian nhất là convert từ **string** sang **tsvector** khi đi qua từng record. Chúng ta có thể convert trước và lưu trữ như một field khác trong table. Trong trường hợp này, PostgreSQL từ phiên bản 12 cung cấp cho chúng ta tính năng **stored generated column** thay vì phải sử dụng **trigger**.

```ruby
class AddSearchVectorColumnToPosts < ActiveRecord::Migration[7.0]
  def up
    execute <<-SQL
      ALTER TABLE posts
      ADD COLUMN search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('simple', coalesce(title, ''))
      ) STORED;
    SQL
  end

  def down
    remove_column :posts, :search_vector
  end
end

```
Sau khi chạy **rails db:migrate**, bảng **posts** đã có thêm một field **search_vector**, chứa sẵn **tsvector** của **title**. Và điều hay ho ở đây là khi **title** thay đổi, **search_vector** cũng sẽ tự động cập nhật.

Tất nhiên là **pg_search** không thông minh tới mức tự biết dùng field mới này, dù sao thì tên của nó cũng là mình tự đặt, vậy nên chúng ta cần phải chỉ định lại với **tsvector_column**.

```ruby
class Post < ApplicationRecord
  include PgSearch::Model
  pg_search_scope :search_title, against: :title,
                  using: {
                    tsearch: {
                      dictionary: 'simple', tsvector_column: 'search_vector'
                    }
                  }
end
```

```ruby
Post.search_title('Fox')
#  Post Load (90.1ms)  SELECT "posts".* FROM "posts" INNER JOIN (SELECT "posts"."id" AS pg_search_id, (ts_rank(("posts"."search_vector"), (to_tsquery('simple', ''' ' || 'fox' || ' ''')), 0)) AS rank FROM "posts" WHERE (("posts"."search_vector") @@ (to_tsquery('simple', ''' ' || 'fox' || ' ''')))) AS pg_search_a44f1b975171163546d46b ON "posts"."id" = pg_search_a44f1b975171163546d46b.pg_search_id ORDER BY pg_search_a44f1b975171163546d46b.rank DESC, "posts"."id" ASC
```
Kết quả được cải thiện đáng kể, nhưng vẫn có thể tối ưu hơn nữa nhờ dùng index.
```ruby
class AddIndexToSearchVectorPosts < ActiveRecord::Migration[7.0]
  disable_ddl_transaction!

  def change
    add_index :posts, :search_vector, using: :gin, algorithm: :concurrently
  end
end

```
```ruby
Post.search_title('Fox')
#  Post Load (25.0ms)  SELECT "posts".* FROM "posts" INNER JOIN (SELECT "posts"."id" AS pg_search_id, (ts_rank(("posts"."search_vector"), (to_tsquery('simple', ''' ' || 'Fox' || ' ''')), 0)) AS rank FROM "posts" WHERE (("posts"."search_vector") @@ (to_tsquery('simple', ''' ' || 'Fox' || ' ''')))) AS pg_search_a44f1b975171163546d46b ON "posts"."id" = pg_search_a44f1b975171163546d46b.pg_search_id ORDER BY pg_search_a44f1b975171163546d46b.rank DESC, "posts"."id" ASC
```
Từ 500ms xuống còn 25ms, cho 1 triệu record, phải nói là mình rất hài lòng. Nếu như dự án của bạn không đòi hỏi việc truy vấn quá phức tạp, **full text search** có thể là sự thay thế tốt cho **Elasticsearch**.
