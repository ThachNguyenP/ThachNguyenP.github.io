---
layout: post
title:  "123. Functional Programming (Xử lý lỗi với Result)."
date:   2026-10-03 02:24:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_123/fp-result.png
---
Đăng ký tài khoản: kiểm tra email, kiểm tra mật khẩu, tạo user, gửi email chào mừng. Bước nào cũng có thể thất bại. Cách viết hay gặp
```ruby
def register(params)
  raise InvalidEmail unless params[:email].match?(/@/)
  raise WeakPassword if params[:password].length < 8
  user = create_user(params)
  send_welcome(user)
  user
end
```
Người gọi phải biết hàm này có thể raise những gì (không có trong chữ ký hàm), bọc <mark>rescue</mark> cho từng loại, và một <mark>raise</mark> quên <mark>rescue</mark> là 500. Exception hợp với lỗi **bất ngờ** (mất kết nối database); còn email sai định dạng là chuyện **bình thường**, xảy ra mỗi ngày, nên được xử lý như dữ liệu.

#### Result: thành công hoặc thất bại, đều là giá trị
Ý tưởng: hàm **luôn trả về** một trong hai thứ, <mark>Success(giá trị)</mark> hoặc <mark>Failure(lỗi)</mark>. Không raise, không trả về <mark>nil</mark> mập mờ.
```ruby
# fp5.rb

Success = Data.define(:value)
Failure = Data.define(:error)

def validate_email(params)
  return Failure.new(error: "Email không hợp lệ") unless params[:email].to_s.match?(/\A[^@\s]+@[^@\s]+\z/)

  Success.new(value: params)
end

p validate_email(email: "a@b.com") # => #<data Success value={email: "a@b.com"}>
p validate_email(email: "abc")     # => #<data Failure error="Email không hợp lệ">
```
Người gọi nhìn kết quả là biết chuyện gì xảy ra, và Ruby có pattern matching để xử lý rất gọn
```ruby
case validate_email(email: "abc")
in Success(value:) then puts "OK: #{value}"
in Failure(error:) then puts "Lỗi: #{error}"
end
# => Lỗi: Email không hợp lệ
```

#### Nối các bước: and_then
Vấn đề: 4 bước, mỗi bước trả về Result, nối chúng lại thế nào mà không phải <mark>case</mark> 4 lần? Thêm một method cho Result: <mark>and_then</mark> nhận block, **chỉ chạy block khi đang là Success**, còn Failure thì bỏ qua và trả về chính nó
```ruby
Success = Data.define(:value) do
  def and_then = yield(value)
  def success? = true
end

Failure = Data.define(:error) do
  def and_then = self      # đang lỗi thì không làm gì nữa, truyền lỗi tiếp
  def success? = false
end
```
Giờ viết các bước
```ruby
def validate_password(params)
  return Failure.new(error: "Mật khẩu phải từ 8 ký tự") if params[:password].to_s.length < 8

  Success.new(value: params)
end

def create_user(params)
  return Failure.new(error: "Email đã tồn tại") if params[:email] == "taken@b.com"

  Success.new(value: { id: 1, email: params[:email] })
end

def send_welcome(user)
  puts "Gửi email tới #{user[:email]}"  # side effect, nằm ở bước cuối
  Success.new(value: user)
end

def register(params)
  validate_email(params)
    .and_then { |p| validate_password(p) }
    .and_then { |p| create_user(p) }
    .and_then { |u| send_welcome(u) }
end
```
Chạy thử 3 trường hợp
```ruby
p register(email: "abc", password: "12345678")
# => #<data Failure error="Email không hợp lệ">

p register(email: "taken@b.com", password: "12345678")
# => #<data Failure error="Email đã tồn tại">

p register(email: "new@b.com", password: "12345678")
# Gửi email tới new@b.com
# => #<data Success value={id: 1, email: "new@b.com"}>
```
Trường hợp 1 dừng ngay ở bước đầu; không có email nào được gửi, không có user nào được tạo. Không cần <mark>if</mark> nào trong <mark>register</mark>.

Hình ảnh hay dùng cho mô hình này là **đường ray** (railway-oriented programming): có 2 đường ray, thành công và thất bại. Mỗi bước là một bộ chuyển ray: đang ở ray thành công thì có thể tiếp tục hoặc rẽ sang ray thất bại; đã ở ray thất bại thì đi thẳng tới cuối, bỏ qua mọi bước.
```
validate_email  validate_password  create_user  send_welcome
Success ───────────────────────────────────────────────────► Success
         ╲               ╲               ╲
Failure ──────────────────────────────────────────────────► Failure
```

#### Controller xử lý ở cuối
Chỉ **một** chỗ quyết định làm gì với kết quả, ở rìa chương trình
```ruby
case register(params)
in Success(value: user) then redirect_to user, notice: "Chào mừng!"
in Failure(error:) then render :new, alert: error
end
```
So với rescue nhiều loại exception, cách này buộc bạn xử lý cả 2 nhánh (bỏ một nhánh là <mark>NoMatchingPatternError</mark>), và lỗi mang theo dữ liệu có cấu trúc (có thể là <mark>{ field: :email, message: "..." }</mark> thay vì chuỗi).

