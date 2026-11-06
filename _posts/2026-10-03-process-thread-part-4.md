---
layout: post
title:  "103. Process & Thread (Puma, Sidekiq & Solid Queue)."
date:   2026-10-03 01:44:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_103/process-thread-puma.png
---
Đã hiểu process, thread và GVL, giờ xem chúng được dùng như thế nào trong một ứng dụng Rails thật, và quan trọng hơn: **chọn số workers, threads, pool bao nhiêu**.

#### Puma
Puma kết hợp cả 2: nhiều **process** (gọi là worker) để dùng nhiều core, mỗi process có nhiều **thread** để xử lý request trong lúc chờ IO.
```
Puma master (không xử lý request, chỉ quản lý worker)
├── Worker 1 (process) ── thread 1, thread 2, thread 3
├── Worker 2 (process) ── thread 1, thread 2, thread 3
├── Worker 3 (process) ── thread 1, thread 2, thread 3
└── Worker 4 (process) ── thread 1, thread 2, thread 3
                          => tối đa 12 request cùng lúc
```
File cấu hình mặc định của Rails 8 (rút gọn)
```ruby
# config/puma.rb

threads_count = ENV.fetch("RAILS_MAX_THREADS", 3)
threads threads_count, threads_count

port ENV.fetch("PORT", 3000)
```
Mặc định chỉ có thread, chạy 1 process (gọi là **single mode**). Để chạy nhiều worker (**cluster mode**)
```ruby
# config/puma.rb

workers ENV.fetch("WEB_CONCURRENCY", 1)
preload_app!
```

#### Chọn số worker
Mỗi worker là một process, chạy được trên một core riêng. Quy tắc đơn giản:
- **workers = số core CPU** mà server có.
- Nhưng giới hạn bởi **RAM**: mỗi worker của một app Rails trung bình tốn 300 - 600MB. Server 4 core, 2GB RAM thì chỉ chạy nổi khoảng 3 worker.

<mark>preload_app!</mark> giúp tiết kiệm RAM: master load toàn bộ app (gem, code Rails) **trước** rồi mới <mark>fork</mark> ra worker. Nhờ copy-on-write (bài 100), phần bộ nhớ chưa bị sửa được dùng chung giữa các worker. Đổi lại, khi deploy phải restart cả master (không dùng được phased restart).

Có một việc cần chú ý khi fork: kết nối database, Redis... mở ở master sẽ bị **dùng chung** bởi các worker và gây lỗi. Rails đã tự xử lý cho ActiveRecord. Với kết nối tự tạo, mở lại sau khi fork
```ruby
# config/puma.rb

on_worker_boot do
  # ví dụ client Redis tự tạo trong initializer
  MyRedis.reconnect
end
```

#### Chọn số thread
Như bài 101, thread giúp ích khi request chờ IO, nhưng quá nhiều thread thì phải xếp hàng chờ GVL, request chậm đi.
- App gọi nhiều API bên ngoài, query chậm (nhiều IO): tăng thread, 5 có thể ổn.
- App tính toán nhiều, render JSON lớn: giảm thread, 2 - 3.

Rails mặc định **3**, là điểm khởi đầu tốt. Muốn chỉnh thì đo: nếu thời gian chờ GVL cao (có thể xem bằng gem <mark>gvl_timing</mark> hay các APM như Datadog, New Relic), giảm thread và tăng worker.

#### Database connection pool
Đây là chỗ hay sai nhất. Mỗi thread khi chạy query cần **một kết nối** database. Kết nối được lấy từ **pool** của process đó.
```yaml
# config/database.yml

default: &default
  adapter: postgresql
  pool: <%= ENV.fetch("RAILS_MAX_THREADS") { 5 } %>
```
Pool là **trong mỗi process**, nên:
- <mark>pool</mark> phải **lớn hơn hoặc bằng** số thread của process đó. Nhỏ hơn thì thread phải chờ, sau 5 giây sẽ lỗi <mark>ActiveRecord::ConnectionTimeoutError</mark>.
- Tổng số kết nối tới database = **số process × pool**.

