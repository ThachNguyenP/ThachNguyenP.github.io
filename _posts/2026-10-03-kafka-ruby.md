---
layout: post
title:  "079. Kafka with Ruby (Karafka)."
date:   2026-10-03 01:04:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_079/kafka-karafka.png
---
Sau RabbitMQ, giờ tới Kafka. Với Ruby, gem phổ biến và đầy đủ nhất là <mark>karafka</mark>, tích hợp rất tốt với Rails.

#### Các khái niệm cơ bản
- **Topic**: nơi chứa message, giống tên một kênh. Ví dụ <mark>orders</mark>.
- **Partition**: mỗi topic được chia thành nhiều partition, giúp nhiều consumer xử lý song song.
- **Offset**: số thứ tự của message trong một partition, consumer dùng nó để nhớ mình đã đọc tới đâu.
- **Consumer group**: một nhóm consumer cùng đọc một topic. Mỗi message chỉ được xử lý bởi **một** consumer trong nhóm. Các nhóm khác nhau đọc độc lập với nhau.

```sh
Topic: orders
  Partition 0: [msg0][msg1][msg2][msg3] ...
  Partition 1: [msg0][msg1][msg2] ...
  Partition 2: [msg0][msg1] ...
                               ↑
                      offset của consumer
```

#### Version sử dụng
- Ruby 3.4, Rails 8
- Kafka 4 (không cần ZooKeeper nữa, dùng **KRaft**)
- gem <mark>karafka</mark> 2.x

#### Chạy Kafka
```sh
docker run -d --name kafka -p 9092:9092 apache/kafka:latest
```
Image chính thức của Apache đã cấu hình sẵn để chạy 1 node ở <mark>localhost:9092</mark>, đủ cho local.

#### Cài đặt Karafka
```sh
bundle add karafka
bundle exec karafka install
```
Lệnh install tạo ra:
- <mark>karafka.rb</mark>: file cấu hình chính, nằm ở thư mục gốc.
- <mark>app/consumers/application_consumer.rb</mark>: base class cho các consumer.

#### Cấu hình và routing
```ruby
# karafka.rb

class KarafkaApp < Karafka::App
  setup do |config|
    config.kafka = { "bootstrap.servers": ENV.fetch("KAFKA_BROKERS", "127.0.0.1:9092") }
    config.client_id = "shop_app"
    config.consumer_persistence = !Rails.env.development?
  end

  routes.draw do
    topic :orders do
      config(partitions: 3)
      consumer OrdersConsumer
    end
  end
end
```
- <mark>routes.draw</mark>: giống <mark>routes.rb</mark> của Rails, khai báo topic nào được xử lý bởi consumer nào.
- <mark>config(partitions: 3)</mark>: topic <mark>orders</mark> có 3 partition.
- <mark>consumer_persistence</mark>: tắt ở development để code được reload khi sửa.

Tạo topic trên Kafka theo khai báo trong routes
```sh
bundle exec karafka topics migrate
```

#### Producer
Karafka có sẵn producer (tên là **WaterDrop**), dùng ở bất kỳ đâu trong app.
```ruby
# app/models/order.rb

class Order < ApplicationRecord
  after_create_commit :publish_created_event

  private

  def publish_created_event
    Karafka.producer.produce_async(
      topic: "orders",
      key: id.to_s,
      payload: { event: "order.created", order_id: id, total: total }.to_json
    )
  end
end
```
- <mark>produce_async</mark>: gửi ở background, không làm chậm request. Nếu cần chắc chắn message đã tới Kafka mới làm tiếp thì dùng <mark>produce_sync</mark>.
- <mark>key</mark>: quyết định message vào partition nào. Bài sau sẽ nói rõ hơn.

#### Consumer
```ruby
# app/consumers/orders_consumer.rb

class OrdersConsumer < ApplicationConsumer
  def consume
    messages.each do |message|
      payload = message.payload
      Rails.logger.info("Received #{payload['event']} for order #{payload['order_id']}")

      # xử lý logic ở đây
    end
  end
end
```
- Karafka nhận message theo **batch**, nên <mark>messages</mark> là một danh sách.
- <mark>message.payload</mark>: Karafka tự parse JSON cho chúng ta.
- Xử lý xong cả batch, Karafka tự lưu lại **offset**. Lần sau chạy lại sẽ đọc tiếp từ chỗ cũ.

#### Chạy
```sh
bundle exec karafka server
```
Mở <mark>rails console</mark> ở terminal khác, tạo một order, sẽ thấy consumer in log ngay.

Ngoài ra Karafka có trang **Web UI** để xem topic, consumer, lỗi... Các bro có thể tìm hiểu thêm trong docs của Karafka.

#### Đọc lại từ đầu
Đây là điểm khác biệt lớn so với RabbitMQ: message đã đọc rồi vẫn còn trong Kafka. Nếu thêm một service mới, ví dụ thống kê, chỉ cần tạo một consumer group mới, nó có thể đọc lại toàn bộ order từ đầu topic (trong thời gian Kafka còn giữ message, mặc định là 7 ngày).

Bài tiếp theo sẽ nói về partition, consumer group, và xử lý khi consumer bị lỗi.