#### Thêm vài tiện ích
Vài method nữa để dùng thoải mái trong thực tế
```ruby
Success = Data.define(:value) do
  def and_then = yield(value)
  def map = Success.new(value: yield(value))   # biến đổi giá trị, không thể thất bại
  def value_or(_default) = value
  def success? = true
end

Failure = Data.define(:error) do
  def and_then = self
  def map = self
  def value_or(default) = default
  def success? = false
end

result = Success.new(value: 100_000).map { |v| v * 1.1 }.map(&:round)
p result                # => #<data Success value=110000>
p result.value_or(0)    # => 110000
p Failure.new(error: "x").map { |v| v * 2 }.value_or(0) # => 0
```
<mark>map</mark> cho bước không thể thất bại (chỉ biến đổi), <mark>and_then</mark> cho bước có thể thất bại (trả về Result). <mark>value_or</mark> lấy giá trị hoặc mặc định ở cuối chuỗi.

Bọc code có thể raise (thư viện bên ngoài) thành Result ở ranh giới
```ruby
def try(&block)
  Success.new(value: block.call)
rescue StandardError => e
  Failure.new(error: e.message)
end

p try { Integer("42") }  # => #<data Success value=42>
p try { Integer("abc") } # => #<data Failure error="invalid value for Integer(): \"abc\"">
```
Exception vẫn dùng cho lỗi lập trình và lỗi hạ tầng; Result cho lỗi nghiệp vụ. Ranh giới giữa hai thế giới là hàm <mark>try</mark> này.

#### Gom nhiều lỗi
Form có 5 field, muốn báo **tất cả** lỗi một lần chứ không dừng ở lỗi đầu. Lúc này không nối bằng <mark>and_then</mark> mà chạy mọi kiểm tra rồi gom lại
```ruby
def validate_all(params, checks)
  errors = checks.filter_map { |check| check.(params) }
  errors.empty? ? Success.new(value: params) : Failure.new(error: errors)
end

checks = [
  ->(p) { "Email không hợp lệ" unless p[:email].to_s.include?("@") },
  ->(p) { "Mật khẩu quá ngắn" if p[:password].to_s.length < 8 },
  ->(p) { "Thiếu tên" if p[:name].to_s.empty? },
]

p validate_all({ email: "x", password: "123" }, checks)
# => #<data Failure error=["Email không hợp lệ", "Mật khẩu quá ngắn", "Thiếu tên"]>
```
Mỗi kiểm tra là một lambda trả về thông báo lỗi hoặc <mark>nil</mark>; <mark>filter_map</mark> bỏ các <mark>nil</mark>. Thêm kiểm tra mới là thêm một lambda vào mảng.

#### nil cũng là một dạng lỗi
<mark>user.address.city</mark> nổ <mark>NoMethodError</mark> khi <mark>address</mark> là <mark>nil</mark>. Ruby có <mark>&.</mark> cho việc này, và <mark>then</mark> kết hợp <mark>&.</mark> tạo chuỗi an toàn
```ruby
user = { address: nil }

city = user[:address]&.then { |a| a[:city] }&.upcase
p city # => nil, không nổ
p city || "Chưa có địa chỉ"
```
Trong các ngôn ngữ FP, đây là kiểu <mark>Maybe</mark>/<mark>Option</mark>. Ruby không có sẵn, nhưng <mark>&.</mark> và <mark>fetch</mark> với default (<mark>hash.fetch(:x, default)</mark>) giải quyết được phần lớn trường hợp. Nguyên tắc: xử lý <mark>nil</mark> **sớm** ở ranh giới (trả về Failure hoặc default), để phần lõi không phải kiểm tra <mark>nil</mark> ở mỗi dòng.

#### dry-monads
Trong dự án thật, không cần tự viết Result. Gem <mark>dry-monads</mark> có sẵn <mark>Success</mark>/<mark>Failure</mark> với đầy đủ <mark>bind</mark> (như <mark>and_then</mark>), <mark>fmap</mark> (như <mark>map</mark>), <mark>value_or</mark>, <mark>Maybe</mark>, và ký hiệu <mark>Do</mark> để viết chuỗi bước như code thường
```ruby
require "dry/monads"

class RegisterUser
  include Dry::Monads[:result, :do]

  def call(params)
    params = yield validate_email(params)     # Failure thì dừng ngay ở đây
    params = yield validate_password(params)
    user   = yield create_user(params)
    yield send_welcome(user)

    Success(user)
  end
end
```
Đọc như code tuần tự, nhưng <mark>yield</mark> sẽ thoát sớm với Failure. Rất hợp với service object trong Rails, bài cuối sẽ dùng.

#### Tóm tắt
- Lỗi nghiệp vụ là **dữ liệu**: trả về <mark>Success</mark>/<mark>Failure</mark>, không raise, không <mark>nil</mark>.
- <mark>and_then</mark> nối các bước có thể thất bại; Failure tự động đi thẳng tới cuối.
- Xử lý kết quả ở **một chỗ** bằng <mark>case in</mark>, bắt buộc có cả 2 nhánh.
- <mark>map</mark> cho biến đổi, <mark>try</mark> để bọc exception, <mark>filter_map</mark> để gom nhiều lỗi.
- Dự án thật: <mark>dry-monads</mark>.
