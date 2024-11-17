---
layout: post
title:  "011.Making api with grape (Hello world)."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_011/ruby_grape_cover.png
---
Thực ra vẫn thích và quen dùng rails + active_model_serializer hơn, nhưng cty hiện tại đang dùng Grape nên là làm một bài luôn. Nếu quan tâm về tốc độ thì Grape nhanh hơn.
#### Vài đường cơ bản
Đầu tiên cứ tạo một project rails api bình thường.
```ruby
rails _7.0.7.2_ new grape-sample --api --database=postgresql
```
Rồi các bạn setup DB, env như bình thường để có thể start lên giao diện mọi người đứng trên quả địa cầu, bên trên có chữ <mark>Yay!You're on Rails!</mark>.

Thêm gem <mark>'grape'</mark> vào Gemfile và bundle install

Giờ chúng ta thử viết một api <mark>health_check</mark>, đại loại sẽ như thế này
```ruby
# app/controllers/health_check.rb

class HealthCheck < Grape::API
  get 'health_check' do
    status :ok
    content_type 'text/plain'
    body 'Hello World'
  end
end
```
Và khai báo ở router như thế này
```ruby
# config/routes.rb

Rails.application.routes.draw do
  mount HealthCheck => '/'
end
```
Xong rồi đó các bro, giờ thì các bro đã có thể start server và check ở<mark>http://localhost:3000/health_check</mark> để xem kết quả.
