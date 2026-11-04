---
layout: post
title:  "089. Bot & Abuse protection (Scalping bot)."
date:   2026-11-03 01:20:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_089/bot-abuse-scalping.png
---
Ở series Overselling (081-084), chúng ta đã đảm bảo không bán vượt số hàng đang có. Nhưng còn một câu hỏi: **ai** mua được số hàng đó? Nếu 100 đôi giày phiên bản giới hạn bị bot mua sạch trong 2 giây, rồi được bán lại với giá gấp 3, thì hệ thống chạy đúng nhưng khách hàng thật vẫn mất lòng tin. Đó là **scalping bot**.

#### Bot scalping hoạt động thế nào
- Chạy hàng trăm, hàng nghìn tài khoản cùng lúc.
- Gọi thẳng API, bỏ qua giao diện, nhanh hơn người thật rất nhiều.
- Dùng residential proxy, mỗi request một IP khác nhau.
- Có tool chuyên nghiệp được bán công khai, có cả dịch vụ giải CAPTCHA thuê.

Vì vậy không có một cách nào chặn được 100%. Mục tiêu là làm cho việc dùng bot **không còn lợi thế**.

#### 1. Waiting room: xóa lợi thế tốc độ
Lợi thế lớn nhất của bot là **nhanh**. Waiting room (phòng chờ ảo) xóa lợi thế này: ai vào trước giờ mở bán đều được xếp **thứ tự ngẫu nhiên**, rồi được cho vào mua từng nhóm.

Dùng Redis sorted set để làm một waiting room đơn giản
```ruby
# app/services/waiting_room.rb

class WaitingRoom
  def initialize(sale_id)
    @queue_key = "waiting_room:#{sale_id}:queue"
    @admitted_key = "waiting_room:#{sale_id}:admitted"
  end

  # user vào phòng chờ, nhận một vị trí ngẫu nhiên
  def join(user_id)
    REDIS.zadd(@queue_key, rand, user_id, nx: true)
  end

  # vị trí hiện tại của user, bắt đầu từ 0
  def position(user_id)
    REDIS.zrank(@queue_key, user_id)
  end

  def admitted?(user_id)
    rank = position(user_id)
    rank.present? && rank < REDIS.get(@admitted_key).to_i
  end

  # job gọi định kỳ để cho thêm người vào
  def admit(count)
    REDIS.incrby(@admitted_key, count)
  end
end
```
- <mark>rand</mark> làm score: thứ tự là ngẫu nhiên, vào trước 1 giây hay 1 phút trước giờ mở bán đều như nhau. Bot có nhanh mấy cũng không có lợi thế.
- <mark>nx: true</mark>: mỗi user chỉ có một vị trí, gọi <mark>join</mark> nhiều lần không được bốc thăm lại.
- Một job chạy mỗi 10 giây gọi <mark>admit(200)</mark>, tức là cho thêm 200 người vào mua.
- FE poll API lấy <mark>position</mark> để hiển thị "Bạn đang ở vị trí thứ 1.234".

API mua hàng kiểm tra user đã được vào chưa
```ruby
def create
  room = WaitingRoom.new(params[:sale_id])
  return render json: { message: "Vui lòng chờ tới lượt" }, status: :forbidden unless room.admitted?(current_user.id)

  # flow mua hàng như bài 084...
end
```
Waiting room còn giúp server không bị quá tải, vì lượng người mua cùng lúc được kiểm soát. Nếu không muốn tự làm, có các dịch vụ như Cloudflare Waiting Room, Queue-it.

#### 2. Giới hạn mua theo nhiều chiều
Giới hạn "mỗi tài khoản 1 sản phẩm" là chưa đủ, vì bot có hàng nghìn tài khoản. Cần giới hạn theo những thứ **khó làm giả** hơn:
- Địa chỉ giao hàng (đã chuẩn hóa)
- Số điện thoại đã xác thực
- Thẻ thanh toán: Stripe trả về <mark>card.fingerprint</mark>, cùng một thẻ thì fingerprint giống nhau dù ở tài khoản nào.

```ruby
# app/models/limited_purchase.rb

class LimitedPurchase < ApplicationRecord
  # columns: sale_id, user_id, phone, address_hash, card_fingerprint
end
```
```ruby
# db/migrate/xxx_create_limited_purchases.rb

add_index :limited_purchases, [:sale_id, :user_id], unique: true
add_index :limited_purchases, [:sale_id, :phone], unique: true
add_index :limited_purchases, [:sale_id, :address_hash], unique: true
add_index :limited_purchases, [:sale_id, :card_fingerprint], unique: true
```
Dùng **unique index** thay vì kiểm tra bằng code, để 2 request cùng lúc cũng không lọt qua được (nhớ lại bài 081). Trùng bất kỳ thứ gì thì <mark>create!</mark> sẽ raise <mark>ActiveRecord::RecordNotUnique</mark>, chúng ta từ chối đơn hàng.

Để tính <mark>address_hash</mark>, chuẩn hóa địa chỉ trước: viết thường, bỏ dấu, bỏ khoảng trắng thừa, rồi mới hash. Nếu không thì "12 Nguyễn Huệ" và "12 nguyen hue" sẽ được tính là 2 địa chỉ khác nhau.

#### 3. Điều kiện tài khoản
Với các đợt bán hàng hot, có thể yêu cầu:
- Tài khoản đã tạo trước ngày mở bán (ví dụ ít nhất 7 ngày).
- Đã xác thực số điện thoại.
- Đã từng có đơn hàng thành công.

Cách này làm khó bot rất nhiều, vì chúng không thể tạo tài khoản ngay lúc mở bán được nữa.

#### 4. Phát hiện hành vi bất thường
Một vài dấu hiệu của bot:
- Đi thẳng vào API mua hàng mà không xem trang sản phẩm.
- Thời gian từ lúc mở trang tới lúc thanh toán chỉ vài trăm mili giây.
- Nhiều tài khoản dùng chung thiết bị, chung thẻ, chung địa chỉ.
- User agent là <mark>python-requests</mark>, <mark>curl</mark>, trình duyệt headless.

Không nên chặn ngay vì có thể chặn nhầm. Thay vào đó, ghi lại điểm nghi ngờ, rồi yêu cầu thêm Turnstile (bài 086) hoặc OTP với những request đáng ngờ.

#### 5. Bốc thăm thay vì ai nhanh thì được
Với những sản phẩm cực hot, nhiều thương hiệu lớn đã bỏ hẳn cách "ai nhanh thì được". Thay vào đó cho đăng ký trong vài ngày, rồi **bốc thăm** người được mua. Tốc độ không còn ý nghĩa, và có cả mấy ngày để lọc tài khoản ảo trước khi bốc thăm.

#### Tóm tắt

| Biện pháp | Chặn được |
|---|---|
| Waiting room / bốc thăm | Lợi thế tốc độ của bot |
| Giới hạn theo SĐT, địa chỉ, thẻ | Bot dùng nhiều tài khoản |
| Điều kiện tài khoản | Tài khoản tạo hàng loạt |
| Phát hiện hành vi | Bot gọi thẳng API |
| Turnstile ở bước thanh toán | Bot đơn giản |
