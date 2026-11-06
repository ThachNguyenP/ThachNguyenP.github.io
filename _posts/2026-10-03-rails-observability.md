---
layout: post
title:  "071. Observability (Logging)."
date:   2026-10-03 00:30:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_071/observability-logging.png
---
Code chạy ngon ở local, deploy lên production thì user báo lỗi, API chậm, mà mình không biết chuyện gì đang xảy ra. Series này nói về **Observability**: làm sao để "nhìn thấy" bên trong ứng dụng khi nó đang chạy trên production.

#### Observability là gì
Observability thường được chia thành 3 phần, hay gọi là **3 pillars**:

| Pillar | Trả lời câu hỏi | Ví dụ công cụ |
|---|---|---|
| **Logs** | Chuyện gì đã xảy ra? | lograge, Loki, ELK, CloudWatch |
| **Metrics** | Hệ thống đang khỏe hay yếu? | Prometheus, Grafana |
| **Traces** | Request này chậm ở đâu? | OpenTelemetry, Jaeger |

Ngoài ra còn có **Error tracking** (Sentry), cái này gần như dự án nào cũng nên có.

Series gồm 4 bài:
1. Logging (bài này)
2. Error tracking với Sentry
3. Metrics với Prometheus và Grafana
4. Tracing với OpenTelemetry

Version sử dụng: Ruby 3.4, Rails 8.

#### Vấn đề với log mặc định của Rails
Mỗi request, Rails ghi ra nhiều dòng log như thế này
```sh
Started GET "/orders/1" for 127.0.0.1 at 2026-11-03 10:00:00 +0700
Processing by OrdersController#show as JSON
  Parameters: {"id"=>"1"}
  Order Load (0.5ms)  SELECT "orders".* FROM "orders" WHERE "orders"."id" = $1 LIMIT $2
Completed 200 OK in 12ms (Views: 3.1ms | ActiveRecord: 0.5ms)
```
Đọc bằng mắt thì dễ, nhưng khi có hàng trăm request mỗi giây:
- 1 request bị chia thành nhiều dòng, xen kẽ với các request khác, rất khó theo dõi.
- Là text tự do, nên các công cụ quản lý log khó tìm kiếm, lọc theo <mark>status</mark> hay <mark>duration</mark>.

Giải pháp là **structured logging**: mỗi request chỉ là **một dòng JSON**.

#### Cài đặt lograge
```sh
bundle add lograge
```
```ruby
# config/initializers/lograge.rb

Rails.application.configure do
  config.lograge.enabled = true
  config.lograge.formatter = Lograge::Formatters::Json.new

  # thêm field tùy ý vào mỗi dòng log
  config.lograge.custom_options = lambda do |event|
    {
      time: Time.current.iso8601,
      request_id: event.payload[:request_id],
      user_id: event.payload[:user_id],
      params: event.payload[:params].except("controller", "action")
    }
  end
end
```
<mark>request_id</mark> và <mark>user_id</mark> không có sẵn trong <mark>event.payload</mark>, chúng ta cần tự thêm vào ở controller
```ruby
# app/controllers/application_controller.rb

class ApplicationController < ActionController::API
  def append_info_to_payload(payload)
    super
    payload[:request_id] = request.request_id
    payload[:user_id] = current_user&.id
  end
end
```
Nếu project chưa có <mark>current_user</mark> thì bỏ dòng đó đi nhé các bro.

Giờ mỗi request chỉ còn một dòng
```json
{"method":"GET","path":"/orders/1","format":"json","controller":"OrdersController","action":"show","status":200,"allocations":2195,"duration":12.4,"view":3.1,"db":0.5,"time":"2026-11-03T10:00:00+07:00","request_id":"8f3c2a1e-...","user_id":1,"params":{"id":"1"}}
```
Có <mark>status</mark>, <mark>duration</mark>, <mark>db</mark>... dạng field riêng, nên trên công cụ log có thể lọc ngay kiểu: "tất cả request có <mark>status >= 500</mark>", hoặc "request có <mark>duration > 1000</mark> ms".

#### Đừng log thông tin nhạy cảm
Vì chúng ta log cả <mark>params</mark>, cần chắc chắn password, token không bị ghi ra. Rails đã có sẵn <mark>filter_parameters</mark>, kiểm tra lại file này
```ruby
# config/initializers/filter_parameter_logging.rb

Rails.application.config.filter_parameters += [
  :passw, :email, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc
]
```
Lograge dùng params đã được filter, nên password sẽ hiện ra là <mark>[FILTERED]</mark>.

#### Log trong business logic
Ngoài log request, đôi khi cần log những sự kiện quan trọng trong code. Cũng nên log dạng JSON để dễ tìm kiếm.
```ruby
Rails.logger.info(
  { event: "order.paid", order_id: order.id, amount: order.total }.to_json
)
```
Đặt tên <mark>event</mark> theo một quy tắc thống nhất (ví dụ <mark>resource.action</mark>), sau này tìm kiếm sẽ rất dễ.

#### Log level
- <mark>debug</mark>: chi tiết, chỉ dùng ở local.
- <mark>info</mark>: các sự kiện bình thường.
- <mark>warn</mark>: có gì đó bất thường nhưng app vẫn chạy được.
- <mark>error</mark>: có lỗi cần xử lý.

Production nên để <mark>info</mark>, Rails 8 đã cho phép đổi bằng biến môi trường
```ruby
# config/environments/production.rb

config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info")
```

#### Gửi log đi đâu?
Rails 8 ở production mặc định ghi log ra <mark>STDOUT</mark>. Đây là cách đúng khi chạy bằng Docker, Kamal hay Kubernetes: app chỉ việc ghi ra STDOUT, còn việc thu thập và lưu trữ là của hạ tầng (CloudWatch, Grafana Loki, Datadog...).

Có log rồi, nhưng không lẽ ngày nào cũng ngồi đọc log để tìm lỗi? Bài tiếp theo chúng ta sẽ dùng Sentry để được báo lỗi ngay khi nó xảy ra.
