---
layout: post
title:  "088. Bot & Abuse protection (Account takeover)."
date:   2026-11-03 01:19:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_088/bot-abuse-account.png
---
Tài khoản bị chiếm là thứ user sợ nhất, và cũng ảnh hưởng tới uy tín của app nhiều nhất. Bài này nói về **credential stuffing**, **account takeover** và **user enumeration**.

#### Credential stuffing là gì
Mỗi năm có hàng tỉ email/password bị lộ từ các trang web khác. Người dùng lại hay dùng **một password cho nhiều trang**. Kẻ tấn công lấy danh sách này, dùng bot thử đăng nhập vào app của mình. Chỉ cần 0,1% thành công, với 1 triệu cặp email/password là đã có 1.000 tài khoản bị chiếm.

Khác với brute force (thử nhiều password cho **một** tài khoản), credential stuffing thử **một** password cho **rất nhiều** tài khoản, từ rất nhiều IP. Vì vậy rate limit theo IP hay theo email ở bài 087 chỉ chặn được một phần.

#### 1. Chặn password đã bị lộ
Cách hiệu quả nhất: không cho user đặt password đã từng bị lộ. Dịch vụ **Have I Been Pwned** có danh sách hơn 800 triệu password bị lộ, và gem <mark>pwned</mark> giúp kiểm tra rất dễ.
```sh
bundle add pwned
```
```ruby
# app/models/user.rb

class User < ApplicationRecord
  has_secure_password
  validates :password, not_pwned: true, if: :password_digest_changed?
end
```
Yên tâm là password **không bị gửi đi**: gem chỉ gửi 5 ký tự đầu của mã hash SHA-1, rồi so sánh phần còn lại ở local. Cách này gọi là **k-anonymity**.

Ngoài ra password nên dài ít nhất 12 ký tự. Độ dài quan trọng hơn bắt buộc có chữ hoa, ký tự đặc biệt.

#### 2. Không để lộ email nào đã đăng ký
Nếu login trả về "Email không tồn tại" và "Sai password" khác nhau, kẻ tấn công biết được email nào có tài khoản, rồi chỉ tập trung tấn công những email đó. Đây gọi là **user enumeration**.
```ruby
# app/controllers/sessions_controller.rb

def create
  user = User.authenticate_by(email: params[:email], password: params[:password])

  if user
    # đăng nhập thành công...
  else
    render json: { message: "Email hoặc mật khẩu không đúng" }, status: :unauthorized
  end
end
```
<mark>authenticate_by</mark> còn chống **timing attack**: email không tồn tại thì nó vẫn tốn thời gian kiểm tra password như bình thường, nên không thể đo thời gian phản hồi để đoán.

Quên mật khẩu cũng vậy, luôn trả về cùng một câu
```ruby
# app/controllers/password_resets_controller.rb

def create
  if (user = User.find_by(email: params[:email]))
    PasswordMailer.reset(user).deliver_later
  end

  render json: { message: "Nếu email tồn tại, bạn sẽ nhận được hướng dẫn đặt lại mật khẩu" }
end
```
Còn form đăng ký thì khó tránh được việc báo "Email đã được sử dụng". Ở đó cần rate limit chặt và Turnstile (bài 086).

#### 3. Cảnh báo khi đăng nhập từ thiết bị mới
Kể cả khi kẻ tấn công đăng nhập được, nếu user được báo ngay thì vẫn kịp đổi password. Lưu lại các thiết bị đã từng đăng nhập
```sh
rails g model KnownDevice user:references device_id:string:index user_agent:string ip:string last_seen_at:datetime
```
```ruby
# app/services/new_device_checker.rb

class NewDeviceChecker
  def self.call(user:, device_id:, request:)
    device = user.known_devices.find_or_initialize_by(device_id:)
    new_device = device.new_record?

    device.update!(user_agent: request.user_agent, ip: request.remote_ip, last_seen_at: Time.current)
    SecurityMailer.new_device_login(user, device).deliver_later if new_device && user.known_devices.count > 1
  end
end
```
- <mark>device_id</mark>: một chuỗi ngẫu nhiên do app Mobile tự tạo và lưu lại, hoặc lưu trong cookie lâu dài với web.
- Email cảnh báo nên có thời gian, thiết bị, vị trí gần đúng, và một nút "Đây không phải tôi" để khóa tài khoản và đăng xuất mọi nơi.

#### 4. Xác thực lại khi làm việc quan trọng
Đổi email, đổi password, tắt 2FA, rút tiền... phải nhập lại password hoặc mã OTP, kể cả khi đã đăng nhập. Nếu không, chỉ cần lấy được token hay cookie là chiếm được tài khoản vĩnh viễn.
```ruby
# app/controllers/emails_controller.rb

def update
  unless current_user.authenticate(params[:current_password])
    return render json: { message: "Mật khẩu không đúng" }, status: :unauthorized
  end

  current_user.update!(email: params[:email])
  SecurityMailer.email_changed(current_user, previous_email: current_user.email_previously_was).deliver_later
end
```
Gửi thông báo về **email cũ** khi email thay đổi, để chủ tài khoản thật còn biết mà xử lý.

#### 5. Đăng xuất khỏi mọi thiết bị
Khi user đổi password hoặc báo bị hack, phải hủy tất cả các phiên đăng nhập khác. Nếu dùng generator <mark>rails g authentication</mark> của Rails 8, mỗi lần đăng nhập là một record <mark>Session</mark>, nên việc này rất đơn giản
```ruby
current_user.sessions.where.not(id: Current.session.id).destroy_all
```
Nếu dùng JWT thì cần có cơ chế thu hồi token, ví dụ lưu một <mark>token_version</mark> trong bảng users và tăng nó lên mỗi khi cần thu hồi.

#### Tóm tắt
| Biện pháp | Chặn được |
|---|---|
| Rate limit theo IP, email (087) | Brute force, một phần credential stuffing |
| Chặn password bị lộ | Credential stuffing |
| 2FA (041, 075) | Gần như mọi kiểu chiếm tài khoản bằng password |
| Cùng một thông báo lỗi | User enumeration |
| Cảnh báo thiết bị mới | Phát hiện sớm khi bị chiếm |
| Xác thực lại, đăng xuất mọi nơi | Giảm thiệt hại khi bị chiếm |
