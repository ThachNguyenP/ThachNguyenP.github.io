---
layout: post
title:  "120. Functional Programming (Hàm là giá trị)."
date:   2026-10-03 02:18:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_120/fp-first-class-function.png
---
Trong FP, hàm là **giá trị** như số hay chuỗi: gán được vào biến, truyền vào hàm khác, trả về từ hàm khác. Nghe trừu tượng, nhưng bạn đã dùng nó mỗi ngày: <mark>[1, 2, 3].map { |x| x * 2 }</mark> chính là truyền một hàm (block) vào <mark>map</mark>. Bài này làm rõ cơ chế đó.

#### Lambda
```ruby
# fp2.rb

double = ->(x) { x * 2 }

puts double.call(3) # => 6
puts double.(3)     # => 6, cách viết ngắn
puts double[3]      # => 6, cách viết ngắn khác
p double            # => #<Proc:0x... (lambda)>
```
<mark>double</mark> là một biến chứa hàm. Có 3 cách gọi, <mark>.()</mark> hay dùng nhất. Lambda nhiều dòng
```ruby
vnd = ->(amount) do
  formatted = amount.to_s.reverse.scan(/\d{1,3}/).join(".").reverse
  "#{formatted}đ"
end

puts vnd.(1_500_000) # => 1.500.000đ
```

#### Truyền hàm vào hàm
Hàm nhận hàm khác làm tham số gọi là **higher-order function**
```ruby
def apply_twice(f, x)
  f.(f.(x))
end

puts apply_twice(double, 3)              # => 12
puts apply_twice(->(s) { s + "!" }, "Hi") # => Hi!!
```
<mark>apply_twice</mark> không biết <mark>f</mark> làm gì, chỉ biết gọi nó 2 lần. Đây là cách tách "làm gì" khỏi "làm như thế nào".

Tự viết lại <mark>map</mark> để thấy nó không có gì bí ẩn
```ruby
def my_map(array, f)
  result = []
  array.each { |x| result << f.(x) }
  result
end

p my_map([1, 2, 3], double)            # => [2, 4, 6]
p my_map(%w[a b], ->(s) { s.upcase })  # => ["A", "B"]
```
<mark>my_select</mark>, <mark>my_reduce</mark> cũng tương tự, bạn thử tự viết.

#### Block là hàm
Ruby có cú pháp riêng để truyền **một** hàm vào method: block. <mark>yield</mark> gọi block đó
```ruby
def my_map(array)
  result = []
  array.each { |x| result << yield(x) }
  result
end

p my_map([1, 2, 3]) { |x| x * 2 } # => [2, 4, 6]
```
Muốn giữ block lại như một giá trị, thêm tham số <mark>&block</mark>; muốn truyền lambda vào chỗ block, thêm <mark>&</mark> trước lambda
```ruby
def my_map(array, &block)
  array.each_with_object([]) { |x, result| result << block.(x) }
end

p my_map([1, 2, 3], &double) # => [2, 4, 6]
p [1, 2, 3].map(&double)     # => [2, 4, 6], map có sẵn cũng nhận lambda như vậy
```
Và <mark>&:upcase</mark> mà bạn hay thấy chính là <mark>&</mark> áp lên một Symbol, Ruby tự chuyển thành <mark>->(x) { x.upcase }</mark>
```ruby
p %w[a b].map(&:upcase)  # => ["A", "B"]
p [1, 2, 3].sum(&:abs)   # => 6
```

#### Method cũng là giá trị
Method đã định nghĩa bằng <mark>def</mark> lấy ra thành object bằng <mark>method(:tên)</mark>
```ruby
def shout(s) = s.upcase + "!"

say = method(:shout)
puts say.("hi")              # => HI!
p %w[a b].map(&method(:shout)) # => ["A!", "B!"]
```
Hay dùng khi muốn truyền một method có sẵn vào <mark>map</mark>, <mark>each</mark>: <mark>list.each(&method(:puts))</mark>.

#### Trả về hàm từ hàm, closure
Hàm trả về hàm, và hàm được trả về **nhớ** các biến ở nơi nó được tạo. Đó là **closure**
```ruby
def make_discount(percent)
  ->(price) { price * (100 - percent) / 100 }
end

ten_off = make_discount(10)
half    = make_discount(50)

puts ten_off.(200_000) # => 180000
puts half.(200_000)    # => 100000
```
<mark>ten_off</mark> mang theo <mark>percent = 10</mark> dù <mark>make_discount</mark> đã chạy xong từ lâu. Đây là cách tạo ra một "họ" các hàm từ một khuôn.

Closure cũng có thể giữ **trạng thái**, đây là chỗ cần cẩn thận
```ruby
def make_counter
  count = 0
  -> { count += 1 }
end

counter = make_counter
puts counter.() # => 1
puts counter.() # => 2
```
Hàm này **không pure** (mỗi lần gọi một kết quả). Hữu ích trong vài trường hợp (tạo id tạm, generator), nhưng trong FP nên hạn chế; ưu tiên closure chỉ **đọc** biến ngoài như <mark>make_discount</mark>.

