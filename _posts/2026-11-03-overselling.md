---
layout: post
title:  "081. Overselling (Race condition & Atomic update)."
date:   2026-11-03 01:08:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_081/overselling-atomic.png
---
Shop còn đúng 1 chiếc iPhone, 5 người cùng bấm "Mua" trong cùng một giây. Kết quả: cả 5 người đều đặt hàng thành công, tồn kho thì về 0. Đây là bài toán **overselling** (bán vượt tồn kho), gần như shop nào cũng gặp. Series này sẽ đi từ cách đơn giản nhất tới các trường hợp flash sale.

Version sử dụng: Ruby 3.4, Rails 8, PostgreSQL.

#### Tái hiện lỗi
Code mua hàng mà hầu như ai cũng từng viết
```ruby
# app/services/purchase_service.rb

class PurchaseService
  def self.call(product_id:, user_id:)
    product = Product.find(product_id)
    return false if product.stock <= 0

    sleep 0.1 # giả lập xử lý mất thời gian, ví dụ tính giá, gọi API...

    product.update!(stock: product.stock - 1)
    Order.create!(product_id:, user_id:)
    true
  end
end
```
Chạy thử 5 người mua cùng lúc trong <mark>rails console</mark>
```ruby
product = Product.create!(name: "iPhone 17", stock: 1)

threads = 5.times.map do |i|
  Thread.new do
    ActiveRecord::Base.connection_pool.with_connection do
      PurchaseService.call(product_id: product.id, user_id: i + 1)
    end
  end
end
threads.each(&:join)

product.reload.stock # => 0
Order.count          # => 5  😱
```
(Số thread không được vượt quá <mark>pool</mark> trong <mark>database.yml</mark>, mặc định là 5.)

#### Vì sao lại như vậy
Vấn đề nằm ở khoảng thời gian giữa lúc **đọc** và lúc **ghi**:

| Thời điểm | Người A | Người B |
|---|---|---|
| 1 | Đọc stock = 1 | |
| 2 | | Đọc stock = 1 |
| 3 | 1 > 0, OK | 1 > 0, OK |
| 4 | Ghi stock = 0, tạo order | |
| 5 | | Ghi stock = 0, tạo order |

Cả 2 đều thấy còn hàng, vì lúc đọc thì đúng là còn thật. Đây gọi là **race condition**. Ở local ít khi thấy, nhưng lên production với nhiều server, nhiều thread thì chắc chắn sẽ gặp.

Thêm <mark>validates :stock, numericality: { greater_than_or_equal_to: 0 }</mark> cũng không giải quyết được, vì validation cũng chạy trên dữ liệu đã đọc từ trước.

#### Giải pháp 1: Atomic update
Thay vì đọc rồi mới ghi, hãy để database **vừa kiểm tra vừa trừ** trong cùng một câu lệnh.
```ruby
# app/services/purchase_service.rb

class PurchaseService
  class OutOfStock < StandardError; end

  def self.call(product_id:, user_id:, quantity: 1)
    Product.transaction do
      updated = Product.where(id: product_id)
                       .where("stock >= ?", quantity)
                       .update_all(["stock = stock - ?", quantity])

      raise OutOfStock if updated.zero?

      Order.create!(product_id:, user_id:, quantity:)
    end
  end
end
```
Câu SQL được sinh ra
```sql
UPDATE products SET stock = stock - 1 WHERE id = 1 AND stock >= 1
```
- Database đảm bảo các câu <mark>UPDATE</mark> trên cùng một row sẽ chạy **lần lượt**. Người thứ 2 phải chờ người thứ nhất xong, lúc đó <mark>stock >= 1</mark> không còn đúng nữa, nên không có row nào được update.
- <mark>update_all</mark> trả về **số row đã update**: 1 là mua thành công, 0 là hết hàng.
- <mark>stock = stock - 1</mark>: tính trên giá trị hiện tại trong DB, không phải giá trị Ruby đã đọc trước đó.
- Bọc trong <mark>transaction</mark>: nếu tạo order lỗi thì stock cũng được hoàn lại.

Chạy lại đoạn test ở trên
```ruby
product.reload.stock # => 0
Order.count          # => 1  ✅
```
4 người còn lại nhận lỗi <mark>OutOfStock</mark>, controller chỉ cần rescue và trả về thông báo "Sản phẩm đã hết hàng".

Lưu ý: <mark>update_all</mark> bỏ qua validation và callback của model, và không tự cập nhật <mark>updated_at</mark>. Nếu cần thì thêm vào câu update: <mark>["stock = stock - ?, updated_at = ?", quantity, Time.current]</mark>.

#### Chốt chặn cuối cùng: check constraint
Code có thể sai, sau này có người viết chỗ khác trừ stock mà quên kiểm tra. Hãy để database làm chốt chặn cuối cùng.
```ruby
# db/migrate/xxx_add_stock_check_to_products.rb

class AddStockCheckToProducts < ActiveRecord::Migration[8.0]
  def change
    add_check_constraint :products, "stock >= 0", name: "products_stock_non_negative"
  end
end
```
Từ giờ, bất kỳ câu lệnh nào làm stock âm đều bị database từ chối và raise lỗi <mark>ActiveRecord::StatementInvalid</mark>. Bug có thể làm order bị lỗi, nhưng không bao giờ làm bán vượt hàng.

#### Khi nào dùng
Atomic update là cách **đơn giản và nhanh nhất**, phù hợp với phần lớn trường hợp: chỉ cần trừ một con số. Theo kinh nghiệm của tôi, nên bắt đầu từ cách này.

Nhưng nếu logic phức tạp hơn, ví dụ phải đọc nhiều thông tin, tính toán rồi mới quyết định, hoặc một order có nhiều sản phẩm, thì một câu <mark>UPDATE</mark> không đủ. Bài tiếp theo sẽ nói về **locking**.
