---
layout: post
title:  "119. Functional Programming (Pure function & Side effect)."
date:   2026-11-03 02:16:00 +0700
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_119/fp-pure-function.png
---
Bạn không cần Haskell hay Elixir để học lập trình hàm (functional programming, FP). FP trước hết là một **cách suy nghĩ** về code: hàm nhận dữ liệu vào, trả dữ liệu ra, không làm gì khác. Cách suy nghĩ này dùng được trong Ruby, JavaScript, Python, và nó làm code dễ test, dễ đọc, ít bug hơn ngay cả khi bạn vẫn viết OOP hằng ngày.

Series này dùng Ruby vì chỉ cần cài Ruby là chạy được mọi ví dụ. Mỗi bài có một file để bạn chạy thử bằng <mark>ruby ten_file.rb</mark>. Lưu ý: những dòng có chú thích <mark># => ...Error</mark> là lỗi cố ý để minh họa, chúng sẽ làm chương trình dừng lại; hãy comment dòng đó sau khi xem xong, hoặc gõ thử trong <mark>irb</mark>. Version sử dụng: Ruby 3.4 (3.2 trở lên đều được).

#### Nội dung series

| Bài | Nội dung |
|---|---|
| 119 | Pure function, side effect, immutability |
| 120 | Hàm là giá trị: lambda, closure, higher-order function |
| 121 | Ghép hàm: composition, currying, pipeline |
| 122 | Biến đổi dữ liệu không mutation, đệ quy, lazy |
| 123 | Xử lý lỗi kiểu hàm: Result, railway |
| 124 | Áp dụng vào dự án Rails |

#### Một hàm "bình thường"
Tạo file <mark>fp1.rb</mark>
```ruby
# fp1.rb

$discount = 10

def price_after_discount(price)
  price - price * $discount / 100
end

puts price_after_discount(200_000) # => 180000

$discount = 50
puts price_after_discount(200_000) # => 100000
```
Cùng một input <mark>200_000</mark>, hai lần gọi ra hai kết quả khác nhau. Để biết hàm trả về gì, phải biết <mark>$discount</mark> đang là bao nhiêu, mà biến đó có thể bị sửa ở bất kỳ đâu trong chương trình. Muốn test hàm này, phải set biến global trước. Đây là kiểu hàm làm cho bug "lúc có lúc không".

#### Pure function
Một hàm là **pure** (thuần) khi thỏa 2 điều:
1. **Cùng input luôn cho cùng output.** Kết quả chỉ phụ thuộc vào tham số.
2. **Không có side effect.** Không thay đổi gì bên ngoài nó: không sửa biến ngoài, không sửa tham số, không ghi file, không gọi API, không in ra màn hình.

```ruby
def price_after_discount(price, discount)
  price - price * discount / 100
end

puts price_after_discount(200_000, 10) # => 180000
puts price_after_discount(200_000, 10) # => 180000, mãi mãi là vậy
```
Chỉ cần đưa <mark>discount</mark> thành tham số. Giờ hàm này:
- Test được bằng một dòng, không cần setup gì.
- Đọc chữ ký hàm là biết nó cần gì.
- Gọi ở đâu, lúc nào, bao nhiêu lần, chạy song song (bài 102) đều cho kết quả như nhau.

#### Side effect ẩn
Side effect không phải lúc nào cũng rõ như biến global. Vài dạng hay gặp:

**Sửa tham số truyền vào**
```ruby
def add_tax!(prices)
  prices.map! { |p| (p * 1.1).round }
end

prices = [100, 200]
add_tax!(prices)
p prices # => [110, 220], mảng gốc đã bị sửa
```
Ai gọi <mark>add_tax!</mark> mà vẫn cần giá gốc sẽ bất ngờ. Ruby đánh dấu các method như vậy bằng <mark>!</mark>, nhưng nhiều method sửa tham số mà không có dấu chấm than (<mark>push</mark>, <mark>delete</mark>, <mark>concat</mark>, <mark><<</mark>). Phiên bản pure trả về mảng **mới**
```ruby
def add_tax(prices)
  prices.map { |p| (p * 1.1).round }
end

prices = [100, 200]
p add_tax(prices) # => [110, 220]
p prices          # => [100, 200], nguyên vẹn
```

