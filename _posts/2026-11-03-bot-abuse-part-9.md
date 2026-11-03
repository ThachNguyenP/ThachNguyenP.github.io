---
layout: post
title:  "093. Bot & Abuse protection (Webhook, Replay attack & SSRF)."
date:   2026-11-03 01:24:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_093/bot-abuse-webhook.png
---
Phần cuối của series Bot & Abuse. Bài này về 3 lỗ hổng hay gặp khi app làm việc với hệ thống bên ngoài: **webhook giả mạo**, **replay attack** và **SSRF**.

#### Webhook giả mạo
Cổng thanh toán gọi webhook <mark>POST /webhooks/payment</mark> để báo đơn hàng đã thanh toán. Endpoint này phải public để bên ngoài gọi được. Vậy nếu kẻ gian tự gọi vào với nội dung "order 123 đã thanh toán" thì sao? Không kiểm tra là giao hàng miễn phí.

Các dịch vụ thường giải quyết bằng **chữ ký HMAC**: bên gửi dùng một **secret** chung để ký nội dung, gửi kèm chữ ký trong header. Bên nhận ký lại bằng cùng secret rồi so sánh.
```ruby
# app/controllers/webhooks/payments_controller.rb

class Webhooks::PaymentsController < ApplicationController
  TOLERANCE = 5.minutes

  def create
    return head :unauthorized unless valid_signature?

    event = JSON.parse(request.raw_post)
    # xử lý event...
    head :ok
  end

  private

  def valid_signature?
    timestamp = request.headers["X-Webhook-Timestamp"].to_i
    signature = request.headers["X-Webhook-Signature"].to_s

    # từ chối request quá cũ
    return false if (Time.current.to_i - timestamp).abs > TOLERANCE

    payload = "#{timestamp}.#{request.raw_post}"
    expected = OpenSSL::HMAC.hexdigest("SHA256", ENV.fetch("PAYMENT_WEBHOOK_SECRET"), payload)

    ActiveSupport::SecurityUtils.secure_compare(expected, signature)
  end
end
```
- <mark>request.raw_post</mark>: phải ký trên **body gốc**. Nếu dùng <mark>params</mark> rồi <mark>to_json</mark> lại, thứ tự field hay khoảng trắng có thể khác, chữ ký sẽ không khớp.
- <mark>secure_compare</mark>: so sánh trong thời gian không đổi, chống timing attack. Đừng dùng <mark>==</mark>.
- **Timestamp**: được ký cùng nội dung, nên không sửa được. Request quá 5 phút bị từ chối, chống replay attack (xem phần dưới).

Tên header và cách ký mỗi dịch vụ một khác, hãy đọc kỹ docs của họ. Nhiều SDK đã làm sẵn, ví dụ Stripe
```ruby
event = Stripe::Webhook.construct_event(
  request.raw_post,
  request.headers["Stripe-Signature"],
  ENV.fetch("STRIPE_WEBHOOK_SECRET")
)
# chữ ký sai sẽ raise Stripe::SignatureVerificationError
```
Ngoài ra, với thông tin quan trọng như thanh toán, có thể **gọi lại API** của cổng thanh toán để kiểm tra trạng thái giao dịch, thay vì tin hoàn toàn vào nội dung webhook.

#### Replay attack
Kẻ gian bắt được một request hợp lệ (có chữ ký đúng), rồi **gửi lại** nhiều lần. Ví dụ webhook "nạp 100k vào ví" bị gửi lại 10 lần thành nạp 1 triệu.

Timestamp ở trên chặn được request cũ. Nhưng trong vòng 5 phút vẫn gửi lại được, và bản thân các dịch vụ cũng hay **gửi lại webhook** khi không nhận được phản hồi. Vì vậy cần đảm bảo mỗi event chỉ được xử lý **một lần** (idempotency):
```ruby
# db/migrate/xxx_create_webhook_events.rb

create_table :webhook_events do |t|
  t.string :provider, null: false
  t.string :event_id, null: false
  t.timestamps
end
add_index :webhook_events, [:provider, :event_id], unique: true
```
```ruby
def create
  return head :unauthorized unless valid_signature?

  event = JSON.parse(request.raw_post)

  WebhookEvent.transaction do
    WebhookEvent.create!(provider: "payment", event_id: event["id"])
    PaymentEventHandler.call(event)
  end

  head :ok
rescue ActiveRecord::RecordNotUnique
  head :ok # đã xử lý rồi, trả về OK để bên kia không gửi lại nữa
end
```
Lại là **unique index**, giống các bài trước. Hai request giống nhau tới cùng lúc thì cũng chỉ một cái được insert.

