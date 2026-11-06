---
layout: post
title:  "075. 2FA with Authenticator app (Rails API)."
date:   2026-10-03 00:50:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_075/rails-api-2fa.png
---
Ở bài 041 tôi đã có một bài về 2FA cho Rails dạng web (session, view). Bài này làm lại cho **Rails API** (FE/Mobile gọi vào), và tận dụng các tính năng mới của Rails 8 để code gọn và an toàn hơn.

#### Authenticator app hoạt động thế nào
Các app như Google Authenticator, Microsoft Authenticator, 1Password... đều dùng chuẩn **TOTP** (Time-based One-Time Password):
1. Server tạo một **secret** ngẫu nhiên cho user, gửi cho user dưới dạng QR code.
2. User quét QR code, app lưu secret lại.
3. Cứ 30 giây, app tính ra một mã 6 số từ **secret + thời gian hiện tại**. Server cũng tính được y hệt, nên so sánh là biết đúng hay sai.

Server và app không cần kết nối gì với nhau, chỉ cần dùng chung secret và đồng hồ đúng giờ.

#### Version sử dụng
- Ruby 3.4, Rails 8
- gem <mark>rotp</mark>: tạo và kiểm tra mã TOTP
- gem <mark>rqrcode</mark>: tạo QR code

#### Cài đặt
```sh
bundle add rotp rqrcode
rails g migration AddTwoFactorToUsers otp_secret:string otp_enabled:boolean otp_last_used_at:integer otp_backup_codes:text
rails db:migrate
```
- <mark>otp_secret</mark>: secret của user.
- <mark>otp_enabled</mark>: user đã bật 2FA chưa.
- <mark>otp_last_used_at</mark>: thời điểm mã cuối cùng được dùng, để chống dùng lại mã cũ.
- <mark>otp_backup_codes</mark>: mã dự phòng khi mất điện thoại.

Secret mà bị lộ thì 2FA coi như vô dụng, nên chúng ta sẽ mã hóa nó trong DB bằng **Active Record Encryption**. Chạy lệnh sau, rồi copy các key được in ra vào <mark>rails credentials:edit</mark>
```sh
bin/rails db:encryption:init
```

#### Model
```ruby
# app/models/user.rb

class User < ApplicationRecord
  has_secure_password

  serialize :otp_backup_codes, coder: JSON, type: Array
  encrypts :otp_secret, :otp_backup_codes

  # token tạm thời giữa bước nhập password và bước nhập OTP
  generates_token_for :otp_login, expires_in: 5.minutes do
    otp_last_used_at
  end

  def otp_provisioning_uri
    totp.provisioning_uri(email)
  end

  def verify_otp(code)
    timestamp = totp.verify(code.to_s, drift_behind: 15, after: otp_last_used_at)
    return false unless timestamp

    update!(otp_last_used_at: timestamp)
  end

  def generate_backup_codes!
    codes = Array.new(10) { SecureRandom.hex(4) }
    update!(otp_backup_codes: codes)
    codes
  end

  def use_backup_code!(code)
    return false unless otp_backup_codes.include?(code.to_s)

    update!(otp_backup_codes: otp_backup_codes - [code.to_s])
  end

  private

  def totp
    ROTP::TOTP.new(otp_secret, issuer: "MyShop")
  end
end
```
Giải thích một chút:
- <mark>encrypts</mark>: Rails tự mã hóa khi lưu và giải mã khi đọc, code vẫn dùng <mark>user.otp_secret</mark> như bình thường.
- <mark>drift_behind: 15</mark>: chấp nhận mã của 15 giây trước, phòng khi user nhập chậm hoặc đồng hồ điện thoại hơi lệch.
- <mark>after: otp_last_used_at</mark>: mã đã dùng rồi thì không dùng lại được, kể cả khi vẫn còn trong 30 giây. Nếu ai đó nhìn trộm được mã thì cũng không dùng được nữa.
- <mark>issuer</mark>: tên app hiển thị trong authenticator app.
- <mark>generates_token_for</mark>: tạo token có thời hạn mà không cần lưu DB. Block <mark>otp_last_used_at</mark> nghĩa là: khi user nhập OTP thành công, giá trị này thay đổi, token cũ sẽ tự hết hiệu lực.