**Phụ thuộc vào thời gian, random, môi trường**
```ruby
def greeting
  Time.now.hour < 12 ? "Chào buổi sáng" : "Chào buổi chiều"
end
```
Hàm này test buổi sáng thì pass, buổi chiều thì fail. Đưa thời gian thành tham số
```ruby
def greeting(hour)
  hour < 12 ? "Chào buổi sáng" : "Chào buổi chiều"
end

puts greeting(9)  # => Chào buổi sáng
puts greeting(15) # => Chào buổi chiều
puts greeting(Time.now.hour) # chỗ gọi mới quyết định lấy giờ thật
```
Quy tắc chung: **đẩy side effect ra chỗ gọi**. Hàm pure nhận dữ liệu đã có; việc lấy giờ hiện tại, đọc database, gọi API là việc của lớp ngoài cùng. Bài 124 sẽ nói kỹ cách tổ chức này trong Rails.

**In ra màn hình, ghi log** cũng là side effect. Một hàm vừa tính vừa <mark>puts</mark> thì không tái sử dụng được ở chỗ không muốn in. Tách ra: hàm tính trả về giá trị, chỗ gọi quyết định in hay không.

#### Immutability
Pure function dễ viết hơn nhiều khi dữ liệu **không thể thay đổi** (immutable). Trong Ruby, hầu hết object đều sửa được, kể cả chuỗi
```ruby
name = "thach"
other = name
other << " nguyen"
puts name # => "thach nguyen", vì name và other là cùng một object
```
Cách phòng: <mark>freeze</mark>
```ruby
name = "thach".freeze
name << " nguyen"
# => FrozenError: can't modify frozen String: "thach"
```
Thêm dòng <mark># frozen_string_literal: true</mark> ở đầu file, mọi chuỗi literal trong file tự động freeze. Rails tạo sẵn dòng này cho mọi file mới.

Với hằng số dạng mảng/hash, luôn freeze
```ruby
SHIPPING_FEES = { standard: 30_000, express: 60_000 }.freeze

SHIPPING_FEES[:express] = 0
# => FrozenError: can't modify frozen Hash
```
<mark>freeze</mark> là **nông** (shallow): hash bị khóa nhưng các giá trị bên trong thì chưa. <mark>CONFIG = { tags: ["a"] }.freeze</mark> vẫn cho phép <mark>CONFIG[:tags] << "b"</mark>. Muốn khóa sâu: <mark>Ractor.make_shareable(CONFIG)</mark> (Ruby 3.0+) freeze toàn bộ cây.

Cho dữ liệu có cấu trúc, dùng <mark>Data</mark> (Ruby 3.2+): bất biến sẵn, không cần freeze
```ruby
Point = Data.define(:x, :y)

a = Point.new(x: 1, y: 2)
b = a.with(y: 10)   # muốn "đổi" thì tạo object mới
p a # => #<data Point x=1, y=2>
p b # => #<data Point x=1, y=10>

a.x = 5
# => NoMethodError: undefined method 'x=' for an instance of Point
```
<mark>with</mark> là cách FP "cập nhật": không sửa cái cũ, trả về cái mới. Ai đang giữ <mark>a</mark> không bị ảnh hưởng. Bài 096 (DDD) đã dùng cách này cho value object <mark>Money</mark>.

#### Tại sao đáng làm
- **Test**: pure function test bằng <mark>assert_equal expected, f(input)</mark>, không mock, không setup database.
- **Đọc code**: không cần nhớ trạng thái. Nhìn vào input là biết output.
- **Tái sử dụng**: hàm không gắn với biến global hay object cụ thể nào.
- **Chạy song song**: không có dữ liệu chung bị sửa thì không có race condition (bài 102).
- **Cache**: cùng input cùng output, nên cache được kết quả (memoization) mà không sợ sai.

#### Không phải tất cả đều pure được
Chương trình phải có side effect: lưu database, gửi email, hiển thị ra màn hình, nếu không thì nó vô dụng. Mục tiêu của FP không phải là xóa side effect, mà là **gom chúng lại một chỗ**, ở rìa chương trình, và giữ phần logic ở giữa là pure. Tỷ lệ tốt: 80% code là pure, 20% là lớp vỏ làm việc với thế giới bên ngoài.

#### Thử ngay
Lấy một hàm bất kỳ trong dự án của bạn, hỏi 3 câu:
1. Nó đọc gì ngoài tham số? (biến global, <mark>Time.now</mark>, <mark>ENV</mark>, database, <mark>@instance_variable</mark>)
2. Nó sửa gì ngoài giá trị trả về? (tham số, biến ngoài, file, database)
3. Có tách được phần tính toán thành hàm chỉ nhận và trả dữ liệu không?

Thường câu trả lời cho câu 3 là có, và hàm mới dễ test hơn hẳn. Bài tiếp theo: trong FP, hàm cũng là dữ liệu, có thể truyền vào hàm khác và trả về từ hàm khác.
