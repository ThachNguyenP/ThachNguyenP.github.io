---
layout: post
title:  "122. Functional Programming (Biến đổi dữ liệu, Đệ quy & Lazy)."
date:   2026-10-03 02:22:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_122/fp-data-transformation.png
---
Bài 119 nói không nên mutation. Nhưng chương trình thì phải thay đổi dữ liệu: thêm sản phẩm vào giỏ, cập nhật số lượng, gom nhóm báo cáo. Bài này trả lời câu hỏi "không sửa thì làm sao?", với giỏ hàng làm ví dụ xuyên suốt.

#### Cập nhật bằng cách tạo mới
```ruby
# fp4.rb

Line = Data.define(:sku, :qty, :price)
Cart = Data.define(:lines, :coupon)

cart = Cart.new(lines: [], coupon: nil)
```
Thêm sản phẩm: không <mark>cart.lines << line</mark>, mà tạo cart mới với mảng mới
```ruby
def add_line(cart, line)
  cart.with(lines: cart.lines + [line])
end

cart2 = add_line(cart, Line.new(sku: "IP17", qty: 1, price: 25_000_000))
cart3 = add_line(cart2, Line.new(sku: "CASE", qty: 2, price: 200_000))

p cart.lines.size  # => 0, giỏ ban đầu không đổi
p cart3.lines.size # => 2
```
<mark>+</mark> trên mảng trả về mảng mới, <mark><<</mark> sửa tại chỗ. Tương tự: <mark>merge</mark> thay <mark>[]=</mark> trên hash, <mark>map</mark> thay <mark>map!</mark>, <mark>sort</mark> thay <mark>sort!</mark>, <mark>reject</mark> thay <mark>delete_if</mark>.

Cập nhật một dòng bên trong: <mark>map</mark> qua các dòng, dòng nào khớp thì trả về bản mới
```ruby
def change_qty(cart, sku, qty)
  cart.with(lines: cart.lines.map { |l| l.sku == sku ? l.with(qty:) : l })
end

def remove_line(cart, sku)
  cart.with(lines: cart.lines.reject { |l| l.sku == sku })
end

cart4 = change_qty(cart3, "CASE", 5)
p cart4.lines.map { |l| [l.sku, l.qty] } # => [["IP17", 1], ["CASE", 5]]
p cart3.lines.map { |l| [l.sku, l.qty] } # => [["IP17", 1], ["CASE", 2]], vẫn như cũ
```
Lợi ích thấy ngay: **undo** miễn phí. Giữ <mark>cart3</mark> lại là có nút "hoàn tác". Lịch sử giỏ hàng chỉ là một mảng các cart.

Tốn bộ nhớ không? Có, nhưng ít hơn bạn nghĩ: <mark>cart4</mark> và <mark>cart3</mark> dùng chung object dòng <mark>IP17</mark> (chỉ dòng <mark>CASE</mark> được tạo mới). Với dữ liệu cỡ ứng dụng web thông thường, chi phí này không đáng kể so với lợi ích.

#### Tính toán từ dữ liệu
Mọi con số dẫn xuất (tổng tiền, số lượng) là **hàm của dữ liệu**, không lưu và không cập nhật tay
```ruby
def subtotal(cart) = cart.lines.sum { |l| l.qty * l.price }

def discount(cart)
  case cart.coupon
  in nil then 0
  in { type: :percent, value: } then subtotal(cart) * value / 100
  in { type: :fixed, value: } then [value, subtotal(cart)].min
  end
end

def total(cart) = subtotal(cart) - discount(cart)

cart5 = cart4.with(coupon: { type: :percent, value: 10 })
p subtotal(cart5) # => 26000000
p discount(cart5) # => 2600000
p total(cart5)    # => 23400000
```
Không bao giờ có chuyện "tổng tiền hiển thị không khớp với các dòng", vì tổng luôn được tính lại từ các dòng. Đây cũng là lý do bài 097 (DDD) tính lại <mark>total</mark> mỗi lần sửa aggregate.

Pattern matching <mark>case in</mark> (Ruby 3.0+) rất hợp với FP: xử lý theo **hình dạng** dữ liệu, không cần <mark>if coupon && coupon[:type] == :percent</mark>.

#### reduce và each_with_object
Gom nhóm, đếm, xây hash từ mảng, tất cả là <mark>reduce</mark>. Ví dụ tổng tiền theo sku từ nhiều giỏ
```ruby
carts = [cart3, cart5]

totals_by_sku = carts.flat_map(&:lines).reduce({}) do |acc, l|
  acc.merge(l.sku => acc.fetch(l.sku, 0) + l.qty * l.price)
end
p totals_by_sku # => {"IP17" => 50000000, "CASE" => 1400000}
```
<mark>merge</mark> tạo hash mới mỗi bước. Với vài trăm phần tử thì không sao; với hàng triệu phần tử thì tạo hàng triệu hash tạm. Lúc đó Ruby có <mark>each_with_object</mark>: mutation **nội bộ**, nhưng hash chỉ tồn tại trong hàm và trả về xong là không ai sửa nữa, nhìn từ ngoài vẫn pure
```ruby
totals_by_sku = carts.flat_map(&:lines).each_with_object(Hash.new(0)) do |l, acc|
  acc[l.sku] += l.qty * l.price
end
```
Đây là thỏa hiệp hợp lý: **pure ở giao diện, mutation bên trong nếu cần hiệu năng**. Điều cần tránh là mutation **lọt ra ngoài** (sửa tham số, biến global), không phải mutation nói chung.

