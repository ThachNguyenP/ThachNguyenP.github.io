---
layout: post
title:  "064. Making api with GraphQL (Pagination & N+1)."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_064/graphql-pagination.png
---
Phần cuối trong series GraphQL, 2 vấn đề gần như dự án nào cũng gặp: phân trang và N+1 query.

#### Phân trang
Với Grape chúng ta dùng <mark>kaminari</mark>, còn GraphQL Ruby đã có sẵn phân trang theo kiểu **cursor** (chuẩn Relay Connection), không cần thêm gem.

Chỉ cần đổi kiểu trả về từ <mark>[Types::UserType]</mark> sang <mark>Types::UserType.connection_type</mark>
```ruby
# app/graphql/types/query_type.rb

field :users, Types::UserType.connection_type, null: false

def users
  User.order(:id)
end
```
Gem sẽ tự thêm các argument <mark>first</mark>, <mark>after</mark>, <mark>last</mark>, <mark>before</mark> cho field này.

Nên giới hạn số record tối đa mỗi trang ở schema, tránh trường hợp client lấy cả bảng:
```ruby
# app/graphql/graphql_sample_schema.rb

class GraphqlSampleSchema < GraphQL::Schema
  default_max_page_size 50
  # ...
end
```

Query trang đầu, mỗi trang 2 user
```graphql
{
  users(first: 2) {
    nodes {
      id
      name
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}
```
```json
{
  "data": {
    "users": {
      "nodes": [
        { "id": "1", "name": "Nolan" },
        { "id": "2", "name": "Messi" }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "Mg"
      }
    }
  }
}
```
Muốn lấy trang tiếp theo thì truyền <mark>endCursor</mark> vào <mark>after</mark>
```graphql
{
  users(first: 2, after: "Mg") {
    nodes { id name }
    pageInfo { hasNextPage endCursor }
  }
}
```
Kiểu cursor này rất hợp cho app mobile kiểu infinite scroll. Nếu FE cần hiển thị tổng số record, có thể tự thêm field <mark>totalCount</mark> vào connection, nhưng trong bài này tôi giữ cho đơn giản.

#### N+1 query
Nhớ lại query ở bài 2
```graphql
{
  users {
    nodes {
      name
      posts { title }
    }
  }
}
```
Nhìn log server sẽ thấy: 1 query lấy users, sau đó **mỗi user lại thêm 1 query** lấy posts. 50 user là 51 query. Đây chính là N+1.

Với REST thì chúng ta dùng <mark>includes(:posts)</mark>. Nhưng ở GraphQL, client có thể lấy hoặc không lấy <mark>posts</mark>, nên <mark>includes</mark> cứng ở resolver thì sẽ bị thừa khi client không cần.

Giải pháp là <mark>GraphQL::Dataloader</mark>, có sẵn trong gem. Nó sẽ gom tất cả các lần load lại rồi chạy 1 query duy nhất.

Kiểm tra schema đã có dòng này chưa (bản mới thì generator đã thêm sẵn)
```ruby
# app/graphql/graphql_sample_schema.rb

use GraphQL::Dataloader
```

Rồi sửa field <mark>posts</mark> trong <mark>UserType</mark>
```ruby
# app/graphql/types/user_type.rb

field :posts, [Types::PostType], null: false

def posts
  dataload_association(:posts)
end
```
Ngược lại, nếu <mark>PostType</mark> có field <mark>author</mark> thì dùng <mark>dataload_record</mark>
```ruby
# app/graphql/types/post_type.rb

field :author, Types::UserType, null: false

def author
  dataload_record(User, object.user_id)
end
```
Giờ gọi lại query, log server chỉ còn 2 query: 1 lấy users, 1 lấy posts của tất cả users đó.
```sql
SELECT "users".* FROM "users" ORDER BY "users"."id" ASC LIMIT 2
SELECT "posts".* FROM "posts" WHERE "posts"."user_id" IN (1, 2)
```

#### Tổng kết
Qua 4 bài, chúng ta đã đi qua những gì cơ bản nhất để làm API với GraphQL trên Rails:
1. Cài đặt và query <mark>hello</mark>.
2. <mark>Type</mark> và <mark>Query</mark> với argument, variables.
3. <mark>Mutation</mark> và xử lý lỗi.
4. Phân trang với <mark>connection_type</mark> và chống N+1 với <mark>Dataloader</mark>.

Phần authentication thì các bro có thể truyền <mark>current_user</mark> vào <mark>context</mark> trong <mark>GraphqlController</mark>, rồi lấy ra bằng <mark>context[:current_user]</mark> ở bất kỳ resolver nào.
