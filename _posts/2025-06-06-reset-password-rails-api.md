---
layout: post
title:  "031. Reset password with Rails api."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_031/reset_password.png
---
Cái tính năng này nó siêu đơn giản luôn các bạn.

#### 1.Flow
Ở phía BE thì chúng ta chỉ cần 2 api. Một cái để user request mail reset password, và một api để user gửi password mới.
Ngoài ra, chúng ta còn cần phía FE cung cấp url nơi mà người dùng submit password mới, giả sử là <strong>https://example.com/auth/reset-password?token=token</strong>

![Reset password with mail and token]({{site.baseurl}}/assets/images/post_031/reset_password_flow.png)

#### 2.Api request mail reset password

```ruby
# app/controllers/password_resets_controller.rb
class PasswordResetsController < ApplicationController
   ...
  def create
    user = User.find_by(email: params[:email])
    AuthMailer.reset_password(user: user).deliver_later if user.present?

    render json: { message: 'Request successfully' }, status: :ok
  end
end
```

#### 3. Api update new password

```ruby
class PasswordResetsController < ApplicationController
  ...

  def update
    begin
    user = User.find_signed!(params[:token], purpose: 'reset_password')

    rescue ActiveSupport::MessageVerifier::InvalidSignature
      render json: { error: 'Token invalid' }, status: :bad_request
    end
    user.update!(password: params[:password])

    render json: { message: 'Password successfully updated' }, status: :ok
  end
end
```
#### 4. Mailer
```ruby
# app/mailers/auth_mailer.rb

class AuthMailer < ApplicationMailer
  def reset_password(user)
    @token = user.signed_id(purpose: :reset_password, expires_in: 15.minutes)
    @email = user.email
    mail to: @email, subject: 'Reset password'
  end
end
```
```html
<!-- app/views/auth_mailer/reset_password.html.erb -->

<p>Dear <%= @email %>,</p>
<p>Someone request a reset of your password</p>
<p>If it was you, click the link to reset password, the link will expired in 15 minutes</p>
<a href=<%="https://example.com/auth/reset-password?token=#{@token} "%>>Click here</a>.
```
#### 5. Conclusion

Tinh túy nằm hết ở 2 hàm `signed_id` và `find_signed` của `ActiveRecord`, giúp chúng ta tạo token và verify token một cách dễ dàng.