Thường thì có sẵn hàm chuyên dụng ngắn hơn cả hai
```ruby
p carts.flat_map(&:lines).group_by(&:sku).transform_values { |ls| ls.sum { |l| l.qty * l.price } }
# => {"IP17" => 50000000, "CASE" => 1400000}
p carts.flat_map(&:lines).sum { |l| l.qty * l.price }   # => 51400000
p carts.flat_map(&:lines).map(&:sku).tally               # => {"IP17" => 2, "CASE" => 2}
```

#### Đệ quy
FP thuần không có vòng lặp <mark>for</mark>/<mark>while</mark> (chúng cần một biến đếm bị sửa dần); thay vào đó là **đệ quy**: hàm gọi chính nó trên bài toán nhỏ hơn
```ruby
def sum_list(list)
  return 0 if list.empty?            # trường hợp cơ sở

  list.first + sum_list(list.drop(1)) # trường hợp đệ quy: phần tử đầu + tổng phần còn lại
end

p sum_list([1, 2, 3, 4]) # => 10
```
Đệ quy tỏa sáng với dữ liệu **có cấu trúc cây**: danh mục con, cây thư mục, bình luận lồng nhau, JSON lồng nhau. Ví dụ tính tổng số sản phẩm của một danh mục và toàn bộ danh mục con
```ruby
Category = Data.define(:name, :product_count, :children)

electronics = Category.new(name: "Điện tử", product_count: 5, children: [
  Category.new(name: "Điện thoại", product_count: 120, children: [
    Category.new(name: "Phụ kiện", product_count: 300, children: []),
  ]),
  Category.new(name: "Laptop", product_count: 80, children: []),
])

def total_products(category)
  category.product_count + category.children.sum { |c| total_products(c) }
end

p total_products(electronics) # => 505

def flatten_names(category, depth = 0)
  [("  " * depth) + category.name] + category.children.flat_map { |c| flatten_names(c, depth + 1) }
end

puts flatten_names(electronics)
# Điện tử
#   Điện thoại
#     Phụ kiện
#   Laptop
```
Viết bằng vòng lặp sẽ cần một stack tự quản lý, dài và khó đọc hơn nhiều.

Giới hạn: Ruby không tối ưu tail call mặc định, đệ quy sâu khoảng 10.000 tầng sẽ <mark>SystemStackError</mark>. Với danh sách phẳng dài, dùng <mark>reduce</mark>/<mark>sum</mark>; để đệ quy cho cấu trúc cây, nơi độ sâu thường nhỏ.

#### Lazy: dãy vô hạn
<mark>map</mark>, <mark>select</mark> thường chạy **ngay** và tạo mảng trung gian ở mỗi bước. <mark>lazy</mark> hoãn lại tới khi thật sự cần, và chỉ tính đúng phần cần
```ruby
# Tìm 5 số chính phương đầu tiên chia hết cho 7
p (1..Float::INFINITY).lazy
  .map { |n| n * n }
  .select { |n| n % 7 == 0 }
  .first(5)
# => [49, 196, 441, 784, 1225]
```
Không có <mark>lazy</mark>, dòng <mark>map</mark> sẽ chạy mãi mãi trên dãy vô hạn. Có <mark>lazy</mark>, mỗi số đi qua cả chuỗi rồi mới tới số tiếp theo, dừng khi đủ 5.

<mark>Enumerator.produce</mark> tạo dãy từ một hàm sinh phần tử kế tiếp
```ruby
fib = Enumerator.produce([0, 1]) { |a, b| [b, a + b] }.lazy.map(&:first)
p fib.first(10) # => [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]

# Ngày làm việc tiếp theo
require "date"
next_workdays = Enumerator.produce(Date.new(2026, 11, 6)) { |d| d + 1 }.lazy.reject { |d| d.saturday? || d.sunday? }
p next_workdays.first(3).map(&:to_s) # => ["2026-11-06", "2026-11-09", "2026-11-10"]
```
Thực tế hay dùng lazy khi: đọc file lớn từng dòng (<mark>File.foreach(path).lazy</mark>), phân trang API (lấy trang tiếp theo chỉ khi cần), hoặc chuỗi xử lý dài trên dữ liệu lớn để tránh mảng trung gian.

#### Khi nào mutation vẫn ổn
- Biến **cục bộ** trong một hàm, không lọt ra ngoài (<mark>each_with_object</mark>, xây chuỗi với <mark><<</mark> rồi trả về).
- Vòng lặp hiệu năng cao trên mảng lớn (<mark>map!</mark> tiết kiệm bộ nhớ), nhưng chỉ trên mảng do chính hàm tạo ra.
- Framework yêu cầu: ActiveRecord object vốn là mutable, bài 124 sẽ bàn.

Nguyên tắc: **mutation là chi tiết hiện thực bên trong, không phải giao diện**. Người gọi hàm không bao giờ thấy dữ liệu của họ bị đổi.

#### Tóm tắt
- "Cập nhật" = tạo bản mới bằng <mark>with</mark>, <mark>+</mark>, <mark>merge</mark>, <mark>map</mark>, <mark>reject</mark>. Bản cũ còn nguyên, undo miễn phí.
- Giá trị dẫn xuất thì tính từ dữ liệu, không lưu riêng.
- <mark>reduce</mark> xây mọi thứ; <mark>each_with_object</mark> khi cần hiệu năng; nhưng thường có hàm chuyên dụng (<mark>group_by</mark>, <mark>tally</mark>, <mark>sum</mark>).
- Đệ quy cho cấu trúc cây. Danh sách phẳng thì dùng <mark>reduce</mark>.
- <mark>lazy</mark> và <mark>Enumerator.produce</mark> cho dãy vô hạn hoặc dữ liệu lớn.

Bài tiếp theo: xử lý lỗi theo kiểu hàm, không <mark>raise</mark> lung tung.
