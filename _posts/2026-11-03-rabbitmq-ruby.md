---
layout: post
title:  "077. RabbitMQ with Ruby (Queue)."
date:   2026-11-03 01:00:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_077/rabbitmq-queue.png
---
Bài này chúng ta làm ví dụ đơn giản nhất với RabbitMQ: app Rails gửi message vào một queue, một consumer lấy ra và gửi email.

#### Version sử dụng
- Ruby 3.4, Rails 8
- RabbitMQ 4
- gem <mark>bunny</mark>: client RabbitMQ phổ biến nhất cho Ruby

#### Chạy RabbitMQ
```sh
docker run -d --name rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:4-management
```
- <mark>5672</mark>: port để app kết nối (giao thức **AMQP**).
- <mark>15672</mark>: trang quản lý ở <mark>http://localhost:15672</mark>, đăng nhập bằng <mark>guest/guest</mark>. Ở đây các bro có thể xem queue, số message, consumer...

#### Kết nối
```sh
bundle add bunny
```
Mở connection tốn tài nguyên, nên cả app chỉ dùng chung một connection.
```ruby
# config/initializers/rabbitmq.rb

module RabbitMQ
  def self.connection
    @connection ||= Bunny.new(ENV.fetch("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")).tap(&:start)
  end
end
```

#### Producer
```ruby
# app/services/email_publisher.rb

class EmailPublisher
  QUEUE = "emails"

  def self.publish(payload)
    RabbitMQ.connection.with_channel do |channel|
      queue = channel.queue(QUEUE, durable: true)
      queue.publish(payload.to_json, persistent: true, content_type: "application/json")
    end
  end
end
```
- **Channel**: một kết nối "ảo" bên trong connection. Channel **không thread-safe**, nên với Puma nhiều thread, cách đơn giản là mỗi lần publish mở một channel bằng <mark>with_channel</mark>, xong tự đóng.
- <mark>channel.queue</mark>: khai báo queue, chưa có thì RabbitMQ tạo mới.
- <mark>durable: true</mark>: queue vẫn còn khi RabbitMQ restart.
- <mark>persistent: true</mark>: message được ghi xuống đĩa, không mất khi RabbitMQ restart. Cần cả 2 thì message mới an toàn.

Gửi message ở bất kỳ đâu trong app
```ruby
EmailPublisher.publish({ type: "welcome", user_id: user.id })
```
Nếu gửi message sau khi lưu DB, nên dùng <mark>after_create_commit</mark> thay vì <mark>after_create</mark>, để chắc chắn consumer đọc DB thì data đã có.

#### Consumer
Consumer chạy ở một process riêng, giống cách chạy gRPC server ở series trước.
```ruby
#!/usr/bin/env ruby
# bin/email_consumer

require_relative "../config/environment"

channel = RabbitMQ.connection.create_channel
channel.prefetch(10)
queue = channel.queue("emails", durable: true)

puts "Waiting for messages..."

queue.subscribe(manual_ack: true, block: true) do |delivery_info, _properties, body|
  payload = JSON.parse(body)
  user = User.find(payload["user_id"])
  UserMailer.welcome(user).deliver_now

  channel.ack(delivery_info.delivery_tag)
rescue StandardError => e
  Rails.logger.error("Email consumer failed: #{e.message}")
  channel.nack(delivery_info.delivery_tag, false, true)
end
```
```sh
chmod +x bin/email_consumer
bin/email_consumer
```

#### Ack
Đây là phần quan trọng nhất:
- <mark>manual_ack: true</mark>: consumer phải tự báo cho RabbitMQ khi đã xử lý xong.
- <mark>channel.ack</mark>: xử lý thành công, RabbitMQ xóa message.
- <mark>channel.nack(tag, false, true)</mark>: xử lý lỗi, tham số cuối <mark>true</mark> là đưa message **trở lại queue** để thử lại.
- Nếu consumer bị crash giữa chừng mà chưa ack, RabbitMQ sẽ tự giao message cho consumer khác. Nhờ vậy message không bị mất.

Lưu ý: nack rồi đưa lại queue như trên, nếu lỗi là do data sai thì message sẽ bị thử lại mãi mãi. Bài sau chúng ta sẽ xử lý chuyện này bằng **dead letter queue**.

#### Prefetch
<mark>channel.prefetch(10)</mark>: mỗi consumer chỉ được nhận tối đa 10 message chưa ack. Không set thì RabbitMQ sẽ đẩy hết message cho consumer đầu tiên, các consumer khác ngồi chơi.

#### Scale
Message nhiều quá xử lý không kịp? Chỉ cần chạy thêm consumer
```sh
bin/email_consumer # terminal 1
bin/email_consumer # terminal 2
```
RabbitMQ sẽ tự chia đều message cho các consumer, mỗi message chỉ được giao cho **một** consumer.

Vậy là xong cơ bản. Bài tiếp theo sẽ về **exchange**: làm sao để một message được gửi tới nhiều queue khác nhau, và xử lý message lỗi.
