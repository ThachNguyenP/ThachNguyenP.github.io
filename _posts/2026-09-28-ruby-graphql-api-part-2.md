---
layout: post
title:  "062. Making api with GraphQL (Type & Query)."
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_062/graphql-type-query.png
---
Bài trước chúng ta đã có query <mark>hello</mark>. Giờ làm việc với dữ liệu thật trong database.

#### Chuẩn bị data
Tạo 2 model <mark>User</mark> và <mark>Post</mark>, một user có nhiều post.
```sh
rails g model User name:string email:string
rails g model Post title:string body:text user:references
rails db:migrate
```
```ruby
# app/models/user.rb

class User < ApplicationRecord
  has_many :posts
end
```
Insert một ít data bằng <mark>db/seeds.rb</mark> hoặc <mark>rails console</mark> là được.

#### Type
Trong GraphQL, mỗi object trả về cần một **Type**. Có thể hiểu Type tương tự <mark>Grape::Entity</mark> ở series trước, nó quyết định những field nào được expose ra ngoài.

```ruby
# app/graphql/types/user_type.rb

module Types
  class UserType < Types::BaseObject
    field :id, ID, null: false
    field :name, String, null: false
    field :email, String
    field :display_name, String, null: false

    def display_name
      "#{object.name} <#{object.email}>"
    end
  end
end
```
- Field <mark>id</mark>, <mark>name</mark>, <mark>email</mark> trùng tên với column của model, gem sẽ tự lấy giá trị, không cần viết method.
- Field <mark>display_name</mark> không có trong DB, nên chúng ta tự viết method. Bên trong method, <mark>object</mark> chính là record <mark>User</mark> hiện tại.
- Không khai báo <mark>null</mark> thì mặc định là <mark>null: true</mark>, tức là có thể null.

Các type cơ bản hay dùng: <mark>ID</mark>, <mark>String</mark>, <mark>Int</mark>, <mark>Float</mark>, <mark>Boolean</mark>, <mark>GraphQL::Types::ISO8601DateTime</mark>.

Tương tự cho <mark>PostType</mark>
```ruby
# app/graphql/types/post_type.rb

module Types
  class PostType < Types::BaseObject
    field :id, ID, null: false
    field :title, String, null: false
    field :body, String
    field :created_at, GraphQL::Types::ISO8601DateTime, null: false
  end
end
```

Và thêm field <mark>posts</mark> vào <mark>UserType</mark>, kiểu trả về là một mảng <mark>[Types::PostType]</mark>
```ruby
field :posts, [Types::PostType], null: false
```

#### Query
Giờ khai báo query ở <mark>QueryType</mark>: lấy danh sách users, và lấy một user theo id.
```ruby
# app/graphql/types/query_type.rb

module Types
  class QueryType < Types::BaseObject
    field :users, [Types::UserType], null: false

    field :user, Types::UserType do
      argument :id, ID
    end

    def users
      User.all
    end

    def user(id:)
      User.find_by(id:)
    end
  end
end
```
- <mark>argument :id, ID</mark>: query này nhận vào một argument <mark>id</mark>. Argument mặc định là bắt buộc, muốn optional thì thêm <mark>required: false</mark>.
- Argument sẽ được truyền vào resolver dưới dạng keyword argument <mark>user(id:)</mark>.
- Tên field trong Ruby là <mark>snake_case</mark>, còn phía client sẽ là <mark>camelCase</mark>: <mark>display_name</mark> thành <mark>displayName</mark>.

#### Test
Lấy danh sách users, chỉ cần <mark>name</mark>
```graphql
{
  users {
    name
  }
}
```
```json
{
  "data": {
    "users": [
      { "name": "Nolan" },
      { "name": "Messi" }
    ]
  }
}
```

Lấy một user kèm posts. Ở đây dùng **variables** thay vì viết cứng id vào câu query, cách này nên dùng khi làm thực tế.
```graphql
query GetUser($id: ID!) {
  user(id: $id) {
    id
    displayName
    posts {
      title
    }
  }
}
```
```json
{ "id": 1 }
```
Nếu gọi bằng curl thì body sẽ như sau
```sh
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "query GetUser($id: ID!) { user(id: $id) { id displayName posts { title } } }", "variables": {"id": 1}}'
```
```json
{
  "data": {
    "user": {
      "id": "1",
      "displayName": "Nolan <nolan@example.com>",
      "posts": [
        { "title": "Hello GraphQL" }
      ]
    }
  }
}
```

Đó chính là điểm hay của GraphQL: cùng một endpoint, client muốn lấy field nào thì lấy field đó, backend không cần viết thêm API mới.

Bài tiếp theo sẽ là <mark>Mutation</mark>, tức là tạo và sửa dữ liệu.
