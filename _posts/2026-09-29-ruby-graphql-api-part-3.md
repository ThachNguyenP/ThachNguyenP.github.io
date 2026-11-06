---
layout: post
title:  "063. Making api with GraphQL (Mutation)."
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_063/graphql-mutation.png
---
Query dùng để đọc, còn muốn tạo, sửa, xóa dữ liệu thì dùng <mark>Mutation</mark>.

#### Mutation tạo user
Mỗi mutation là một class riêng, đặt trong thư mục <mark>app/graphql/mutations</mark>.
```ruby
# app/graphql/mutations/create_user.rb

module Mutations
  class CreateUser < BaseMutation
    # input
    argument :name, String
    argument :email, String

    # output
    field :user, Types::UserType
    field :errors, [String], null: false

    def resolve(name:, email:)
      user = User.new(name:, email:)

      if user.save
        { user:, errors: [] }
      else
        { user: nil, errors: user.errors.full_messages }
      end
    end
  end
end
```
- <mark>argument</mark>: những gì client gửi lên.
- <mark>field</mark>: những gì trả về cho client.
- <mark>resolve</mark>: nơi xử lý logic, phải trả về một hash có key trùng với các field ở trên.

Ở đây tôi trả lỗi validate trong field <mark>errors</mark> để FE dễ hiển thị cho người dùng, giống <mark>response_error</mark> trong series Grape.

Khai báo mutation vào <mark>MutationType</mark>
```ruby
# app/graphql/types/mutation_type.rb

module Types
  class MutationType < Types::BaseObject
    field :create_user, mutation: Mutations::CreateUser
  end
end
```

#### Test
<mark>BaseMutation</mark> do generator tạo ra kế thừa từ <mark>GraphQL::Schema::RelayClassicMutation</mark>, nên tất cả argument sẽ được gói trong một object <mark>input</mark>.
```graphql
mutation {
  createUser(input: { name: "Ronaldo", email: "cr7@example.com" }) {
    user {
      id
      name
    }
    errors
  }
}
```
```json
{
  "data": {
    "createUser": {
      "user": { "id": "3", "name": "Ronaldo" },
      "errors": []
    }
  }
}
```
Thử bỏ trống email (giả sử model có <mark>validates :email, presence: true</mark>)
```json
{
  "data": {
    "createUser": {
      "user": null,
      "errors": ["Email can't be blank"]
    }
  }
}
```

#### Mutation sửa user
Tương tự, chỉ khác là các field cần sửa là optional.
```ruby
# app/graphql/mutations/update_user.rb

module Mutations
  class UpdateUser < BaseMutation
    argument :id, ID
    argument :name, String, required: false
    argument :email, String, required: false

    field :user, Types::UserType
    field :errors, [String], null: false

    def resolve(id:, **attributes)
      user = User.find(id)

      if user.update(attributes)
        { user:, errors: [] }
      else
        { user: nil, errors: user.errors.full_messages }
      end
    end
  end
end
```
```ruby
# app/graphql/types/mutation_type.rb

field :update_user, mutation: Mutations::UpdateUser
```

#### Xử lý lỗi not found
Ở trên, nếu <mark>User.find(id)</mark> không tìm thấy thì sẽ raise <mark>ActiveRecord::RecordNotFound</mark> và server trả về 500. Để trả về lỗi chuẩn GraphQL, chúng ta dùng <mark>rescue_from</mark> trong schema.
```ruby
# app/graphql/graphql_sample_schema.rb

class GraphqlSampleSchema < GraphQL::Schema
  mutation(Types::MutationType)
  query(Types::QueryType)

  rescue_from(ActiveRecord::RecordNotFound) do |_error|
    raise GraphQL::ExecutionError, "Record not found"
  end

  # ...
end
```
Response lúc này
```json
{
  "data": { "updateUser": null },
  "errors": [
    {
      "message": "Record not found",
      "path": ["updateUser"]
    }
  ]
}
```

Tóm lại có 2 loại lỗi:
- **Lỗi nghiệp vụ** (validate, sai input): trả về trong field <mark>errors</mark> của mutation để FE hiển thị.
- **Lỗi hệ thống** (not found, không có quyền...): raise <mark>GraphQL::ExecutionError</mark>, lỗi sẽ nằm trong <mark>errors</mark> ở ngoài cùng của response.

Bài cuối của series sẽ về phân trang và vấn đề N+1 query trong GraphQL.
