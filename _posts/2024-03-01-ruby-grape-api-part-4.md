---
layout: post
title:  "014.Making api with grape (Swagger)."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_011/ruby_grape_cover.png
---
Phần cuối trong series grape, hướng dẫn các bạn cách tạo trang **api document**.
#### Setup api document page
Ở các bài trước, vì chúng ta tạo một project rails api, nên ngoài các gem cần thiết thì giờ cần thêm <mark>sprockets</mark> để có thể render được UI
```ruby
gem 'grape-swagger',                '1.4.2'
gem 'grape-swagger-entity',         '0.5.1'
gem 'grape-swagger-rails',          '0.3.1'
gem 'grape-swagger-representable',  '0.2.2'
gem 'grape-swagger-ui',             '2.2.8'
gem 'sprockets-rails',              '3.4.2'
```
Giờ thì import vào trong <mark>config/application.rb</mark>

```ruby
# config/application.rb

require "sprockets/railtie"
```

Tạo một file <mark>app/assets/config/manifest.js</mark> nếu chưa có
```js
//= link grape_swagger_rails/application.css
//= link grape_swagger_rails/application.js
```

Phần còn lại thì config như dự án Rails bình thường

```ruby
# app/controllers/api/v1/base.rb

add_swagger_documentation(
  api_version: 'v1',
  hide_documentation_path: true,
  mount_path: '/api/v1/swagger_doc',
  hide_format: true,
  info: {
    title: 'My project documentation',
    description: 'Phase 1 API'
  }
)
```

```ruby
# config/routes.rb

Rails.application.routes.draw do
  mount API::V1::Base => '/'
  mount GrapeSwaggerRails::Engine, at: '/documentation'
end
```

```ruby
# app/initializers/swagger.rb

GrapeSwaggerRails.options.url      = 'api/v1/swagger_doc'
GrapeSwaggerRails.options.app_name = 'Grape sample'
GrapeSwaggerRails.options.app_url  = '/'
```
Trang api sẽ được render ở <mark>http://localhost:3000/documentation</mark>

#### Secure trang api document với basic authen
Tất nhiên là bạn cần gửi trang document này tới chỗ dev Mobile hoặc FE, nhưng cũng không thể để người ngoài vào xem được. Để lộ cấu trúc params và response sẽ làm services của chúng ta dễ bị hack hơn.

Trong vài cách thì tôi chọn basic authen.
```ruby
# config/routes.rb

Rails.application.routes.draw do
  mount API::V1::Base => '/'
  GrapeSwaggerRails::Engine.middleware.use Rack::Auth::Basic do |username, password|
    username == ENV['BASIC_AUTHEN'] && password == ENV['BASIC_AUTHEN']
  end
  mount GrapeSwaggerRails::Engine, at: '/documentation'
end
```
