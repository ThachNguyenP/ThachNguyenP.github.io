---
layout: post
title:  "082. Overselling (Pessimistic & Optimistic locking)."
date:   2026-10-03 01:10:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_082/overselling-locking.png
---
Bài trước dùng atomic update cho trường hợp đơn giản. Khi logic phức tạp hơn, ví dụ phải kiểm tra giới hạn mua của từng user, tính giá theo khuyến mãi, rồi mới trừ kho, thì chúng ta cần **lock**. Rails hỗ trợ sẵn 2 kiểu: **pessimistic** và **optimistic**.

#### Pessimistic locking
"Bi quan": luôn nghĩ là sẽ có người tranh, nên **khóa row lại trước**, ai tới sau phải xếp hàng chờ.
```ruby
# app/services/purchase_service.rb

class PurchaseService
  class OutOfStock < StandardError; end

  def self.call(product_id:, user_id:, quantity: 1)
    Product.transaction do
      product = Product.lock.find(product_id)
      raise OutOfStock if product.stock < quantity

      # thoải mái xử lý logic phức tạp ở đây,
      # không ai sửa được product này cho tới khi transaction kết thúc
      price = PriceCalculator.call(product, user_id)

      product.update!(stock: product.stock - quantity)
      Order.create!(product:, user_id:, quantity:, price:)
    end
  end
end
```
- <mark>Product.lock.find</mark> sinh ra câu <mark>SELECT ... FOR UPDATE</mark>: khóa row này lại.
- Transaction khác muốn lock cùng row đó sẽ phải **chờ** tới khi transaction hiện tại commit hoặc rollback. Lúc đó nó mới đọc được stock mới nhất.
- Lock **bắt buộc** phải nằm trong <mark>transaction</mark>, transaction kết thúc thì lock được giải phóng.

Nếu đã có sẵn object thì dùng <mark>with_lock</mark>, Rails sẽ tự mở transaction và reload record với lock
```ruby
product.with_lock do
  raise OutOfStock if product.stock < quantity
  product.update!(stock: product.stock - quantity)
end
```

#### Lưu ý khi dùng pessimistic lock
**1. Giữ transaction càng ngắn càng tốt.** Đừng gọi API thanh toán, gửi email trong lúc đang lock. Người khác sẽ phải chờ theo, và server sẽ hết connection rất nhanh.

**2. Order có nhiều sản phẩm thì lock theo thứ tự.** Nếu A lock sản phẩm 1 rồi chờ sản phẩm 2, trong khi B lock sản phẩm 2 rồi chờ sản phẩm 1, cả 2 sẽ chờ nhau mãi mãi. Đây gọi là **deadlock**. Cách tránh đơn giản là luôn lock theo cùng một thứ tự, ví dụ theo <mark>id</mark>
```ruby
Product.transaction do
  products = Product.where(id: items.keys).order(:id).lock.to_a

  products.each do |product|
    quantity = items[product.id]
    raise OutOfStock, product.name if product.stock < quantity

    product.update!(stock: product.stock - quantity)
  end

  # tạo order...
end
```
PostgreSQL sẽ tự phát hiện deadlock và raise <mark>ActiveRecord::Deadlocked</mark> cho một bên, nhưng tốt nhất là đừng để nó xảy ra.

**3. Không muốn chờ thì dùng <mark>NOWAIT</mark>.** Mặc định transaction sẽ chờ lock mãi. Nếu muốn báo lỗi ngay khi row đang bị người khác lock
```ruby
Product.lock("FOR UPDATE NOWAIT").find(product_id)
# row đang bị lock => raise ActiveRecord::LockWaitTimeout
```

#### Optimistic locking
"Lạc quan": nghĩ là ít khi có người tranh, nên **không khóa gì cả**. Chỉ khi lưu mới kiểm tra xem có ai sửa trước mình không, nếu có thì báo lỗi.

Chỉ cần thêm một column tên <mark>lock_version</mark>, Rails sẽ tự lo phần còn lại
```ruby
# db/migrate/xxx_add_lock_version_to_products.rb

add_column :products, :lock_version, :integer, default: 0, null: false
```
Mỗi lần update, Rails sẽ sinh ra
```sql
UPDATE products SET stock = 0, lock_version = 6 WHERE id = 1 AND lock_version = 5
```
Nếu có người khác đã update trước (<mark>lock_version</mark> đã thành 6), không có row nào được update, và Rails raise <mark>ActiveRecord::StaleObjectError</mark>. Lúc đó chúng ta đọc lại và thử lại
```ruby
def self.call(product_id:, user_id:, quantity: 1)
  attempts = 0

  begin
    Product.transaction do
      product = Product.find(product_id)
      raise OutOfStock if product.stock < quantity

      product.update!(stock: product.stock - quantity)
      Order.create!(product:, user_id:, quantity:)
    end
  rescue ActiveRecord::StaleObjectError
    attempts += 1
    retry if attempts < 3
    raise
  end
end
```

#### Chọn cách nào?

| | Atomic update | Pessimistic | Optimistic |
|---|---|---|---|
| Cách hoạt động | DB kiểm tra và trừ trong 1 câu lệnh | Khóa row, người sau chờ | Không khóa, lỗi thì thử lại |
| Logic phức tạp | Không | Được | Được |
| Nhiều người tranh 1 sản phẩm | Tốt | Tốt, nhưng phải xếp hàng | **Tệ**, thử lại liên tục |
| Ít người tranh | Tốt | Tốn công lock | Tốt |

Theo kinh nghiệm của tôi:
- **Trừ kho đơn giản**: atomic update.
- **Trừ kho kèm logic phức tạp, nhiều sản phẩm**: pessimistic lock.
- **Optimistic lock** không hợp với trừ kho hàng hot, vì càng nhiều người tranh thì càng nhiều lần thử lại thất bại. Nó hợp với các trường hợp ít khi trùng, ví dụ 2 admin cùng sửa thông tin một sản phẩm.

Còn một vấn đề: chúng ta đang trừ kho ngay khi bấm mua. Nhưng nếu user bấm mua rồi không thanh toán thì sao? Bài tiếp theo sẽ nói về **giữ hàng** trong lúc chờ thanh toán.