#### Bật 2FA
Gồm 2 bước: lấy QR code, rồi nhập mã đầu tiên để xác nhận. Phải có bước xác nhận, nếu không user quét lỗi mà 2FA vẫn được bật thì sẽ không đăng nhập được nữa.
```ruby
# app/controllers/two_factor_controller.rb

class TwoFactorController < ApplicationController
  before_action :authenticate_user! # tùy vào cách authen của dự án

  # POST /two_factor/setup
  def setup
    if current_user.otp_enabled?
      return render json: { message: "2FA is already enabled" }, status: :unprocessable_entity
    end

    current_user.update!(otp_secret: ROTP::Base32.random)
    uri = current_user.otp_provisioning_uri

    render json: {
      otp_uri: uri,
      qr_svg: RQRCode::QRCode.new(uri).as_svg(module_size: 4)
    }
  end

  # POST /two_factor/enable
  def enable
    unless current_user.verify_otp(params[:code])
      return render json: { message: "Invalid code" }, status: :unprocessable_entity
    end

    current_user.update!(otp_enabled: true)
    render json: { backup_codes: current_user.generate_backup_codes! }
  end

  # DELETE /two_factor
  def destroy
    unless current_user.verify_otp(params[:code])
      return render json: { message: "Invalid code" }, status: :unprocessable_entity
    end

    current_user.update!(otp_enabled: false, otp_secret: nil, otp_backup_codes: [])
    head :no_content
  end
end
```
- FE dùng <mark>qr_svg</mark> để hiển thị QR code. Mobile app thì có thể dùng thẳng <mark>otp_uri</mark> (dạng <mark>otpauth://totp/MyShop:nolan@example.com?secret=...</mark>) để mở authenticator app trên cùng điện thoại.
- <mark>backup_codes</mark> chỉ được trả về **một lần duy nhất**, FE cần nhắc user lưu lại.

```ruby
# config/routes.rb

resource :two_factor, only: :destroy, controller: "two_factor" do
  post :setup
  post :enable
end
```

#### Đăng nhập với 2FA
Flow sẽ như sau:
1. <mark>POST /login</mark> với email, password. Nếu user đã bật 2FA, không trả access token mà trả về một <mark>otp_token</mark> tạm thời.
2. <mark>POST /login/otp</mark> với <mark>otp_token</mark> và mã 6 số. Đúng thì mới trả về access token.

```ruby
# app/controllers/sessions_controller.rb

class SessionsController < ApplicationController
  rate_limit to: 5, within: 1.minute, only: :verify_otp,
             with: -> { render json: { message: "Too many attempts" }, status: :too_many_requests }

  # POST /login
  def create
    user = User.authenticate_by(email: params[:email], password: params[:password])
    return render json: { message: "Invalid email or password" }, status: :unauthorized unless user

    if user.otp_enabled?
      render json: { otp_required: true, otp_token: user.generate_token_for(:otp_login) }
    else
      render json: { access_token: issue_access_token(user) }
    end
  end

  # POST /login/otp
  def verify_otp
    user = User.find_by_token_for(:otp_login, params[:otp_token])
    return render json: { message: "Session expired, please login again" }, status: :unauthorized unless user

    if user.verify_otp(params[:code]) || user.use_backup_code!(params[:code])
      render json: { access_token: issue_access_token(user) }
    else
      render json: { message: "Invalid code" }, status: :unauthorized
    end
  end
end
```
- <mark>issue_access_token</mark>: hàm tạo token của dự án các bro (JWT, Keycloak...), bài này không đi sâu.
- <mark>User.authenticate_by</mark>: có từ Rails 7.1, tự chống timing attack khi kiểm tra email, password.
- <mark>rate_limit</mark>: có từ Rails 7.2. Mã chỉ có 6 số, tức là 1 triệu khả năng, nên bắt buộc phải giới hạn số lần thử để chống brute force.

#### Test nhanh
```sh
curl -X POST http://localhost:3000/login -H "Content-Type: application/json" \
  -d '{"email": "nolan@example.com", "password": "secret"}'
# => {"otp_required":true,"otp_token":"eyJfcmFpbHMi..."}

curl -X POST http://localhost:3000/login/otp -H "Content-Type: application/json" \
  -d '{"otp_token": "eyJfcmFpbHMi...", "code": "123456"}'
# => {"access_token":"..."}
```
Khi viết test, có thể tạo mã đúng bằng <mark>ROTP::TOTP.new(user.otp_secret).now</mark>.

#### Tóm tắt
- Secret phải được **mã hóa** trong DB (<mark>encrypts</mark>).
- Phải **xác nhận mã** trước khi bật 2FA.
- **Chống dùng lại mã** với <mark>after:</mark>.
- **Giới hạn số lần thử** với <mark>rate_limit</mark>.
- Luôn có **backup codes**.
