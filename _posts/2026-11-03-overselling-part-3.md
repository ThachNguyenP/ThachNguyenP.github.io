---
layout: post
title:  "083. Overselling (Stock reservation)."
date:   2026-11-03 01:12:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_083/overselling-reservation.png
---
Thực tế, mua hàng không xong ngay sau một cú click. User bấm mua, chuyển sang trang thanh toán, nhập thẻ, xác thực OTP... có thể mất vài phút. Câu hỏi là: **trừ kho lúc nào?**

- Trừ khi **thanh toán xong**: 2 người cùng thanh toán thành công cho 1 sản phẩm cuối cùng, phải hoàn tiền cho 1 người. Trải nghiệm rất tệ.
- Trừ khi **bấm mua**: user bấm mua rồi bỏ đi, hàng bị giữ mãi, không ai mua được.

Giải pháp là **giữ hàng** (reservation) có thời hạn, giống cách các trang đặt vé máy bay, vé xem phim: "Vé của bạn được giữ trong 10 phút".

#### Flow
1. User bấm mua: trừ kho, tạo một reservation hết hạn sau 10 phút.
2. Thanh toán thành công trong 10 phút: reservation chuyển thành <mark>completed</mark>, tạo order.
3. Quá 10 phút chưa thanh toán: reservation chuyển thành <mark>expired</mark>, **trả hàng lại vào kho**.

#### Model
```sh
rails g model Reservation product:references user:references quantity:integer status:string expires_at:datetime:index
```
```ruby
# app/models/reservation.rb

class Reservation < ApplicationRecord
  HOLD_DURATION = 10.minutes

  belongs_to :product
  belongs_to :user

  enum :status, { pending: "pending", completed: "completed", expired: "expired" }, default: :pending

  scope :overdue, -> { pending.where(expires_at: ...Time.current) }
end
```

#### Giữ hàng
Phần trừ kho dùng lại atomic update ở bài 081.
```ruby
# app/services/reserve_service.rb

class ReserveService
  class OutOfStock < StandardError; end

  def self.call(product:, user:, quantity: 1)
    Reservation.transaction do
      updated = Product.where(id: product.id)
                       .where("stock >= ?", quantity)
                       .update_all(["stock = stock - ?", quantity])
      raise OutOfStock if updated.zero?

      Reservation.create!(
        product:, user:, quantity:,
        expires_at: Reservation::HOLD_DURATION.from_now
      )
    end
  end
end
```
FE dùng <mark>expires_at</mark> để hiển thị đồng hồ đếm ngược cho user.

#### Hoàn tất khi thanh toán xong
Đây là chỗ dễ sai nhất. Hãy tưởng tượng: đúng giây thứ 600, user vừa thanh toán xong, cùng lúc đó job dọn reservation hết hạn cũng đang chạy. Nếu không cẩn thận, hàng vừa bị trả lại kho, vừa được tạo order. Lại bán vượt!

Cách xử lý vẫn là **atomic update**, lần này trên <mark>status</mark>: chỉ đổi trạng thái khi nó vẫn đang là <mark>pending</mark>. Ai đổi được trước thì người đó thắng.
```ruby
# app/services/complete_reservation_service.rb

class CompleteReservationService
  def self.call(reservation)
    Reservation.transaction do
      updated = Reservation.where(id: reservation.id, status: :pending)
                           .update_all(status: :completed)

      # reservation đã hết hạn và hàng đã bị trả lại kho
      return false if updated.zero?

      Order.create!(
        product_id: reservation.product_id,
        user_id: reservation.user_id,
        quantity: reservation.quantity
      )
    end
  end
end
```
Nếu trả về <mark>false</mark>, tức là đã quá hạn, nhưng user đã bị trừ tiền rồi. Lúc này có thể thử giữ hàng lại lần nữa, nếu vẫn còn hàng thì tạo order, còn không thì hoàn tiền. Trường hợp này rất hiếm nếu thời gian giữ hàng đủ dài.

Thêm nữa, các cổng thanh toán thường gọi webhook nhiều lần cho cùng một giao dịch. Nhờ điều kiện <mark>status: :pending</mark>, gọi lần 2 sẽ trả về <mark>false</mark> mà không tạo thêm order, nên chúng ta không cần xử lý thêm gì.

#### Trả hàng khi hết hạn
Viết một job chạy mỗi phút, tìm các reservation quá hạn và trả hàng lại.
```ruby
# app/jobs/release_expired_reservations_job.rb

class ReleaseExpiredReservationsJob < ApplicationJob
  def perform
    Reservation.overdue.find_each do |reservation|
      Reservation.transaction do
        updated = Reservation.where(id: reservation.id, status: :pending)
                             .update_all(status: :expired)
        next if updated.zero? # vừa được thanh toán, bỏ qua

        Product.where(id: reservation.product_id)
               .update_all(["stock = stock + ?", reservation.quantity])
      end
    end
  end
end
```
Lại là cùng một kỹ thuật: chỉ trả hàng khi **chính job này** là bên đổi được status từ <mark>pending</mark> sang <mark>expired</mark>.

Với Rails 8, Solid Queue có sẵn tính năng chạy job định kỳ
```yaml
# config/recurring.yml

production:
  release_expired_reservations:
    class: ReleaseExpiredReservationsJob
    schedule: every minute
```
Nếu dùng Sidekiq thì có thể dùng <mark>sidekiq-cron</mark> hoặc Sidekiq Enterprise.

Một cách khác là tạo job riêng cho từng reservation ngay lúc giữ hàng: <mark>ReleaseReservationJob.set(wait: 10.minutes).perform_later(reservation.id)</mark>. Cách này trả hàng đúng giờ hơn, nhưng nếu job bị mất thì hàng bị giữ mãi. Tôi thích cách quét định kỳ hơn vì nó tự sửa được.

#### Tóm tắt
- Giữ hàng **có thời hạn** khi user bắt đầu thanh toán.
- Mọi chỗ đổi trạng thái đều dùng **atomic update với điều kiện** <mark>status: :pending</mark>, để thanh toán và hết hạn không bao giờ cùng thắng.
- Có **job dọn dẹp** định kỳ để trả hàng.

Với một shop bình thường, như vậy là đủ. Nhưng nếu là **flash sale**, 100 sản phẩm mà 50.000 người cùng vào mua trong 1 giây thì database sẽ không chịu nổi. Bài cuối sẽ giải quyết trường hợp này.
