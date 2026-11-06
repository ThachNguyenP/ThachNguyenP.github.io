---
layout: post
title:  "076. Message broker (RabbitMQ vs Kafka)."
date:   2026-10-03 00:55:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_076/message-broker.png
---
Series này về 2 message broker phổ biến nhất hiện nay: **RabbitMQ** và **Kafka**. Bài đầu tiên chưa có code, chỉ giúp các bro hiểu chúng là gì và khi nào dùng cái nào.

#### Message broker là gì
Bình thường service A muốn service B làm gì đó thì gọi API trực tiếp. Cách này có vài vấn đề:
- B đang chết hoặc chậm thì A cũng bị ảnh hưởng.
- A phải biết B, C, D là ai để gọi, càng nhiều service càng rối.
- Đột nhiên có 10.000 request cùng lúc thì B có thể bị quá tải.

**Message broker** đứng ở giữa: A chỉ cần gửi **message** vào broker rồi đi làm việc khác. B lấy message ra xử lý khi nào sẵn sàng.
```sh
Producer (A)  --->  [ Message broker ]  --->  Consumer (B)
```
- **Producer**: bên gửi message.
- **Consumer**: bên nhận và xử lý message.

Nếu các bro đã dùng Sidekiq (bài Setup Sidekiq) thì đã quen ý tưởng này rồi: Rails đẩy job vào Redis, Sidekiq lấy ra xử lý. Khác biệt là Sidekiq dành cho **job nội bộ** của một app Rails, còn message broker dùng để **các service khác nhau**, có thể viết bằng các ngôn ngữ khác nhau, nói chuyện với nhau.

#### RabbitMQ
RabbitMQ hoạt động như một **bưu điện**:
- Message được gửi tới **exchange**, exchange dựa vào quy tắc để chuyển tới đúng **queue**.
- Consumer lấy message từ queue, xử lý xong thì báo **ack**, và message **bị xóa** khỏi queue.
- Mỗi message thường chỉ được xử lý bởi **một** consumer.

Phù hợp cho: gửi email, xử lý đơn hàng, các task cần làm đúng một lần, cần routing linh hoạt.

#### Kafka
Kafka hoạt động như một **cuốn sổ ghi chép** (log):
- Message được ghi nối tiếp vào **topic**, và được **giữ lại** trong một khoảng thời gian (ví dụ 7 ngày), kể cả khi đã được đọc.
- Mỗi consumer tự nhớ mình đã đọc tới đâu (**offset**).
- Nhiều nhóm consumer khác nhau có thể cùng đọc một topic, mỗi nhóm đọc độc lập. Thậm chí có thể **đọc lại** từ đầu.

Phù hợp cho: event streaming, tracking, log, dữ liệu lớn, nhiều service cùng cần một luồng sự kiện.

#### So sánh

| | RabbitMQ | Kafka |
|---|---|---|
| Mô hình | Queue, message bị xóa sau khi xử lý | Log, message được giữ lại |
| Đọc lại message cũ | Không | Có |
| Routing | Rất linh hoạt (exchange) | Đơn giản (theo topic) |
| Thông lượng | Cao | Rất cao (hàng triệu message/giây) |
| Thứ tự message | Theo queue | Theo partition |
| Vận hành | Đơn giản | Phức tạp hơn |
| Gem Ruby | <mark>bunny</mark> | <mark>karafka</mark>, <mark>rdkafka</mark> |

Tóm lại theo kinh nghiệm của tôi:
- Cần giao việc cho service khác làm (**task**): chọn **RabbitMQ**.
- Cần phát một sự kiện cho nhiều bên cùng biết, lưu lại lịch sử (**event**): chọn **Kafka**.
- Dự án nhỏ, chỉ có một app Rails: chưa cần cả 2, Sidekiq hoặc Solid Queue là đủ.

#### Series gồm
1. Message broker: RabbitMQ vs Kafka (bài này)
2. RabbitMQ: queue, producer, consumer
3. RabbitMQ: exchange và dead letter queue
4. Kafka: topic, producer, consumer với Karafka
5. Kafka: partition, consumer group, retry