#### Proc và lambda
Ruby có 2 loại hàm ẩn danh. <mark>->(x) {}</mark> là lambda, <mark>Proc.new {}</mark> hay <mark>proc {}</mark> là proc. Khác nhau 2 điểm
```ruby
l = ->(a, b) { a + b }
pr = proc { |a, b| a.to_i + b.to_i }

puts pr.(1)      # => 1, proc bỏ qua tham số thiếu/thừa

def test_lambda = ->{ return 1 }.() + 1
def test_proc   = proc { return 1 }.() + 1

puts test_lambda # => 2, return chỉ thoát khỏi lambda
puts test_proc   # => 1, return thoát luôn khỏi method bao ngoài

l.(1)            # => ArgumentError: wrong number of arguments (given 1, expected 2)
```
Quy tắc đơn giản: **luôn dùng lambda** (<mark>-></mark>). Proc chủ yếu xuất hiện dưới dạng block.

#### Những higher-order function có sẵn
Ruby có rất nhiều, tất cả đều nhận một hàm (block) và không sửa mảng gốc. Ví dụ với danh sách đơn hàng
```ruby
Order = Data.define(:id, :status, :total)

orders = [
  Order.new(id: 1, status: "paid", total: 150_000),
  Order.new(id: 2, status: "pending", total: 90_000),
  Order.new(id: 3, status: "paid", total: 300_000),
  Order.new(id: 4, status: "cancelled", total: 50_000),
]

p orders.map(&:total)                        # => [150000, 90000, 300000, 50000]
p orders.select { |o| o.status == "paid" }.map(&:id)   # => [1, 3]
p orders.reject { |o| o.status == "cancelled" }.size   # => 3
p orders.sum(&:total)                        # => 590000
p orders.max_by(&:total).id                  # => 3
p orders.sort_by { |o| -o.total }.map(&:id)  # => [3, 1, 2, 4]
p orders.group_by(&:status).transform_values(&:size)  # => {"paid" => 2, "pending" => 1, "cancelled" => 1}
p orders.partition { |o| o.total >= 100_000 }.map(&:size) # => [2, 2]
p orders.map(&:status).tally                 # => {"paid" => 2, "pending" => 1, "cancelled" => 1}
p orders.find { |o| o.total > 200_000 }&.id  # => 3
p orders.any? { |o| o.status == "pending" }  # => true
p orders.each_slice(2).map { |pair| pair.map(&:id) } # => [[1, 2], [3, 4]]
```
Và <mark>reduce</mark>, hàm tổng quát nhất, mọi hàm trên đều viết được bằng nó
```ruby
total = orders.reduce(0) { |sum, o| sum + o.total }
p total # => 590000

by_status = orders.reduce({}) do |acc, o|
  acc.merge(o.status => acc.fetch(o.status, 0) + o.total)
end
p by_status # => {"paid" => 450000, "pending" => 90000, "cancelled" => 50000}
```
<mark>reduce(giá_trị_đầu) { |tích_lũy, phần_tử| giá_trị_tích_lũy_mới }</mark>. Để ý <mark>acc.merge</mark> trả về hash mới thay vì <mark>acc[key] = ...</mark>, giữ đúng tinh thần không mutation. Bài 122 sẽ bàn khi nào nên và không nên làm vậy.

#### Thay vòng lặp bằng hàm
Code kiểu mệnh lệnh (imperative)
```ruby
paid_ids = []
orders.each do |o|
  if o.status == "paid"
    paid_ids << o.id
  end
end
```
Kiểu hàm (declarative)
```ruby
paid_ids = orders.select { |o| o.status == "paid" }.map(&:id)
```
Ngắn hơn, không có biến tạm bị sửa dần, và đọc lên giống mô tả yêu cầu: "chọn đơn đã thanh toán, lấy id". Khi thấy mình viết <mark>each</mark> với một mảng rỗng bên trên và <mark><<</mark> bên trong, gần như luôn có một hàm làm sẵn: <mark>map</mark>, <mark>select</mark>, <mark>flat_map</mark>, <mark>each_with_object</mark>, <mark>sum</mark>.

#### Tóm tắt
- Lambda <mark>->(x) { }</mark> là hàm dưới dạng giá trị. Gọi bằng <mark>.()</mark>.
- Block là cách Ruby truyền một hàm vào method; <mark>&</mark> chuyển qua lại giữa block, lambda, symbol, method.
- Hàm trả về hàm tạo ra closure, nhớ được biến nơi nó sinh ra.
- Dùng lambda, không dùng proc.
- <mark>map</mark>, <mark>select</mark>, <mark>reduce</mark>, <mark>group_by</mark>... thay cho <mark>each</mark> với biến tạm.

Bài tiếp theo: có hàm là giá trị rồi, ta có thể **ghép** các hàm nhỏ thành hàm lớn như ghép ống nước.
