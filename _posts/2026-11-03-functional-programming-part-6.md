---
layout: post
title:  "124. Functional Programming (Áp dụng vào Rails)."
date:   2026-11-03 02:26:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_124/fp-rails.png
---
Rails là framework OOP, model là object có trạng thái và tự lưu vào database. Vậy FP đặt vào đâu? Bài cuối trả lời bằng một cách tổ chức có tên **functional core, imperative shell**, và chỉ ra những chỗ Rails vốn đã là FP mà có thể bạn chưa để ý.

#### Functional core, imperative shell
Chia code thành 2 phần:
- **Core** (lõi): pure function. Nhận dữ liệu thuần (số, chuỗi, hash, <mark>Data</mark>), trả về dữ liệu. Không biết database, không biết request, không biết thời gian hiện tại. Đây là nơi chứa **quy tắc nghiệp vụ**.
- **Shell** (vỏ): mỏng, làm mọi side effect. Đọc từ database, gọi core, ghi kết quả, gửi email, render.

```
Request ──► Controller ──► Service (shell) ──► Pricing (core, pure) ──► kết quả
                              │  đọc DB, lấy giờ                  ▲
                              │  lưu DB, gửi mail ◄───────────────┘
```
Ví dụ tính giá đơn hàng với khuyến mãi. Cách thường gặp: mọi thứ trong model
```ruby
class Order < ApplicationRecord
  def apply_coupon!(code)
    coupon = Coupon.find_by!(code:)                   # đọc DB
    raise "Hết hạn" if coupon.expires_at < Time.current  # đọc giờ
    self.discount = [subtotal * coupon.percent / 100, coupon.max_discount].min
    save!                                              # ghi DB
    CouponMailer.applied(self).deliver_later           # side effect
  end
end
```
Test method này cần tạo Order, Coupon trong database, freeze thời gian, kiểm tra mail queue. Tách lõi ra
```ruby
# app/domains/pricing.rb (core, pure)
# Success, Failure: class Result ở bài 123 (hoặc Dry::Monads)

module Pricing
  Coupon = Data.define(:percent, :max_discount, :expires_at)
  Result = Data.define(:discount, :total)

  def self.apply_coupon(subtotal:, coupon:, now:)
    return Failure.new(error: "Mã đã hết hạn") if coupon.expires_at < now

    discount = [subtotal * coupon.percent / 100, coupon.max_discount].min
    Success.new(value: Result.new(discount:, total: subtotal - discount))
  end
end
```
Lõi nhận <mark>now</mark> làm tham số (bài 119), trả về Result (bài 123). Test nó không cần Rails
```ruby
# test/domains/pricing_test.rb

class PricingTest < ActiveSupport::TestCase
  test "giảm theo phần trăm nhưng không vượt mức tối đa" do
    coupon = Pricing::Coupon.new(percent: 50, max_discount: 100_000, expires_at: Time.utc(2026, 12, 31))

    result = Pricing.apply_coupon(subtotal: 1_000_000, coupon:, now: Time.utc(2026, 11, 3))

    assert_equal 100_000, result.value.discount
    assert_equal 900_000, result.value.total
  end

  test "mã hết hạn" do
    coupon = Pricing::Coupon.new(percent: 10, max_discount: 100_000, expires_at: Time.utc(2026, 1, 1))

    assert_instance_of Failure, Pricing.apply_coupon(subtotal: 100, coupon:, now: Time.utc(2026, 11, 3))
  end
end
```
Chạy trong vài mili giây, không database, không mock, mọi trường hợp biên đều thử được bằng cách đổi tham số. Rồi viết vỏ
```ruby
# app/services/apply_coupon.rb (shell)

class ApplyCoupon
  def call(order, code)
    coupon = Coupon.find_by(code:)
    return Failure.new(error: "Mã không tồn tại") unless coupon

    Pricing.apply_coupon(
      subtotal: order.subtotal,
      coupon: Pricing::Coupon.new(percent: coupon.percent, max_discount: coupon.max_discount, expires_at: coupon.expires_at),
      now: Time.current
    ).and_then do |pricing|
      order.update!(discount: pricing.discount, total: pricing.total)
      CouponMailer.applied(order).deliver_later
      Success.new(value: order)
    end
  end
end
```
Vỏ chỉ có đọc, gọi lõi, ghi. Gần như không có <mark>if</mark> nghiệp vụ, nên không cần test kỹ; một integration test là đủ. Phần có nhiều logic nhất (lõi) thì test nhanh và dễ nhất. Đây là điểm được lớn nhất của FP trong Rails.

Controller xử lý Result ở cuối (bài 123)
```ruby
def update
  case ApplyCoupon.new.call(@order, params[:code])
  in Success(value: order) then redirect_to order, notice: "Đã áp dụng mã"
  in Failure(error:) then redirect_to @order, alert: error
  end
end
```

