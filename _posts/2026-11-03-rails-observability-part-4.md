---
layout: post
title:  "074. Observability (Tracing with OpenTelemetry)."
date:   2026-11-03 00:45:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_074/observability-tracing.png
---
Phần cuối trong series Observability. Metrics báo API <mark>GET /orders</mark> chậm, nhưng chậm vì query DB, vì gọi Redis, hay vì gọi sang một service khác? **Tracing** sẽ trả lời câu hỏi này.

#### Trace và Span
- **Trace**: toàn bộ hành trình của một request, có thể đi qua nhiều service.
- **Span**: một bước nhỏ trong trace, ví dụ: một query SQL, một lần gọi HTTP. Mỗi span có thời gian bắt đầu, kết thúc, và có thể chứa các span con.

Một trace sẽ trông như thế này
```sh
GET /orders/1                                    [=========================] 320ms
  ├─ SELECT orders                               [=]                          5ms
  ├─ SELECT line_items                           [=]                          4ms
  ├─ calculate_shipping                            [==================]     250ms
  │    └─ POST https://shipping-api/fee              [=================]    245ms
  └─ render json                                                        [=]  8ms
```
Nhìn vào là biết ngay: 250ms nằm ở chỗ gọi API tính phí ship.

#### OpenTelemetry
**OpenTelemetry** (OTel) là chuẩn mở cho observability, được hầu hết các nền tảng hỗ trợ: Jaeger, Grafana Tempo, Datadog, New Relic, Honeycomb... Viết code theo OTel một lần, sau này đổi nền tảng chỉ cần đổi cấu hình.

Ở local, chúng ta dùng **Jaeger** để xem trace.
```sh
docker run -d --name jaeger -p 16686:16686 -p 4318:4318 jaegertracing/jaeger:latest
```
- <mark>4318</mark>: port nhận dữ liệu theo giao thức **OTLP** (HTTP).
- <mark>16686</mark>: giao diện web của Jaeger.

#### Cài đặt
```sh
bundle add opentelemetry-sdk opentelemetry-exporter-otlp opentelemetry-instrumentation-all
```
```ruby
# config/initializers/opentelemetry.rb

require "opentelemetry/sdk"
require "opentelemetry/exporter/otlp"
require "opentelemetry/instrumentation/all"

OpenTelemetry::SDK.configure do |c|
  c.service_name = "shop-api"
  c.use_all # tự động trace Rails, ActiveRecord, Net::HTTP, Faraday, Redis, Sidekiq...
end
```
Địa chỉ gửi trace được cấu hình bằng biến môi trường
```sh
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 bin/rails s
```
Gọi vài API, rồi mở <mark>http://localhost:16686</mark>, chọn service <mark>shop-api</mark> và bấm **Find Traces**. Các bro sẽ thấy từng request với đầy đủ các span: controller, query SQL, HTTP call... mà không cần viết thêm dòng code nào.

#### Tự tạo span
Phần tự động chỉ trace được các thư viện. Với logic của mình, ví dụ hàm tính phí ship, cần tự tạo span.
```ruby
# app/services/shipping_calculator.rb

class ShippingCalculator
  TRACER = OpenTelemetry.tracer_provider.tracer("shop-api")

  def call(order)
    TRACER.in_span("calculate_shipping", attributes: { "order.id" => order.id }) do |span|
      fee = ShippingApi.fee(order)
      span.set_attribute("shipping.fee", fee)
      fee
    end
  end
end
```
- <mark>in_span</mark>: tạo span, đo thời gian của cả block. Nếu trong block có exception, span sẽ được đánh dấu lỗi.
- <mark>attributes</mark>: thêm thông tin để dễ tìm kiếm, giá trị chỉ nên là string, số hoặc boolean.

#### Trace qua nhiều service
Đây là lúc tracing thực sự tỏa sáng. Khi service A gọi sang service B bằng <mark>Net::HTTP</mark> hay <mark>Faraday</mark>, OTel sẽ tự gắn header <mark>traceparent</mark> vào request. Nếu service B cũng cài OTel, nó đọc header này và nối tiếp vào **cùng một trace**.

Kết quả là trên Jaeger, các bro sẽ thấy một trace đi xuyên qua cả 2 service. Với microservices (như các service gọi nhau bằng gRPC ở series trước), đây gần như là cách duy nhất để biết request chậm ở service nào. Instrumentation cho gRPC cũng có sẵn trong <mark>opentelemetry-instrumentation-all</mark>.

#### Nối log với trace
Thêm <mark>trace_id</mark> vào log ở bài 071, từ một dòng log lỗi các bro có thể tìm ngay ra trace tương ứng.
```ruby
# config/initializers/lograge.rb

config.lograge.custom_options = lambda do |event|
  {
    request_id: event.payload[:request_id],
    trace_id: OpenTelemetry::Trace.current_span.context.hex_trace_id
  }
end
```

#### Sampling
Ở production, trace hết 100% request sẽ rất tốn tài nguyên và chi phí lưu trữ. Thường chỉ lấy mẫu một phần, cấu hình bằng biến môi trường
```sh
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1 # 10% request
```
<mark>parentbased</mark> nghĩa là nếu service phía trước đã chọn trace request này, thì service phía sau cũng sẽ trace theo, để trace không bị đứt đoạn.

#### Tổng kết
Qua 4 bài, chúng ta đã có đủ bộ công cụ để quan sát một ứng dụng Rails trên production:

| Bài | Công cụ | Trả lời câu hỏi |
|---|---|---|
| 071 | lograge | Chuyện gì đã xảy ra? |
| 072 | Sentry | Có lỗi gì, ở dòng code nào? |
| 073 | Prometheus, Grafana | Hệ thống có khỏe không? |
| 074 | OpenTelemetry, Jaeger | Request chậm ở đâu? |

Nếu dự án nhỏ, chưa cần làm hết, thì thứ tự ưu tiên của tôi là: **Sentry** trước tiên, sau đó tới **structured log**, rồi mới tới **metrics** và **tracing** khi hệ thống lớn dần.
