---
layout: post
title:  "023.Fetch a list with n child."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_023/lateral_join.png
---
Left join, right join, outer join, tùm lum join ... và giờ hãy cùng check qua **lateral join**.

#### 1. Lateral joins
> LATERAL JOIN là một kĩ thuật JOIN cho phép subquery tham chiếu các cột từ các bảng trong mệnh đề FROM của truy vấn SQL trước đó.

Hiện tại chỉ có PostsgreSQL từ **9.3** mới hỗ trợ kĩ thuật này. Ta có cấu trúc mẫu của một câu lateral join như sau
```sql
SELECT outer_columns
FROM outer_table
JOIN LATERAL (
    subquery_or_function_with_condition_to_outer_table
) AS alias ON true;
```
Để lấy ví dụ, ta thử lấy tình huống, trả về list user kèm theo bài post mới nhất của user đó.
```ruby
class AddUserAndPosts < ActiveRecord::Migration[7.0]
  def change
    create_table :users do |t|
      t.string :name
    end

    create_table :posts do |t|
      t.integer :user_id
      t.string :title
      t.timestamp
    end

    add_index :posts, :user_id
  end
end
```
```ruby
10.times do
  User.create!(name: Faker::Name.name)
end

User.all.each do |user|
  7.times do
    user.posts.create!(title: Faker::Book.title)
  end
end
```
Câu truy vấn chúng ta cần được viết như sau:
```sql
SELECT "posts".* FROM (
  SELECT selected_posts.* FROM "users"
  JOIN LATERAL (
    SELECT * FROM posts
    WHERE user_id = users.id
    ORDER BY created_at DESC LIMIT 1
  ) AS selected_posts ON TRUE) posts
```
Điều ảo diệu ở đây là gì, ở trong cặp () trong cùng, chúng ta **select** from **posts**, nhưng lại có thể dùng điều kiện **where** với **id của users**. Điều này không xảy ra nếu không có **LATERAL JOIN**. Nếu bỏ từ khóa **LATERAL** thì ngay lập tức Postgres sẽ trả về lỗi.

#### 2. Lấy 3 phần tử mới nhất của mỗi user

```ruby
class Post < ActiveRecord::Base
  belongs_to :user

  scope :last_n_per_user, ->(n) {
    sql = <<-SQL
      JOIN LATERAL (
        SELECT * FROM posts
        WHERE user_id = users.id
        ORDER BY id DESC LIMIT :limit
      ) AS selected_posts ON TRUE
    SQL

    selected_posts = User
      .select("selected_posts.*")
      .joins(User.sanitize_sql([sql, limit: n]))

    from(selected_posts, "posts")
  }
end
```

```ruby
class User < ActiveRecord::Base
  has_many :posts
  has_many :last_posts, -> { last_n_per_user(3) },
    class_name: "Post"
end
```

```ruby
users = User.preload(:last_posts).limit(5)

users.each do |user|
  puts user.last_posts.map(&:id).inspect
end
```

#### 3. Gem activerecord-has_some_of_many
Và còn gì ngon hơn là có sẵn thư viện để dùng luôn. Hãy cùng xem qua [activerecord-has_some_of_many](https://github.com/bensheldon/activerecord-has_some_of_many?tab=readme-ov-file)

Và cách sử dụng cũng đơn giản của nó, thông qua hàm <mark>has_some_of_many</mark>.

```ruby
class User < ActiveRecord::Base
  has_one_of_many :last_post, -> { order("created_at DESC") }, class_name: "Post"

  # You can also use `has_some_of_many` to get the top N records. Be sure to add a limit to the scope.
  has_some_of_many :last_five_posts, -> { order("created_at DESC").limit(5) }, class_name: "Post"

  # More complex scopes are possible, for example:
  has_one_of_many :top_comment, -> { where(published: true).order("votes_count DESC") }, class_name: "Comment"
  has_some_of_many :top_ten_comments, -> { where(published: true).order("votes_count DESC").limit(10) }, class_name: "Comment"
end

# And then preload/includes and use them like any other Rails association:
User.where(active: true).includes(:last_post, :last_five_posts, :top_comment).each do |user|
  user.last_post
  user.last_five_posts
  user.top_comment
end

# Add compound indexes to your database to make these queries fast!
add_index :comments, [:post_id, :created_at]
add_index :comments, [:post_id, :votes_count]
```

Bài viết tham khảo rất nhiều từ [blog bhserna](https://bhserna.com/fetching-the-top-n-per-group-with-a-lateral-join-with-rails.html)
