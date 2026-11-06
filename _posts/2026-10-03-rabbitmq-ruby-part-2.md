---
layout: post
title:  "078. RabbitMQ with Ruby (Exchange & Dead letter)."
date:   2026-10-03 01:02:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_078/rabbitmq-exchange.png
---
Bài trước chúng ta gửi message thẳng vào queue. Thực ra RabbitMQ luôn gửi message qua **exchange**, chỉ là chúng ta đang dùng exchange mặc định. Bài này nói về các loại exchange, và cách xử lý message lỗi.

#### Bài toán
Khi có order mới, nhiều bên cần biết:
- Service email: gửi email xác nhận.
- Service kho: trừ hàng tồn.
- Service thống kê: ghi nhận doanh thu.

Shop chỉ nên gửi **một** message <mark>order.created</mark>, không cần biết có những ai đang nghe.

#### 3 loại exchange

| Loại | Cách chuyển message |
|---|---|
| **fanout** | Gửi tới **tất cả** queue đã bind, bỏ qua routing key |
| **direct** | Gửi tới queue có binding key **trùng khớp** với routing key |
| **topic** | Như direct nhưng có wildcard: <mark>*</mark> là một từ, <mark>#</mark> là nhiều từ |

Topic exchange linh hoạt nhất, nên tôi hay dùng loại này.

#### Producer
```ruby
# app/services/order_event_publisher.rb

class OrderEventPublisher
  EXCHANGE = "orders"

  def self.publish(event, payload)
    RabbitMQ.connection.with_channel do |channel|
      exchange = channel.topic(EXCHANGE, durable: true)
      exchange.publish(payload.to_json, routing_key: event, persistent: true)
    end
  end
end
```
```ruby
OrderEventPublisher.publish("order.created", { order_id: order.id })
OrderEventPublisher.publish("order.cancelled", { order_id: order.id })
```
Producer chỉ biết exchange <mark>orders</mark>, không biết gì về queue.

#### Consumer
Mỗi service tạo queue của riêng mình, rồi **bind** vào exchange với routing key mà nó quan tâm.
```ruby
channel = RabbitMQ.connection.create_channel
exchange = channel.topic("orders", durable: true)

# service email: chỉ quan tâm order mới
email_queue = channel.queue("email.orders", durable: true)
email_queue.bind(exchange, routing_key: "order.created")

# service kho: quan tâm tất cả sự kiện của order
inventory_queue = channel.queue("inventory.orders", durable: true)
inventory_queue.bind(exchange, routing_key: "order.*")
```

| Routing key | <mark>email.orders</mark> | <mark>inventory.orders</mark> |
|---|---|---|
| <mark>order.created</mark> | Nhận | Nhận |
| <mark>order.cancelled</mark> | Không | Nhận |

Sau này có thêm service thống kê, chỉ cần tạo thêm queue và bind vào, không phải sửa code của shop. Phần <mark>subscribe</mark> thì giống y bài trước.

#### Dead letter queue
Bài trước có một vấn đề: message lỗi do data sai sẽ bị đưa lại queue và thử lại mãi mãi. Cách xử lý là **dead letter queue** (DLQ): message lỗi sẽ được chuyển sang một queue riêng để xem xét sau.
```ruby
channel = RabbitMQ.connection.create_channel

# 1. exchange và queue để chứa message lỗi
dlx = channel.fanout("email.orders.dlx", durable: true)
channel.queue("email.orders.dead", durable: true).bind(dlx)

# 2. queue chính, khai báo dead letter exchange
queue = channel.queue("email.orders", durable: true, arguments: {
  "x-dead-letter-exchange" => "email.orders.dlx"
})
queue.bind(channel.topic("orders", durable: true), routing_key: "order.created")

queue.subscribe(manual_ack: true, block: true) do |delivery_info, _properties, body|
  OrderMailer.confirmation(JSON.parse(body)["order_id"]).deliver_now
  channel.ack(delivery_info.delivery_tag)
rescue StandardError => e
  Rails.logger.error("Failed: #{e.message}")
  channel.nack(delivery_info.delivery_tag, false, false) # không requeue
end
```
- <mark>x-dead-letter-exchange</mark>: message bị nack với <mark>requeue = false</mark> sẽ được chuyển tới exchange này.
- Message lỗi sẽ nằm trong queue <mark>email.orders.dead</mark>. Các bro có thể xem trên trang quản lý, fix lỗi rồi đưa lại vào queue chính.

Lưu ý: RabbitMQ **không cho phép đổi arguments** của queue đã tồn tại, sẽ báo lỗi <mark>PRECONDITION_FAILED</mark>. Nếu queue <mark>email.orders</mark> đã được tạo ở bước trước, cần xóa nó trên trang quản lý rồi chạy lại.

#### Retry trước khi bỏ vào DLQ
Có những lỗi tạm thời, ví dụ server mail đang bận, thử lại sau vài giây là được. Với RabbitMQ 4, nên dùng **quorum queue**, loại queue này có sẵn giới hạn số lần giao lại message.
```ruby
queue = channel.queue("email.orders", durable: true, arguments: {
  "x-queue-type" => "quorum",
  "x-delivery-limit" => 3,
  "x-dead-letter-exchange" => "email.orders.dlx"
})
```
Lúc này khi lỗi, cứ <mark>nack</mark> với <mark>requeue = true</mark>. Message sẽ được thử lại, quá 3 lần thì tự động chuyển sang DLQ.

Quorum queue cũng được RabbitMQ khuyên dùng cho production vì an toàn hơn queue thường khi chạy cluster.

#### Tóm tắt series RabbitMQ
- Producer gửi message vào **exchange**, exchange chuyển tới **queue**, consumer lấy từ queue.
- Luôn dùng <mark>durable</mark>, <mark>persistent</mark>, <mark>manual_ack</mark> để không mất message.
- Dùng **topic exchange** khi nhiều service cùng cần một sự kiện.
- Dùng **DLQ** để message lỗi không bị mất mà cũng không thử lại mãi mãi.

Bài tiếp theo chúng ta chuyển sang Kafka.
