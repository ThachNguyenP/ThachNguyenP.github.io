---
layout: post
title:  "073. Observability (Metrics with Prometheus & Grafana)."
date:   2026-11-03 00:40:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_073/observability-metrics.png
---
Log cho biết từng chuyện đã xảy ra, còn **metrics** là các con số theo thời gian, cho biết tổng thể hệ thống đang thế nào: mỗi giây có bao nhiêu request, tỉ lệ lỗi bao nhiêu phần trăm, API phản hồi mất bao lâu...

#### Các thành phần
- **Rails app**: đếm và expose các con số ở endpoint <mark>/metrics</mark>.
- **Prometheus**: cứ vài giây lại gọi vào <mark>/metrics</mark> để lấy số liệu và lưu lại. Việc này gọi là **scrape**.
- **Grafana**: vẽ dashboard từ dữ liệu của Prometheus.

Ở phía Rails, chúng ta dùng bộ gem <mark>yabeda</mark>, cách dùng khá đơn giản.

#### Các loại metric
| Loại | Ý nghĩa | Ví dụ |
|---|---|---|
| **Counter** | Chỉ tăng, không giảm | Tổng số request, tổng số order |
| **Gauge** | Tăng giảm tùy lúc | Số job đang chờ, số connection |
| **Histogram** | Phân bố giá trị | Thời gian phản hồi của request |

#### Cài đặt
```sh
bundle add yabeda-rails yabeda-prometheus
```
Mount endpoint <mark>/metrics</mark>
```ruby
# config/routes.rb

Rails.application.routes.draw do
  mount Yabeda::Prometheus::Exporter, at: "/metrics"
  # ...
end
```
Start server và mở <mark>http://localhost:3000/metrics</mark>, sau khi gọi vài API sẽ thấy các dòng như sau
```sh
rails_requests_total{controller="orders",action="index",status="200",format="json",method="get"} 15.0
rails_request_duration_seconds_bucket{controller="orders",action="index",...,le="0.1"} 12.0
```
<mark>yabeda-rails</mark> đã tự đo sẵn cho chúng ta:
- <mark>rails_requests_total</mark>: số request theo controller, action, status.
- <mark>rails_request_duration_seconds</mark>: thời gian xử lý request.
- <mark>rails_db_runtime_seconds</mark>, <mark>rails_view_runtime_seconds</mark>: thời gian query DB và render.

#### Metric cho business
Metric không chỉ dành cho kỹ thuật. Ví dụ đếm số order được tạo, khai báo trong initializer
```ruby
# config/initializers/yabeda.rb

Yabeda.configure do
  group :shop do
    counter :orders_created_total,
            comment: "Total number of created orders",
            tags: %i[payment_method]
  end
end
```
Rồi tăng counter ở chỗ tạo order
```ruby
Yabeda.shop.orders_created_total.increment({ payment_method: order.payment_method })
```
Lưu ý: **tags chỉ nên có ít giá trị**, như <mark>payment_method</mark>, <mark>status</mark>. Đừng bao giờ đưa <mark>user_id</mark> hay <mark>order_id</mark> vào tags, mỗi giá trị khác nhau sẽ tạo ra một chuỗi dữ liệu mới, làm Prometheus phình to rất nhanh.

#### Chạy Prometheus và Grafana
Dùng Docker cho nhanh
```yaml
# compose.yaml

services:
  prometheus:
    image: prom/prometheus
    ports:
      - "9090:9090"
    volumes:
      - ./prometheus.yml:/etc/prometheus/prometheus.yml
    extra_hosts:
      - "host.docker.internal:host-gateway"

  grafana:
    image: grafana/grafana
    ports:
      - "3001:3000" # Rails đã dùng port 3000
```
```yaml
# prometheus.yml

scrape_configs:
  - job_name: rails
    scrape_interval: 15s
    static_configs:
      - targets: ["host.docker.internal:3000"]
```
```sh
docker compose up -d
```
- Vào <mark>http://localhost:9090/targets</mark>, thấy target <mark>rails</mark> là **UP** là Prometheus đã lấy được dữ liệu.
- Vào Grafana ở <mark>http://localhost:3001</mark> (user/pass mặc định là <mark>admin/admin</mark>), thêm **Data source** là Prometheus với URL <mark>http://prometheus:9090</mark>.

#### Query với PromQL
Prometheus dùng ngôn ngữ query riêng là **PromQL**. Đây là 3 query quan trọng nhất, tạo mỗi query một panel trong Grafana là có ngay dashboard cơ bản.

Số request mỗi giây
```promql
sum(rate(rails_requests_total[5m]))
```
Tỉ lệ lỗi 5xx
```promql
sum(rate(rails_requests_total{status=~"5.."}[5m]))
  / sum(rate(rails_requests_total[5m]))
```
95% request được xử lý trong bao lâu (p95)
```promql
histogram_quantile(0.95, sum(rate(rails_request_duration_seconds_bucket[5m])) by (le))
```
- <mark>rate(...[5m])</mark>: tốc độ tăng trung bình mỗi giây trong 5 phút gần nhất.
- **p95** tốt hơn thời gian trung bình: trung bình 100ms nhưng p95 là 3s nghĩa là cứ 20 user thì có 1 người phải chờ 3s.

Ba con số này (**Rate, Errors, Duration**) thường được gọi tắt là **RED**, chỉ cần theo dõi 3 con số này là đã nắm được phần lớn sức khỏe của một API.

#### Lưu ý khi lên production
- **Không public <mark>/metrics</mark> ra internet.** Chỉ cho Prometheus gọi trong mạng nội bộ, hoặc chặn bằng basic auth, giống cách chúng ta bảo vệ trang Swagger ở series Grape.
- Nếu Puma chạy nhiều **worker** (cluster mode), mỗi worker là một process riêng, cần cấu hình thêm để gom số liệu. Xem thêm gem <mark>yabeda-puma-plugin</mark> và phần **multi-process** trong docs của <mark>yabeda-prometheus</mark>.
- Có thể cài thêm <mark>yabeda-sidekiq</mark> để theo dõi job, <mark>yabeda-activerecord</mark> để theo dõi connection pool.

Metrics cho biết API đang chậm, nhưng chậm ở đâu: DB, Redis hay gọi sang service khác? Bài cuối chúng ta sẽ trả lời câu hỏi đó với **tracing**.
