---
layout: post
title:  "061. Making api with GraphQL (Hello world)."
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_061/graphql-hello-world.png
---
Sau series Grape, lần này tới lượt GraphQL. Series này sẽ đi từ cơ bản tới mức đủ dùng cho một dự án Rails API.

#### GraphQL là gì
Với REST (hay Grape), mỗi resource có nhiều endpoint: <mark>GET /users</mark>, <mark>GET /users/1</mark>, <mark>POST /users</mark>... và server quyết định trả về những field nào.

Với GraphQL thì ngược lại:
- Chỉ có **một endpoint** duy nhất, thường là <mark>POST /graphql</mark>.
- **Client tự chọn field** cần lấy, không thừa không thiếu.
- Mọi thứ được định nghĩa bằng **Schema** có type rõ ràng.

Có 2 loại operation chính:
- <mark>Query</mark>: đọc dữ liệu (giống GET).
- <mark>Mutation</mark>: thay đổi dữ liệu (giống POST/PUT/DELETE).

#### Version sử dụng
- Ruby 3.4
- Rails 8
- gem <mark>graphql</mark> 2.5

#### Cài đặt
Tạo một project rails api bình thường.
```sh
rails new graphql-sample --api
cd graphql-sample
```

Thêm gem <mark>graphql</mark> và chạy generator của nó.
```sh
bundle add graphql
rails generate graphql:install
```

Generator sẽ tạo ra cho chúng ta khá nhiều file, những file quan trọng là:

```sh
app
  |––controllers
       |––graphql_controller.rb      # nhận request ở /graphql
  |––graphql
       |––graphql_sample_schema.rb   # Schema, nơi khai báo query, mutation
       |––types
           |––query_type.rb          # root của tất cả các query
           |––mutation_type.rb       # root của tất cả các mutation
           |––base_object.rb ...     # các base class
       |––mutations
           |––base_mutation.rb
```

Và một route trong <mark>config/routes.rb</mark>
```ruby
post "/graphql", to: "graphql#execute"
```

Vì là project <mark>--api</mark> nên generator sẽ bỏ qua <mark>GraphiQL</mark> (UI để test query trên browser). Không sao, chúng ta sẽ dùng curl hoặc Postman.

#### Query đầu tiên
Mở file <mark>query_type.rb</mark>, xóa hết phần sample và viết field <mark>hello</mark>
```ruby
# app/graphql/types/query_type.rb

module Types
  class QueryType < Types::BaseObject
    field :hello, String, null: false, description: "Say hello"

    def hello
      "Hello World"
    end
  end
end
```
Giải thích một chút:
- <mark>field :hello</mark>: khai báo một field tên là hello.
- <mark>String</mark>: kiểu dữ liệu trả về.
- <mark>null: false</mark>: field này luôn có giá trị, không bao giờ null.
- Method <mark>hello</mark> cùng tên với field chính là **resolver**, nơi trả về dữ liệu.

#### Test
Start server bằng <mark>rails s</mark>, rồi gọi thử
```sh
curl -X POST http://localhost:3000/graphql \
  -H "Content-Type: application/json" \
  -d '{"query": "{ hello }"}'
```
Kết quả
```json
{
  "data": {
    "hello": "Hello World"
  }
}
```

Để ý là response luôn được bọc trong <mark>data</mark>, và nếu có lỗi thì sẽ nằm trong <mark>errors</mark>. Đây là format chuẩn của GraphQL, các bro không cần tự định nghĩa như với Grape.

Ngoài curl, Postman cũng hỗ trợ GraphQL rất tốt: tạo request mới, chọn kiểu **GraphQL**, nhập URL <mark>http://localhost:3000/graphql</mark>, Postman sẽ tự đọc schema và gợi ý field cho các bro.

Bài tiếp theo chúng ta sẽ làm việc với dữ liệu thật: tạo <mark>Type</mark> cho model và viết query lấy danh sách users.
