---
layout: post
title:  "090. Bot & Abuse protection (Coupon, Referral, Card testing & SMS pumping)."
date:   2026-10-03 01:21:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_090/bot-abuse-money.png
---
Bài này về những kiểu lạm dụng làm **mất tiền trực tiếp**: lạm dụng coupon, referral, card testing và SMS pumping.

#### 1. Lạm dụng coupon
Coupon "Giảm 50% cho đơn đầu tiên" hay "Mỗi người chỉ dùng 1 lần" thường bị lạm dụng bằng 2 cách: tạo nhiều tài khoản, hoặc gửi nhiều request cùng lúc.

**Gửi nhiều request cùng lúc**: lại là race condition của bài 081. Dùng unique index cho giới hạn mỗi người, và atomic update cho tổng số lượt dùng
```ruby
# db/migrate/xxx_create_coupon_redemptions.rb

add_index :coupon_redemptions, [:coupon_id, :user_id], unique: true
```
```ruby
# app/services/redeem_coupon_service.rb

class RedeemCouponService
  class Unavailable < StandardError; end

  def self.call(coupon:, user:, order:)
    CouponRedemption.transaction do
      updated = Coupon.where(id: coupon.id)
                      .where("used_count < max_uses")
                      .update_all("used_count = used_count + 1")
      raise Unavailable if updated.zero?

      CouponRedemption.create!(coupon:, user:, order:)
    end
  rescue ActiveRecord::RecordNotUnique
    raise Unavailable
  end
end
```

**Nhiều tài khoản**: giống bài 089, giới hạn theo những thứ khó làm giả như số điện thoại, thẻ thanh toán, địa chỉ. Ngoài ra cần **chuẩn hóa email**, vì với Gmail thì các email sau đều là một hộp thư:
- <mark>nolan@gmail.com</mark>
- <mark>no.lan@gmail.com</mark>
- <mark>nolan+abc@gmail.com</mark>

```ruby
# app/models/concerns/email_normalizable.rb

module EmailNormalizable
  def self.canonical(email)
    local, domain = email.to_s.downcase.strip.split("@", 2)
    return email if domain.blank?

    local = local.split("+").first
    local = local.delete(".") if %w[gmail.com googlemail.com].include?(domain)
    "#{local}@#{domain}"
  end
end
```
Lưu thêm một column <mark>canonical_email</mark> với unique index, dùng để kiểm tra trùng khi đăng ký hoặc dùng coupon "đơn đầu tiên". Vẫn cho user dùng email gốc để đăng nhập và nhận thư.

#### 2. Lạm dụng referral
"Mời bạn bè, cả 2 cùng được 100k". Kẻ xấu sẽ tự mời chính mình bằng hàng loạt tài khoản ảo. Cách chặn:
- **Chỉ thưởng khi người được mời có đơn hàng thật**, đã thanh toán, đã giao, và qua thời gian đổi trả. Đừng thưởng ngay khi đăng ký.
- **Không thưởng** nếu người mời và người được mời dùng chung thiết bị, thẻ thanh toán, địa chỉ giao hàng, hay số điện thoại.
- **Giới hạn** số lượt thưởng mỗi người, ví dụ tối đa 10 lượt mỗi tháng.
- Phần thưởng là **điểm hoặc voucher** dùng trong app, không phải tiền mặt rút ra được.

```ruby
# app/jobs/grant_referral_reward_job.rb

class GrantReferralRewardJob < ApplicationJob
  def perform(referral_id)
    referral = Referral.find(referral_id)
    return unless referral.pending?
    return referral.update!(status: :rejected) if suspicious?(referral)

    referral.update!(status: :rewarded)
    # cộng điểm cho cả 2...
  end

  private

  def suspicious?(referral)
    inviter, invitee = referral.inviter, referral.invitee
    shared_devices = inviter.known_devices.pluck(:device_id) & invitee.known_devices.pluck(:device_id)
    # card_fingerprints: fingerprint các thẻ user đã từng thanh toán (bài 089)
    shared_cards = inviter.card_fingerprints & invitee.card_fingerprints

    shared_devices.any? || shared_cards.any? || inviter.phone == invitee.phone
  end
end
```
Job này chạy sau khi đơn đầu tiên của người được mời qua thời gian đổi trả, ví dụ 7 ngày sau khi giao hàng.