Ví dụ: 3 server, mỗi server 4 worker, mỗi worker pool 3 → **36 kết nối**. Cộng thêm Sidekiq, console, migration... PostgreSQL mặc định chỉ cho <mark>max_connections = 100</mark>. Scale lên 10 server là hết kết nối. Lúc đó cần tăng <mark>max_connections</mark> hoặc dùng **PgBouncer**.

Nếu code có tự tạo thread bên trong request (ví dụ gọi song song như bài 102) mà các thread đó cũng query database, cần tính thêm vào pool.

#### Sidekiq
Sidekiq mặc định chạy **1 process** với nhiều **thread** (<mark>concurrency</mark>, mặc định 5).
```yaml
# config/sidekiq.yml

:concurrency: 10
:queues:
  - critical
  - default
```
Job thường là IO-bound (gửi email, gọi API, webhook) nên dùng nhiều thread rất hiệu quả. Nhưng:
- Nhớ đặt <mark>pool</mark> của database **≥ concurrency** cho process Sidekiq: <mark>RAILS_MAX_THREADS=10 bundle exec sidekiq</mark>.
- Job nặng CPU (resize ảnh, xuất báo cáo) thì nhiều thread không giúp gì, còn làm job khác chậm theo. Tách ra queue riêng và chạy **thêm process** Sidekiq cho queue đó, với concurrency thấp.

```sh
bundle exec sidekiq -q default -q mailers -c 10
bundle exec sidekiq -q reports -c 2
```
- Code trong job phải **thread-safe** (bài 102), vì 10 job chạy cùng lúc trong một process.

#### Solid Queue
Solid Queue (mặc định trong Rails 8) có một **supervisor** process, fork ra các process **worker**, mỗi worker có nhiều thread. Cấu hình cả số process lẫn số thread cho từng nhóm queue
```yaml
# config/queue.yml

production:
  dispatchers:
    - polling_interval: 1
      batch_size: 500
  workers:
    - queues: [ default, mailers ]
      threads: 5
      processes: 2
    - queues: reports
      threads: 1
      processes: 2
```
Queue <mark>default</mark>, <mark>mailers</mark> (IO-bound): 2 process × 5 thread. Queue <mark>reports</mark> (CPU-bound): 2 process × 1 thread. Đúng với những gì đã rút ra ở bài 101.

#### Một ví dụ tính toán
Server 4 core, 8GB RAM, app Rails tốn khoảng 500MB mỗi process:
- Puma: **4 worker × 3 thread** = 12 request cùng lúc, khoảng 2GB RAM.
- Sidekiq: **2 process × 10 thread**, khoảng 1GB RAM.
- Kết nối DB: Puma 4 × 3 = 12, Sidekiq 2 × 10 = 20, tổng **32**, cộng dự phòng cho console, cron.

Đây chỉ là điểm bắt đầu. Sau khi chạy thật, nhìn vào CPU, RAM, thời gian chờ GVL, thời gian chờ kết nối DB để điều chỉnh (xem series Observability, bài 071 - 074).

#### Tóm tắt

| Thành phần | Process | Thread | Ghi chú |
|---|---|---|---|
| Puma | <mark>workers</mark> = số core (giới hạn bởi RAM) | <mark>threads</mark> = 3, tăng nếu nhiều IO | <mark>preload_app!</mark> để tiết kiệm RAM |
| Sidekiq | Thêm process cho queue nặng CPU | <mark>concurrency</mark> 5 - 10 | Job phải thread-safe |
| Solid Queue | <mark>processes</mark> | <mark>threads</mark> | Cấu hình riêng cho từng nhóm queue |
| Database | | <mark>pool</mark> ≥ số thread mỗi process | Tổng = process × pool < <mark>max_connections</mark> |
