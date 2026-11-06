---
layout: post
title:  "086. Bot & Abuse protection (Spam)."
date:   2026-10-03 01:17:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_086/bot-abuse-spam.png
---
Spam là thứ đầu tiên mà gần như app nào cũng gặp: form đăng ký, comment, review, form liên hệ... Bài này dùng 3 lớp đơn giản: **honeypot**, **Cloudflare Turnstile** và **chặn email tạm thời**.

#### Lớp 1: Honeypot
Bot spam thường tự động điền **tất cả** các ô trong form. Honeypot là một ô bị ẩn đi, người thật không nhìn thấy nên không điền, còn bot thì có.
```erb
<!-- app/views/registrations/new.html.erb -->

<%= form_with url: registrations_path do |f| %>
  <%= f.email_field :email %>
  <%= f.password_field :password %>

  <div style="position: absolute; left: -9999px;" aria-hidden="true">
    <%= f.text_field :website, tabindex: -1, autocomplete: "off" %>
  </div>

  <%= f.submit "Đăng ký" %>
<% end %>
```
- Tên field nên trông "thật" như <mark>website</mark>, <mark>company</mark>, để bot không đoán ra.
- Ẩn bằng CSS thay vì <mark>type="hidden"</mark>, vì bot thông minh sẽ bỏ qua các field hidden.
- <mark>tabindex: -1</mark>, <mark>aria-hidden</mark>: người dùng bàn phím và trình đọc màn hình cũng không bị vướng.

Phía controller, nếu field có giá trị thì giả vờ thành công nhưng không làm gì cả. Đừng báo lỗi, để bot không biết mình bị phát hiện.
```ruby
# app/controllers/concerns/honeypot.rb

module Honeypot
  extend ActiveSupport::Concern

  private

  def honeypot_triggered?
    params[:website].present?
  end
end
```
```ruby
class RegistrationsController < ApplicationController
  include Honeypot

  def create
    return head :ok if honeypot_triggered?
    # đăng ký như bình thường...
  end
end
```
Với API cho Mobile/FE, FE cũng có thể gửi kèm field này, nhưng honeypot chủ yếu hiệu quả với form HTML.

Honeypot chặn được phần lớn bot đơn giản, miễn phí, và người dùng không hề biết. Nhưng bot "xịn" hơn thì vượt qua dễ dàng, nên cần thêm lớp 2.

#### Lớp 2: Cloudflare Turnstile
Turnstile là CAPTCHA của Cloudflare, miễn phí, và phần lớn thời gian người dùng **không phải click hay chọn hình gì cả**. Nó chạy ngầm, kiểm tra trình duyệt, rồi cấp một token.

Tạo widget trên trang quản lý của Cloudflare để lấy **site key** (public) và **secret key**. Khi test ở local có thể dùng key test của Cloudflare:
- Site key: <mark>1x00000000000000000000AA</mark>
- Secret key: <mark>1x0000000000000000000000000000000AA</mark>

Phía view, thêm script và widget vào trong form
```erb
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>

<%= form_with url: registrations_path do |f| %>
  <!-- ... -->
  <div class="cf-turnstile" data-sitekey="<%= ENV['TURNSTILE_SITE_KEY'] %>"></div>
  <%= f.submit "Đăng ký" %>
<% end %>
```
Khi submit, form sẽ tự gửi kèm field <mark>cf-turnstile-response</mark>. Với Mobile app hay SPA, FE lấy token rồi gửi kèm trong body.

Phía server, gửi token lên Cloudflare để kiểm tra
```ruby
# app/services/turnstile.rb

class Turnstile
  VERIFY_URL = URI("https://challenges.cloudflare.com/turnstile/v0/siteverify")

  def self.verify(token, remote_ip)
    return false if token.blank?

    response = Net::HTTP.post_form(VERIFY_URL, {
      secret: ENV.fetch("TURNSTILE_SECRET_KEY"),
      response: token,
      remoteip: remote_ip
    })
    JSON.parse(response.body)["success"] == true
  rescue StandardError => e
    Rails.logger.error("Turnstile error: #{e.message}")
    false
  end
end
```
```ruby
def create
  return head :ok if honeypot_triggered?

  unless Turnstile.verify(params["cf-turnstile-response"], request.remote_ip)
    return render json: { message: "Captcha verification failed" }, status: :unprocessable_entity
  end

  # đăng ký như bình thường...
end
```
Mỗi token chỉ dùng được **một lần** và hết hạn sau vài phút, nên bot không thể lấy một token rồi dùng lại mãi.

Ngoài Turnstile còn có Google reCAPTCHA, hCaptcha, cách tích hợp gần như giống hệt.

#### Lớp 3: Chặn email tạm thời
Spammer hay dùng email tạm thời (10minutemail, mailinator...) để đăng ký hàng loạt. Gem <mark>valid_email2</mark> có sẵn danh sách các domain này.
```sh
bundle add valid_email2
```
```ruby
# app/models/user.rb

class User < ApplicationRecord
  validates :email, presence: true, 'valid_email2/email': { mx: true, disposable: true }
end
```
- <mark>disposable: true</mark>: chặn domain email tạm thời.
- <mark>mx: true</mark>: kiểm tra domain có thật sự nhận được email không. Lưu ý tùy chọn này sẽ query DNS, làm chậm request một chút.

Và tất nhiên, bắt buộc **xác thực email** trước khi cho user làm những việc quan trọng (comment, mua hàng, nhận khuyến mãi).

#### Email bombing
Kẻ xấu dùng form đăng ký, quên mật khẩu của mình để gửi hàng trăm email tới hộp thư **của người khác**. Họ không được lợi gì trực tiếp, nhưng nạn nhân bị làm phiền, và domain email của mình bị đánh dấu spam.

Cách chặn: rate limit theo **địa chỉ email nhận**, không chỉ theo IP. Ví dụ mỗi email chỉ nhận tối đa 3 email reset password mỗi giờ. Bài tiếp theo sẽ làm việc này với **Rack::Attack**.

#### Tóm tắt

| Lớp | Chặn được | Người dùng có bị làm phiền? |
|---|---|---|
| Honeypot | Bot đơn giản | Không |
| Turnstile | Phần lớn bot | Gần như không |
| Chặn email tạm thời | Đăng ký hàng loạt | Không |
| Xác thực email | Tài khoản ảo | Một chút |