#### 3. Card testing
Kẻ gian mua được danh sách thẻ bị đánh cắp, nhưng không biết thẻ nào còn dùng được. Họ dùng bot thanh toán những đơn **rất nhỏ** trên trang của mình để thử. Hậu quả: rất nhiều giao dịch lỗi, phí giao dịch, phí chargeback, và cổng thanh toán có thể khóa tài khoản merchant của mình.

Dấu hiệu dễ thấy: rất nhiều lần thanh toán thất bại trong thời gian ngắn, số tiền nhỏ, thẻ khác nhau.

Cách chặn:
- **Rate limit thanh toán** theo user, IP, và đặc biệt là **số lần thất bại**

```ruby
# config/initializers/rack_attack.rb

throttle("payments/ip", limit: 5, period: 10.minutes) do |req|
  req.ip if req.path == "/payments" && req.post?
end
```
```ruby
# app/services/payment_service.rb

def self.record_failure(user)
  key = "payment_failures:#{user.id}"
  failures = Rails.cache.increment(key, 1, expires_in: 1.hour)
  user.update!(payment_locked_until: 1.day.from_now) if failures >= 5
end
```
- Bắt buộc **đăng nhập, xác thực email** trước khi thanh toán.
- Thêm **Turnstile** (bài 086) ở bước thanh toán.
- Bật **3D Secure** và các công cụ chống gian lận của cổng thanh toán (ví dụ Stripe Radar). Họ thấy dữ liệu từ hàng triệu merchant, nên phát hiện tốt hơn nhiều so với tự làm.

#### 4. SMS pumping
Đây là kiểu tấn công nhiều người không biết cho tới khi nhận hóa đơn. Kẻ gian hợp tác với nhà mạng ở một số quốc gia, có các số điện thoại cước cao. Họ dùng bot gọi API "gửi mã OTP" của mình liên tục tới các số đó. Mỗi tin nhắn mình phải trả tiền, và họ được chia phần.

Cách chặn:
- **Rate limit theo số điện thoại** và theo IP: mỗi số tối đa 3 tin trong 1 giờ.
- **Chỉ cho phép gửi tới các quốc gia** mà app thật sự phục vụ. Gem <mark>phonelib</mark> giúp lấy mã quốc gia

```ruby
ALLOWED_COUNTRIES = %w[VN SG].freeze

phone = Phonelib.parse(params[:phone])
unless phone.valid? && ALLOWED_COUNTRIES.include?(phone.country)
  return render json: { message: "Số điện thoại không được hỗ trợ" }, status: :unprocessable_entity
end
```
- **Turnstile trước khi gửi OTP**, để bot không gọi thẳng API được.
- **Giới hạn tổng** số SMS mỗi giờ của cả hệ thống, vượt ngưỡng thì dừng gửi và báo động

```ruby
count = Rails.cache.increment("sms:hourly:#{Time.current.strftime('%Y%m%d%H')}", 1, expires_in: 2.hours)
if count > 1_000
  Sentry.capture_message("SMS hourly limit exceeded")
  raise SmsLimitExceeded
end
```
- Theo dõi **tỉ lệ xác thực thành công**: gửi rất nhiều OTP mà gần như không có ai nhập mã, đó là dấu hiệu bị pumping.
- Cân nhắc dùng **authenticator app** (bài 075) thay vì SMS, vừa an toàn hơn vừa không tốn tiền.

Ngoài ra, các nhà cung cấp SMS như Twilio đều có tính năng chặn SMS pumping riêng, hãy bật lên.

#### Tóm tắt

| Vấn đề | Biện pháp chính |
|---|---|
| Coupon | Unique index, atomic update, chuẩn hóa email |
| Referral | Thưởng khi có đơn thật, kiểm tra trùng thiết bị, thẻ |
| Card testing | Rate limit thanh toán thất bại, Turnstile, Stripe Radar |
| SMS pumping | Rate limit theo số, giới hạn quốc gia, giới hạn tổng |
