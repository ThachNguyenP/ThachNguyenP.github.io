---
layout: post
title:  "121. Functional Programming (Composition, Currying & Pipeline)."
date:   2026-10-03 02:20:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_121/fp-composition.png
---
Lệnh shell <mark>cat log.txt | grep ERROR | sort | uniq -c</mark> là FP: mỗi lệnh nhỏ làm một việc, nối lại bằng ống. Bài này làm điều tương tự với hàm: viết hàm nhỏ, pure, rồi **ghép** thành hàm lớn.

#### Composition với >>
```ruby
# fp3.rb

add_tax = ->(price) { price * 1.1 }
round   = ->(price) { price.round(-3) }     # làm tròn tới nghìn
to_vnd  = ->(price) { "#{price.to_i.to_s.reverse.scan(/\d{1,3}/).join('.').reverse}đ" }

final_price = add_tax >> round >> to_vnd

puts final_price.(199_000) # => 219.000đ
```
<mark>f >> g</mark> tạo hàm mới: chạy <mark>f</mark> trước, đưa kết quả vào <mark>g</mark>. Đọc từ trái sang phải như ống nước. <mark>f << g</mark> thì ngược lại (chạy <mark>g</mark> trước), giống ký hiệu toán học <mark>f ∘ g</mark>, ít dùng hơn vì khó đọc.

Không có <mark>>></mark> thì phải viết <mark>to_vnd.(round.(add_tax.(199_000)))</mark>, lồng nhau và đọc từ trong ra. Hoặc tự định nghĩa
```ruby
compose = ->(f, g) { ->(x) { g.(f.(x)) } }
final_price = compose.(compose.(add_tax, round), to_vnd)
```
Đó chính là tất cả những gì <mark>>></mark> làm.

<mark>>></mark> dùng được với mọi thứ có <mark>call</mark>: lambda, <mark>method(:x)</mark>, hay object tự viết có method <mark>call</mark>
```ruby
def strip_vn_prefix(phone) = phone.sub(/\A(\+84|84)/, "0")

normalize_phone = ->(s) { s.gsub(/\D/, "") } >> method(:strip_vn_prefix)

puts normalize_phone.("+84 (90) 123-4567") # => 0901234567
```

#### Pipeline với then
Khi có **giá trị** và muốn đẩy nó qua một chuỗi hàm, <mark>then</mark> (Ruby 2.6+) đọc tự nhiên hơn
```ruby
result = "  Nguyen Van A  "
  .then { |s| s.strip }
  .then { |s| s.downcase }
  .then { |s| s.split }
  .then { |words| words.map(&:capitalize).join(" ") }

puts result # => Nguyen Van A
```
Hoặc truyền lambda vào <mark>then</mark>
```ruby
puts 199_000.then(&add_tax).then(&round).then(&to_vnd) # => 219.000đ
```
Khi nào dùng cái nào: <mark>>></mark> để **tạo hàm mới** đặt tên và dùng lại nhiều nơi; <mark>then</mark> để **xử lý một giá trị** tại chỗ.

#### Pipeline từ danh sách bước
Vì hàm là giá trị, các bước có thể nằm trong mảng, và <mark>reduce(:>>)</mark> ghép hết lại
```ruby
steps = [
  ->(s) { s.strip },
  ->(s) { s.downcase },
  ->(s) { s.gsub(/\s+/, " ") },
]

clean = steps.reduce(:>>)
puts clean.("  Điện   Thoại  ") # => điện thoại
```
Giờ có thể thêm bớt bước theo điều kiện, hay cấu hình pipeline từ bên ngoài
```ruby
steps << ->(s) { s.delete("đ") } if ENV["ASCII_ONLY"]
```

#### Currying và partial application
Hàm 2 tham số nhưng ta chỉ biết 1 tham số lúc này, tham số còn lại biết sau. Ví dụ hàm giảm giá
```ruby
discount = ->(percent, price) { price * (100 - percent) / 100 }

puts discount.(10, 200_000) # => 180000
```
Muốn một hàm "giảm 10%" để truyền vào <mark>map</mark>, bài 120 đã làm bằng closure (<mark>make_discount</mark>). <mark>curry</mark> làm việc đó tự động
```ruby
ten_off = discount.curry[10]

puts ten_off.(200_000)                    # => 180000
p [100_000, 200_000].map(&ten_off)        # => [90000, 180000]
```
<mark>curry</mark> biến hàm <mark>(percent, price)</mark> thành hàm nhận <mark>percent</mark>, trả về hàm nhận <mark>price</mark>. Gọi đủ tham số vẫn được: <mark>discount.curry[10][200_000]</mark> hoặc <mark>discount.curry.(10, 200_000)</mark>.

