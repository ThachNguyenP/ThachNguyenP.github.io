---
layout: post
title:  "012.Making api with grape (route)"
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_011/ruby_grape_cover.png
---
Tiếp theo phần Grape cơ bản, post này nói về các khai báo route trong ruby grape.

#### Refactor lại route
Sau bài basic trước, các bro sẽ thắc mắc là nếu nhiều api hơn thì chúng ta làm thế nào. Tạo thêm nhiều hàm hơn trong file <mark>health_check.rb</mark>? Hay là tạo thêm nhiều file tương tự <mark>health_check.rb</mark> rồi add vào trong file <mark>routes.rb</mark>?

Cả 2 cách đều chạy được, nhưng ở đây, chúng ta không làm thế.

Với Rails, chúng ta sử dụng <mark>mount</mark> để tạo dựng route. Lấy hướng dẫn của tác giả thư viện làm mẫu, chúng ta sẽ khai báo tất cả các <mark>mount</mark> ở trong các file <mark>base.rb</mark>, sau đó <mark>base.rb</mark> ngoài cùng (root base) sẽ được khai báo trong file <mark>routes.rb</mark>
Giờ cây thư mục của chúng ta sẽ như thế này.

```md
app
  |––controllers
       |––api
           |––v1
               |––base.rb
               |––users
                   |––base.rb
                   |––index.rb
                   |––show.
                   |––create.rb
                   |––destroy.rb
               |––posts
                   |––base.rb
                   |––index.rb
                   |––show.
                   |––create.rb
                   |––destroy.rb
```
Theo như các bro đang thấy thì có thêm layer <mark>api</mark> và <mark>v1</mark> dùng để đánh dấu, có thể sẽ có thêm <mark>web</mark> hoặc <mark>v2</mark>, <mark>v3</mark> nữa, tùy vào yêu cầu dự án. Nhưng mà với các dự án trong cty của tôi thì chỉ có vậy thôi.

Đầu tiên, sửa lại <mark>routes.rb</mark>, root base giờ nằm ở bên trong thư mục api, không còn trực tiếp trong thư mục controllers nữa.

```Ruby
# config/routes.rb

Rails.application.routes.draw do
  mount API::V1::Base, at: "/"
end
```

Root base sẽ như thế này
```Ruby
#app/controller/api/v1/base.rb

module API
  module V1
    class Base < Grape::API
      include API::V1::Version

      mount API::V1::Users::Base
      # mount API::V1::Posts::Base
    end
  end
end
```

Base ở module sẽ như thế này
```Ruby
#app/controller/api/v1/users/base.rb

module API::V1::Users
  class Base < Grape::API
    resource :users do
      mount API::V1::Users::Index
      # mount API::V1::Users::Show
      # mount API::V1::Users::Create
      # mount API::V1::Users::Destroy
    end
  end
end
```

Ớ mà khoan, đặt tên thư mục là <mark>api</mark> thì module sẽ là <mark>Api::Base</mark> chứ không phải là <mark>API::Base</mark>. Giờ không lẽ phải đặt tên thư mục là <mark>a_p_i</mark>.
Tới lúc này, các bro mở cái file <mark>config/initializers/inflections.rb</mark> ra, thêm như sau
```Ruby
ActiveSupport::Inflector.inflections(:en) do |inflect|
  inflect.acronym 'API'
end
```

Giờ là lúc làm cái version <mark>v1</mark> kia hoạt động, trong folder <mark>v1</mark>, các bro tạo một file <mark>version.rb</mark>. Version sẽ được include vào trong root base

```Ruby
module API
  module V1
    module Version
      extend ActiveSupport::Concern

      included do
        prefix 'api'
        version 'v1', using: :path
      end
    end
  end
end
```

Để xem thử flow của chúng ta có hoạt động không, giờ hãy xóa file <mark>health_check.rb</mark> đi và viết lại một file <mark>users/index.rb</mark>.
```Ruby
# app/controllers/api/v1/users/index.rb

module API::V1::Users
  class Index < Grape::API
    get '' do
      status :ok
      content_type 'text/plain'
      body 'Hello World'
    end
  end
end

```
Nếu ở <mark>http://localhost:3000/api/v1/users</mark> trả về data, tức là route của chúng ta đã hoạt động.
