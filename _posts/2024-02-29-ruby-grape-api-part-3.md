---
layout: post
title:  "013.Making api with grape (Entity)."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_011/ruby_grape_cover.png
---
Phần này về cơ bản giúp các bạn dựng serializer, nôm na là làm sao để định dạng cục json được trả ra.

Chúng ta sẽ sử dụng gem <mark>grape-enity</mark> cho phần này.

#### Cách dùng cơ bản nhất

Dĩ nhiên, đầu tiên là khai báo gem <mark>'grape-enity'</mark> vào Gemfile và bundle install

Cách sử dụng Entity cũng khá tương đồng với ActiveModelSerializer, tôi sẽ đặt tất cả entity vào thư mục <mark>app/controllers/entities/v1</mark>. Các bạn thích đặt ở đâu cũng ổn cả.

Giờ hãy viết một file entity cho user, trả về <mark>id</mark> và <mark>name</mark>.

```ruby
# app/controllers/api/entities/v1/user_entity.rb

module API::Entities::V1::UserEntity
  class Index < Grape::Entity
    expose :id
    expose :name
  end
end
```
Để có data user, hãy tạo một table users và model cho nó
```sh
rails g migration CreateUsers name:string country:string
rails db:migrate
```
```ruby
# app/models/user.rb

class User < ApplicationRecord
end
```
Insert một ít data vào, và giờ thì ở controller, chúng ta đã có thể sử dụng entity phía trên để trả về dữ liệu rồi

```ruby
# app/controllers/api/v1/users/index.rb

module API::V1::Users
  class Index < Grape::API
    get '' do
      status :ok
      content_type 'application/json'
      users = User.limit(2)
      API::Entities::V1::UserEntity::Index.represent(users)
    end
  end
end

```

Gọi api để kiểm tra kết quả

```json
[
    {
        "id": 1,
        "name": "Nolan"
    },
    {
        "id": 2,
        "name": "Messi"
    }
]
```
#### Phân trang
Thêm gem <mark>kaminari</mark> để phân trang nhé các bro.

```ruby
# Gemfile
gem 'kaminari'
```

Để có thể hoàn thiện chức năng paging, chúng ta cần trả thêm một số field như total_pages, current_page ...

Hiện tại thì format trả về của cty tôi nó là thế này, những field cần thể hiển thị UI phân trang sẽ nằm trong <mark>metadata</mark>

```json
{
    "metadata": {
        "total_count": 19,
        "total_pages": 10,
        "next_page": 2,
        "prev_page": 0,
        "current_page": 1,
        "current_per_page": 2
    },
    "message": "Success",
    "code": 2000,
    "status": true,
    "data": [
        {
            "name": "Nolan",
            "id": 1
        },
        {
            "name": "Messi",
            "id": 2
        }
    ]
}
```
Và để trả ra vừa data, vừa có metadata, giờ chúng ta sẽ viết thêm một <mark>PresenterHelper</mark> và khai báo vào trong <mark>base</mark>

```ruby
# app/controller/api/helpers/presenter_helper.rb

module API::Helpers::PresenterHelper
  def response_data(data, message, metadata)
    status(200)
    {metadata:, message:, code: 2000, status: true, data:}
  end

  def present_pagination(collection)
    {
      total_count: collection.total_count,
      total_pages: collection.total_pages,
      next_page: collection.next_page || 0,
      prev_page: collection.prev_page || 0,
      current_page: collection.current_page,
      current_per_page: collection.current_per_page
    }
  end
end
```

```ruby
#app/controller/api/v1/base.rb

module API
  module V1
    class Base < Grape::API
      include API::V1::Version

      helpers API::Helpers::PresenterHelper

      mount API::V1::Users::Base
      # mount API::V1::Posts::Base
    end
  end
end
```
Giờ thì trong controller, đã có thể dùng hàm response_data để trả về data kèm theo metadata

```ruby
# app/controllers/api/v1/users/index.rb

module API::V1::Users
  class Index < Grape::API
    params do
      optional :page, type: String
      optional :per_page, type: String
    end

    get '' do
      status :ok
      content_type 'application/json'
      users = User.all.page(params[:page]).per(params[:per_page])
      response_data(
        API::Entities::V1::UserEntity::Index.represent(users),
        'Success',
        present_pagination(users)
      )
    end
  end
end

```

#### Errors
Tương tự response_data, chúng ta có thể viết thêm một số hàm để render error, cái này cũng gặp khá thường xuyên, khi bạn cần trả về lỗi cho FE hiển thị tới người dùng.

```ruby
# app/controller/api/helpers/presenter_helper.rb

module API::Helpers::PresenterHelper
  def response_data(data, message, metadata)
    status(200)
    {metadata:, message:, code: 2000, status: true, data:}
  end

  def response_message(message, messages, status_code, code)
    status(status_code)
    {message:, messages:, code:, status: true}
  end

  def response_error(message, messages, status_code, code)
    status(status_code)
    {message:, messages:, code:, status: false}
  end
end
```
