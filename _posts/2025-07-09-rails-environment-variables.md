---
layout: post
title:  "032. Rails environment variable."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_032/rails_environment_variables.png
---
Hôm nay nói về việc quản lý biến môi trường trong Rails, chuyện cơ bản, nhưng đủ sức làm leader của dự án đái ra quần khi có biến.

#### 1.Dotenv
Như thường lệ, chúng ta đến với giải pháp phổ thông, kinh điển nhất, đó là sử dụng gem `dotenv`.

```ruby
# Gemfile
gem 'dotenv'
```
Tạo file .env.* và để ý đến các file này sẽ không được đẩy lên github, nhớ để các file này vào .gitignore.

```sh
# .env.development
AWS_ACCESS_KEY_ID=123
AWS_SECRET_ACCESS_KEY=345
```
Vậy là xong, giờ trong code, chúng ta có thể sử dụng các biến môi trường này.

```ruby
ENV['AWS_ACCESS_KEY_ID']
# "123"
ENV.fetch('AWS_ACCESS_KEY_ID', nil)
# "123"
```
Rails sẽ tự động tìm vào file .env tương ứng với `RAILS_ENV`, ví dụ như ở đây là `RAILS_ENV=development`, nên Rails sẽ tìm đến file `.env.development`. Sau đó nếu không tìm được, Rails sẽ tìm đến file `.env`.

Nhắc lại một lần nữa, các file chứa biến môi trường này không được phép đẩy lên github. Các bạn cần phải thêm vào `.gitignore`.
```sh
# .gitignore
.env.*
.env
```
Ngoài ra, để cho đồng đội biết được là có những biến môi trường gì, chúng ta nên thể viết một file `.env_example`, chứa các giá trị **giả**. File này có thể đẩy lên github.

#### 2.Encrypted credentials
Từ Rails phiên bản 5.2, chúng ta có thêm một phương thức tích hợp sẵn, đó là Encrypted credentials.

Khác với `dotenv`, encrypted credentials sẽ lưu trữ các biến môi trường trong file `config/*******.yml.enc`. Và chúng ta push cái file này lên github thoải mái, vì như tên gọi của nó, các biến môi trường được mã hóa.

Vậy làm sao để mở khóa? Chúng ta sẽ cần một file chứa key giải mã. Yeah, hiểu vấn đề luôn, file này thì không được đẩy lên github, đẩy lên là ăn đầu búa, ăn cám ngay.

```sh
EDITOR=vim rails credentials:edit --environment develop

# Adding config/credentials/develop.key to store the encryption key: b0fe06c031bf28fj9q4cccd05f8a612d

# Save this in a password manager your team can access.

# If you lose the key, no one, including you, can access anything encrypted with it.

#      create  config/credentials/develop.key

# Ignoring config/credentials/develop.key so it won't end up in Git history:

#      append  .gitignore

```
Lệnh `rails credentials:edit` sẽ tạo ra 2 file (nếu chưa có) là `config/credentials/develop.key` và `config/credentials/develop.yml.enc`. Rails cũng tự động thêm đường dẫn file `develop.key` vào gitignore. Giờ thì chúng ta có thể đẩy lên github được rồi. Sau đó chia sẻ lại `develop.key` cho các thành viên trong team :thumbsup:

Để edit các env, chúng ta lại gọi lệnh `EDITOR=vim rails credentials:edit --environment develop` một lần nữa, và dùng vim để sửa, xóa các biến môi trường. Sau khi lưu và quit (:wq), thì các thay đổi sẽ được lưu vào file `config/develop.yml.enc`, tất nhiên là đã được mã hóa.

```sh
# aws:
#   access_key_id: 123
#   secret_access_key: 345
```
Cuối cùng là sử dụng các biến môi trường đó ở trong code.

```ruby
Rails.application.credentials.config
# {:aws=>{:access_key_id=>"123", :secret_access_key=>"345"} }}

Rails.application.credentials.dig(:aws, :access_key_id)
# "123"
```

Với cách này, chúng ta không cần phải có file `.env_example` nữa, chỉ cần chia sẻ file `config/credentials/develop.key`, khi các thành viên khác pull code về, các biến môi trường cũng được cập nhật theo.

#### 2.1 Encrypted credentials note
Nếu bạn thích tạo key thủ công.
```sh
openssl rand -hex 16
```
Nếu bạn không thích sử dụng file `.key`, thì bạn có thể sử dụng một biến môi trường là `RAILS_MASTER_KEY`. Và để cái biến này ở đâu? Ở trong file `.env` :see_no_evil:
```sh
RAILS_MASTER_KEY=b0fe06c031bf28fj9q4cccd05f8a612d
```
Nếu vừa không thích sử dụng file `.key`, vừa có nhiều môi trường như staging, production, thì bạn lại có thể sử dụng nhiều biến key như sau:
```sh
RAILS_DEVELOP_KEY=b0fe06c031bf28fj9q4cccd05f8a612d
RAILS_STAGING_KEY=b0fe06c031bf28fj9q4cccd05f8a612d
RAILS_PRODUCTION_KEY=b0fe06c031bf28fj9q4cccd05f8a612d
```