Với API của chính mình, ví dụ <mark>POST /orders</mark>, user bấm nút 2 lần hoặc mạng chập chờn làm app gửi lại, cũng dùng cách tương tự: client gửi kèm header <mark>Idempotency-Key</mark> (một UUID ngẫu nhiên cho mỗi lần đặt hàng), server lưu key đó với unique index.

#### SSRF
**SSRF** (Server-Side Request Forgery): app có tính năng "nhập URL ảnh đại diện", "preview link", "import từ URL"... Server sẽ gọi tới URL do user nhập. Kẻ gian nhập vào những địa chỉ **nội bộ**:
- <mark>http://localhost:6379</mark>: Redis nội bộ
- <mark>http://10.0.0.5/admin</mark>: các service nội bộ không có authentication
- <mark>http://169.254.169.254/latest/meta-data/</mark>: metadata của AWS EC2, có thể chứa **credentials** của server

Server của mình gọi được vào những chỗ này, còn bên ngoài thì không. SSRF biến server thành cầu nối cho kẻ tấn công.

Cách kiểm tra cơ bản: chỉ cho phép <mark>http</mark>, <mark>https</mark>, và kiểm tra IP thật sau khi phân giải tên miền
```ruby
# app/services/safe_url.rb

require "resolv"

class SafeUrl
  def self.safe?(url)
    uri = URI.parse(url)
    return false unless %w[http https].include?(uri.scheme)
    return false if uri.host.blank?

    Resolv.getaddresses(uri.host).all? do |address|
      ip = IPAddr.new(address)
      !(ip.private? || ip.loopback? || ip.link_local?)
    end
  rescue URI::InvalidURIError, IPAddr::InvalidAddressError
    false
  end
end
```
- Phải kiểm tra **IP sau khi phân giải**, không phải chỉ nhìn tên miền. Kẻ gian có thể tạo tên miền <mark>evil.com</mark> trỏ về <mark>127.0.0.1</mark>.
- <mark>link_local?</mark>: chặn dải <mark>169.254.x.x</mark>, nơi chứa metadata của cloud.

Nhưng cách trên vẫn còn lỗ hổng: tên miền có thể trả về IP an toàn lúc kiểm tra, rồi trả về IP nội bộ lúc gọi thật (**DNS rebinding**), hoặc URL an toàn nhưng **redirect** sang địa chỉ nội bộ. Vì vậy thực tế nên dùng gem <mark>ssrf_filter</mark>, nó kiểm tra IP, gọi thẳng vào đúng IP đã kiểm tra, và kiểm tra lại sau mỗi lần redirect
```ruby
response = SsrfFilter.get(params[:avatar_url])
```
Thêm vài lớp nữa cho chắc chắn:
- Giới hạn **timeout** và **kích thước** response, tránh bị treo hoặc tải về file vài GB.
- Nếu được, chỉ cho phép một **danh sách domain** nhất định.
- Trên AWS, bật **IMDSv2** để metadata không thể bị đọc bằng một request GET đơn giản.

#### Tổng kết series
Qua 9 bài, chúng ta đã đi qua các vấn đề phổ biến nhất mà một app hiện đại phải đối mặt:

| Bài | Vấn đề | Biện pháp chính |
|---|---|---|
| 086 | Spam, tài khoản ảo | Honeypot, Turnstile, chặn email tạm thời |
| 087 | Brute force, API abuse | Rack::Attack |
| 088 | Chiếm tài khoản | Chặn password bị lộ, cảnh báo thiết bị mới |
| 089 | Scalping bot | Waiting room, giới hạn theo SĐT, thẻ, địa chỉ |
| 090 | Coupon, referral, card testing, SMS | Unique index, chuẩn hóa email, giới hạn SMS |
| 091 | Click fraud | Impression token, lọc click, theo dõi CTR |
| 092 | Scraping, IDOR | Giới hạn dữ liệu, public_id, kiểm tra quyền |
| 093 | Webhook, replay, SSRF | Chữ ký HMAC, idempotency, ssrf_filter |

Có một kỹ thuật xuất hiện ở rất nhiều bài: **để database đảm bảo tính đúng đắn** bằng unique index và atomic update, thay vì kiểm tra bằng code. Code có thể bị race condition, còn database thì không.
