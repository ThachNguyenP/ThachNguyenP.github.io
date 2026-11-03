---
layout: post
title:  "072. Observability (Error tracking with Sentry)."
date:   2026-11-03 00:35:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_072/observability-sentry.png
---
Bài trước chúng ta đã có log. Nhưng đọc log để tìm lỗi thì quá mệt. Cái chúng ta cần là: **có lỗi thì được báo ngay**, kèm đầy đủ thông tin để fix. Đó là việc của **Sentry**.

#### Sentry làm được gì
- Tự bắt tất cả exception chưa được xử lý.
- Gom các lỗi giống nhau thành một **issue**, không spam.
- Mỗi lỗi có đủ: stack trace, request, params, user, môi trường, version code.
- Gửi thông báo qua email, Slack khi có lỗi mới.

Sentry có bản cloud (free cho cá nhân), hoặc có thể tự host. Nếu muốn tự host nhẹ hơn thì có <mark>GlitchTip</mark>, dùng chung SDK với Sentry.

#### Cài đặt
Tạo project trên Sentry, chọn platform **Rails**, lấy **DSN** (một URL dạng <mark>https://xxx@xxx.ingest.sentry.io/123</mark>).
```sh
bundle add sentry-ruby sentry-rails
```
```ruby
# config/initializers/sentry.rb

Sentry.init do |config|
  config.dsn = ENV["SENTRY_DSN"]
  config.environment = Rails.env
  config.release = ENV["GIT_COMMIT_SHA"]

  config.breadcrumbs_logger = [:active_support_logger, :http_logger]

  # không gửi IP, cookie... của user
  config.send_default_pii = false

  # dùng cho performance monitoring, 0.1 = 10% request
  config.traces_sample_rate = 0.1
end
```
- <mark>dsn</mark>: không có DSN thì Sentry sẽ không gửi gì cả. Vì vậy chỉ cần set biến <mark>SENTRY_DSN</mark> ở production, staging là local sẽ không bị gửi lỗi lên.
- <mark>release</mark>: version code, giúp biết lỗi xuất hiện từ lần deploy nào.
- <mark>breadcrumbs_logger</mark>: ghi lại những gì xảy ra trước khi lỗi (query, HTTP call...), rất hữu ích khi debug.

#### Test
```sh
SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/123 bin/rails runner 'Sentry.capture_message("Hello Sentry")'
```
Vào Sentry, các bro sẽ thấy message vừa gửi.

Hoặc tạo một action raise lỗi
```ruby
def show
  raise "Something went wrong"
end
```
Gọi API, lỗi sẽ xuất hiện trên Sentry kèm stack trace, chỉ rõ file và dòng code.

#### Thêm thông tin user
Biết lỗi xảy ra với user nào sẽ giúp debug nhanh hơn rất nhiều.
```ruby
# app/controllers/application_controller.rb

class ApplicationController < ActionController::API
  before_action :set_sentry_context

  private

  def set_sentry_context
    Sentry.set_user(id: current_user.id) if current_user
  end
end
```
Chỉ nên gửi <mark>id</mark>, không gửi email, số điện thoại hay các thông tin cá nhân khác.

#### Lỗi đã được rescue
Sentry chỉ tự bắt các lỗi **chưa được xử lý**. Nếu các bro đã <mark>rescue</mark> để trả về response đẹp cho FE, thì Sentry sẽ không biết. Trường hợp đó cần gửi lỗi thủ công.
```ruby
def charge
  PaymentService.charge(order)
rescue PaymentService::Error => e
  Sentry.capture_exception(e, extra: { order_id: order.id })
  render json: { message: "Payment failed" }, status: :unprocessable_entity
end
```
Ngược lại, có những lỗi không cần báo, ví dụ <mark>ActiveRecord::RecordNotFound</mark> (404). <mark>sentry-rails</mark> đã mặc định bỏ qua một số lỗi kiểu này, muốn bỏ qua thêm thì dùng <mark>excluded_exceptions</mark>
```ruby
# config/initializers/sentry.rb

config.excluded_exceptions += ["Pundit::NotAuthorizedError"]
```

#### Background job
Với Sidekiq, chỉ cần thêm gem, lỗi trong job sẽ tự được gửi lên Sentry, kèm tên job và arguments.
```sh
bundle add sentry-sidekiq
```
Còn ActiveJob (bao gồm Solid Queue) thì <mark>sentry-rails</mark> đã hỗ trợ sẵn.

#### Một vài kinh nghiệm
- **Đừng để quá nhiều lỗi tồn đọng.** Lỗi nào không cần quan tâm thì ignore, lỗi nào cần thì fix. Nếu Sentry có hàng ngàn issue thì không ai thèm nhìn nữa.
- **Cấu hình alert vào Slack** của team, lỗi mới là biết ngay.
- **Luôn set <mark>release</mark>**, để khi deploy xong mà lỗi tăng đột biến thì biết ngay là do lần deploy nào.

Sentry báo cho chúng ta khi có lỗi. Nhưng có những vấn đề không phải lỗi: API chậm dần, request tăng đột biến... Bài tiếp theo sẽ về **metrics** để theo dõi những thứ này.