Điều này gọi là **partial application**: cố định trước vài tham số. Mẹo để nó tiện: **đặt tham số ít thay đổi lên trước** (percent), tham số là dữ liệu chính (price) ở cuối. Nhờ vậy hàm sau khi curry khớp luôn với <mark>map</mark>.

Ví dụ thực tế hơn: hàm format với cấu hình
```ruby
format_money = ->(currency, amount) { "#{amount.to_s.reverse.scan(/\d{1,3}/).join('.').reverse} #{currency}" }

vnd = format_money.curry["VND"]
usd = format_money.curry["USD"]

puts vnd.(1_500_000) # => 1.500.000 VND
puts usd.(1200)      # => 1.200 USD
```

#### Ghép tất cả: xử lý đơn hàng
Một bài toán nhỏ: từ danh sách đơn hàng, tính doanh thu các đơn đã thanh toán trong tháng, sau thuế, in ra dạng tiền
```ruby
Order = Data.define(:id, :status, :total, :month)

orders = [
  Order.new(id: 1, status: "paid", total: 150_000, month: 10),
  Order.new(id: 2, status: "pending", total: 90_000, month: 10),
  Order.new(id: 3, status: "paid", total: 300_000, month: 10),
  Order.new(id: 4, status: "paid", total: 50_000, month: 9),
]

paid       = ->(list) { list.select { |o| o.status == "paid" } }
in_month   = ->(month, list) { list.select { |o| o.month == month } }
sum_total  = ->(list) { list.sum(&:total) }

revenue_report = paid >> in_month.curry[10] >> sum_total >> add_tax >> round >> to_vnd

puts revenue_report.(orders) # => 495.000đ
```
Mỗi hàm một dòng, mỗi hàm test riêng được, và dòng cuối đọc như mô tả yêu cầu. Muốn báo cáo tháng 9? <mark>in_month.curry[9]</mark>. Muốn bỏ thuế? Bỏ <mark>add_tax</mark> khỏi chuỗi.

So với cách viết thường
```ruby
def revenue_report(orders, month)
  total = 0
  orders.each do |o|
    next unless o.status == "paid" && o.month == month
    total += o.total
  end
  total = (total * 1.1).round(-3)
  "#{total.to_i.to_s.reverse.scan(/\d{1,3}/).join('.').reverse}đ"
end
```
Không sai, nhưng muốn tái sử dụng phần "lọc đơn đã thanh toán" ở chỗ khác thì phải copy, và test thì phải test cả cục.

#### Point-free và khi nào dừng lại
Code như <mark>paid >> in_month.curry[10] >> sum_total</mark> không nhắc tới dữ liệu đang xử lý (không có biến <mark>orders</mark> hay <mark>x</mark>), gọi là **point-free style**. Gọn, nhưng lạm dụng thì khó đọc. Vài nguyên tắc tôi dùng:
- Mỗi hàm trong chuỗi phải có **tên rõ nghĩa**. <mark>f >> g >> h</mark> thì không ai hiểu.
- Chuỗi dài quá 5 - 6 bước thì chia thành chuỗi con có tên.
- Nếu một bước cần 2 - 3 giá trị từ các bước trước, composition không hợp, viết hàm thường với biến tạm sẽ rõ hơn.
- <mark>curry</mark> hay, nhưng closure thường (<mark>make_discount</mark> ở bài 120) nhiều khi dễ hiểu hơn với người mới đọc code.

#### Tóm tắt
- <mark>f >> g</mark>: ghép hàm, chạy trái sang phải. Dùng với lambda, <mark>method(:x)</mark>, object có <mark>call</mark>.
- <mark>value.then { }</mark>: đẩy một giá trị qua chuỗi bước.
- <mark>steps.reduce(:>>)</mark>: ghép pipeline từ mảng hàm.
- <mark>curry</mark>: cố định trước tham số. Đặt tham số cấu hình trước, dữ liệu sau.
- Hàm nhỏ, có tên, pure, rồi ghép lại. Đừng ghép tới mức không đọc được.

Bài tiếp theo: biến đổi dữ liệu lớn hơn mà không mutation, đệ quy, và xử lý dãy vô hạn với lazy.
