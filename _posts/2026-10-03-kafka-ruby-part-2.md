---
layout: post
title:  "080. Kafka with Ruby (Partition, Consumer group & Retry)."
date:   2026-10-03 01:06:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_080/kafka-partition.png
---
Phần cuối trong series message broker. Bài này giải thích 3 thứ hay gây nhầm lẫn nhất khi mới dùng Kafka: thứ tự message, cách scale consumer, và xử lý lỗi.

#### Thứ tự message và key
Kafka chỉ đảm bảo thứ tự **trong cùng một partition**. Message nằm ở các partition khác nhau có thể được xử lý theo bất kỳ thứ tự nào.

Ví dụ order 1 có 2 sự kiện <mark>order.created</mark> rồi <mark>order.paid</mark>. Nếu chúng rơi vào 2 partition khác nhau, consumer có thể xử lý <mark>order.paid</mark> trước, khi order còn chưa được tạo.

Giải pháp là dùng **key**. Message có cùng key luôn được đưa vào **cùng một partition**.
```ruby
Karafka.producer.produce_async(
  topic: "orders",
  key: order.id.to_s,
  payload: { event: "order.paid", order_id: order.id }.to_json
)
```
- Dùng <mark>order.id</mark> làm key: các sự kiện của cùng một order luôn đúng thứ tự.
- Không có key: message được chia đều ngẫu nhiên, không đảm bảo thứ tự.

Chọn key là thứ cần suy nghĩ kỹ: nên là thứ cần giữ thứ tự (order, user...), và đủ đa dạng để message được chia đều vào các partition.

#### Consumer group và scale
Nhắc lại: trong một consumer group, **mỗi partition chỉ được đọc bởi một consumer**.

Topic <mark>orders</mark> có 3 partition:

| Số consumer | Phân chia |
|---|---|
| 1 | Consumer 1 đọc cả 3 partition |
| 3 | Mỗi consumer đọc 1 partition |
| 5 | 3 consumer làm việc, **2 consumer ngồi chơi** |

Vì vậy, **số partition là giới hạn số consumer chạy song song**. Muốn scale lên 10 consumer thì topic cần ít nhất 10 partition. Khi tạo topic nên dự tính trước, vì tăng partition sau này sẽ làm thay đổi việc phân chia key.

Muốn chạy thêm consumer, chỉ cần chạy thêm process
```sh
bundle exec karafka server # terminal 1
bundle exec karafka server # terminal 2
```
Kafka tự chia lại partition giữa các consumer, việc này gọi là **rebalance**.

#### Nhiều consumer group
Mỗi service là một consumer group riêng, cùng đọc topic <mark>orders</mark> mà không ảnh hưởng nhau. Trong Karafka, các bro có thể khai báo nhiều consumer group trong cùng một app
```ruby
# karafka.rb

routes.draw do
  consumer_group :email_service do
    topic :orders do
      consumer OrderEmailConsumer
    end
  end

  consumer_group :analytics_service do
    topic :orders do
      consumer OrderAnalyticsConsumer
    end
  end
end
```
Mỗi message <mark>orders</mark> sẽ được xử lý bởi **cả** <mark>OrderEmailConsumer</mark> **và** <mark>OrderAnalyticsConsumer</mark>, mỗi bên tự quản lý offset của mình. Giống topic exchange của RabbitMQ ở bài 078, nhưng đơn giản hơn nhiều.

#### Khi consumer bị lỗi
Nếu <mark>consume</mark> raise exception, Karafka sẽ:
1. Không lưu offset, tạm dừng partition đó.
2. Đợi một lúc rồi thử lại batch đó, thời gian chờ tăng dần sau mỗi lần lỗi.

Vấn đề là nếu lỗi do data sai, consumer sẽ bị kẹt mãi ở message đó, và **tất cả message phía sau trong partition cũng bị kẹt** vì Kafka xử lý theo thứ tự. Đây là chỗ khác RabbitMQ: một message lỗi có thể chặn cả partition.

#### Dead letter queue
Giải pháp vẫn là DLQ. Với Karafka chỉ cần một dòng trong routes
```ruby
# karafka.rb

routes.draw do
  topic :orders do
    config(partitions: 3)
    consumer OrdersConsumer
    dead_letter_queue(topic: "orders_dlq", max_retries: 3)
  end

  topic :orders_dlq do
    active false # chỉ tạo topic, không consume
  end
end
```
- Thử lại tối đa 3 lần, vẫn lỗi thì Karafka chuyển message đó sang topic <mark>orders_dlq</mark>, rồi **đi tiếp** message sau.
- <mark>active false</mark>: chỉ để <mark>karafka topics migrate</mark> tạo topic, chúng ta sẽ xem và xử lý lại sau bằng tay.

#### Xử lý trùng lặp
Kafka (và cả RabbitMQ) đảm bảo **at-least-once**: message chắc chắn được xử lý, nhưng có thể **bị xử lý hơn một lần**, ví dụ khi consumer crash sau khi xử lý xong nhưng trước khi lưu offset.

Vì vậy consumer nên được viết sao cho xử lý 2 lần cũng không sao (**idempotent**). Cách đơn giản là kiểm tra trước khi làm
```ruby
class OrderEmailConsumer < ApplicationConsumer
  def consume
    messages.each do |message|
      order = Order.find(message.payload["order_id"])
      next if order.confirmation_sent_at.present? # đã gửi rồi thì bỏ qua

      OrderMailer.confirmation(order).deliver_now
      order.update!(confirmation_sent_at: Time.current)
    end
  end
end
```

#### Tổng kết series

| | RabbitMQ | Kafka |
|---|---|---|
| Gửi | Exchange + routing key | Topic + key |
| Nhiều bên cùng nhận | Mỗi bên một queue, bind vào exchange | Mỗi bên một consumer group |
| Scale consumer | Chạy thêm consumer | Chạy thêm consumer, tối đa bằng số partition |
| Thứ tự | Theo queue | Theo partition (dùng key) |
| Message lỗi | DLX / quorum queue | <mark>dead_letter_queue</mark> |

Dù dùng cái nào, hãy nhớ 2 điều: luôn có **DLQ** cho message lỗi, và viết consumer **idempotent**.