#### Rails vốn đã FP ở nhiều chỗ
**Scope là lambda**
```ruby
class Order < ApplicationRecord
  scope :paid,      -> { where(status: "paid") }
  scope :in_month,  ->(month) { where(created_at: month.all_month) }
  scope :expensive, -> { where("total > ?", 1_000_000) }
end

Order.paid.in_month(Date.current).expensive
```
Mỗi scope là một hàm pure nhận relation trả về relation. Và **relation là immutable**: <mark>Order.paid</mark> không sửa gì, trả về relation mới, nên ghép bao nhiêu cũng được, giống <mark>>></mark> ở bài 121. Query object chỉ là mở rộng ý này
```ruby
class OrderQuery
  def initialize(scope = Order.all) = @scope = scope

  def call(status: nil, month: nil, min_total: nil)
    [
      status    && ->(s) { s.where(status:) },
      month     && ->(s) { s.where(created_at: month.all_month) },
      min_total && ->(s) { s.where("total >= ?", min_total) },
    ].compact.reduce(@scope) { |scope, filter| filter.(scope) }
  end
end

OrderQuery.new.call(status: "paid", min_total: 500_000)
```
Mảng các lambda, <mark>reduce</mark> qua relation: đúng pipeline của bài 121, và mỗi filter test riêng được.

**Value object thay cho primitive**: <mark>Money</mark>, <mark>Email</mark>, <mark>DateRange</mark> ở bài 096 đều là <mark>Data</mark> bất biến với method pure.

**Callback là nơi FP bị vi phạm nhiều nhất**: <mark>after_save :send_email, :sync_search, :update_stats</mark> là side effect ẩn, chạy mỗi khi ai đó <mark>save</mark>, kể cả trong console hay seed. Chuyển chúng vào shell (service) hoặc domain event (bài 098), model chỉ còn validation và scope.

#### Những thói quen nhỏ áp dụng ngay
- **Truyền dữ liệu, không truyền model** vào hàm tính toán: <mark>Pricing.total(lines)</mark> với <mark>lines</mark> là mảng <mark>Data</mark>, không phải <mark>Pricing.total(order)</mark> rồi bên trong gọi <mark>order.lines.includes(...)</mark>.
- **Thời gian và random là tham số**: <mark>now:</mark>, <mark>today:</mark>, <mark>token:</mark>. Không <mark>Time.current</mark> trong lõi.
- **<mark>map</mark>/<mark>select</mark>/<mark>sum</mark> thay <mark>each</mark> với biến tạm** (bài 120).
- **<mark>freeze</mark> hằng số**, <mark># frozen_string_literal: true</mark> ở mọi file.
- **<mark>Data</mark> thay <mark>Struct</mark> và hash tự do** cho dữ liệu đi qua nhiều hàm. Hash thì ai cũng sửa được và không biết có key gì.
- **Result thay vì raise** cho lỗi nghiệp vụ trong service (bài 123). Dùng <mark>dry-monads</mark> nếu team đồng ý.
- **Một service, một việc, trả về một giá trị**. Không <mark>@instance_variable</mark> làm trạng thái tạm giữa các method private; truyền tham số.

#### Khi nào không nên ép FP
- **ActiveRecord model** vốn mutable và có identity, đó là thiết kế của nó. Không cần biến model thành Data; chỉ cần đừng nhét logic tính toán vào model.
- **Hiệu năng**: vòng lặp xử lý triệu phần tử thì <mark>each_with_object</mark> hay <mark>map!</mark> cục bộ hợp lý hơn <mark>reduce</mark> với <mark>merge</mark> (bài 122).
- **Team chưa quen**: <mark>curry</mark>, point-free, monad có thể làm code khó đọc hơn với người mới. Pure function, immutability và Result là 3 thứ ai cũng hiểu được nhanh, bắt đầu từ đó.
- **Code CRUD đơn giản**: controller gọi <mark>Model.create</mark> rồi redirect thì không cần core/shell gì cả.

#### Tổng kết series

| Bài | Ý chính | Áp dụng trong Rails |
|---|---|---|
| 119 | Pure function, không side effect, immutable | Lõi nghiệp vụ không chạm DB, <mark>freeze</mark>, <mark>Data</mark> |
| 120 | Hàm là giá trị, closure, higher-order | <mark>map</mark>/<mark>select</mark>/<mark>reduce</mark>, scope là lambda |
| 121 | <mark>>></mark>, <mark>then</mark>, <mark>curry</mark>, pipeline | Query object, chuỗi xử lý dữ liệu |
| 122 | <mark>with</mark>, <mark>reduce</mark>, đệ quy, <mark>lazy</mark> | Value object, cây danh mục, đọc file lớn |
| 123 | <mark>Success</mark>/<mark>Failure</mark>, railway | Service object, <mark>dry-monads</mark> |
| 124 | Functional core, imperative shell | Service mỏng, lõi pure test không cần DB |

Nếu ngày mai chỉ làm một việc: chọn một service object phức tạp nhất trong dự án, tách phần tính toán thành module pure nhận dữ liệu và <mark>now:</mark>, viết test cho nó mà không chạm database. Bạn sẽ thấy ngay FP có ích ở đâu.

Sách để đi tiếp: *Grokking Simplicity* (Eric Normand) dạy đúng cách suy nghĩ này bằng JavaScript, rất dễ đọc; *Functional Programming in Ruby* (Pat Shaughnessy, miễn phí online) nếu muốn đào sâu trong Ruby.
