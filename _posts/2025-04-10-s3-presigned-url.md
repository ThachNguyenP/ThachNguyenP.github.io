---
layout: post
title:  "027.S3 Presigned URL với ActiveStorage."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_027/presigned_url.jpg
---
Hôm nay note lại cách upload ảnh lên S3 bằng Presigned URL, dùng với ActiveStorage.

#### 1.1 Upload ảnh
Lý thuyết là như sau: Thay vì người dùng (client side) gửi ảnh về server BE, để server upload lên S3, thì ở đây chúng ta sẽ tạo ra một URL để người dùng tự upload ảnh lên S3. Bằng cách này, với những file nặng, chúng ta không cần tốn 2 lần gửi file.

![User gửi request ảnh muốn upload](/assets/images/post_027/presigned_url_step_1.png "User gửi request ảnh muốn upload")
![Server xác nhận user, và generate một url tương ứng cho ảnh](/assets/images/post_027/presigned_url_step_2.png "Server xác nhận user, và generate một url tương ứng cho ảnh")
![User dùng url để upload ảnh thẳng lên aws s3](/assets/images/post_027/presigned_url_step_3.png "User dùng url để upload ảnh thẳng lên aws s3")

#### 1.2 Truy cập ảnh
Còn khi view hoặc download ảnh, server sẽ cũng không trả file ảnh, mà sẽ trả về url s3 của ảnh đó, kèm với một token cho phép người dùng truy cập trong một thời gian ngắn, việc này tránh cho việc url ảnh bị copy và tái sử dụng ở một nơi khác.

![Server xác nhận user có quyền truy cập tài nguyên ảnh](/assets/images/post_027/presigned_url_step_4.png "Server xác nhận user có quyền truy cập tài nguyên ảnh")
![Server trả về một url, kèm với token](/assets/images/post_027/presigned_url_step_5.png "Server trả về một url, kèm với token")
![User truy cập tài nguyên ảnh thông qua url](/assets/images/post_027/presigned_url_step_6.png "User truy cập tài nguyên ảnh thông qua url")

#### 2. Setup
Cái này thì cần có 1 bucket trên S3, và một AIM có quyền với bucket đó. Đại loại là các bạn sẽ cần 4 env sau
```sh
S3_ACCESS_KEY_ID=AKIA****************
S3_SECRET_ACCESS_KEY=mzxFnpT2**********
S3_REGION=ap-northeast-2
S3_BUCKET_NAME=project-name
```
Giờ thì bắt tay vào Rails thôi, ngày xưa thì có Carrierwave, còn giờ thì từ Rails 5.2 đã có sẵn ActiveStorage.

```sh
rails active_storage:install
```
Với những yêu cầu thường thấy như là resize ảnh, crop ảnh, thì cần cài thêm gem <mark>image_processing</mark>, nó bao gồm cả gem <mark>mini_magick</mark> và <mark>ruby-vips</mark> để xử lý ảnh.
```sh
# Gemfile
gem 'image_processing', '~> 1.2'
gem 'aws-sdk-s3', require: false
```
Giờ thì chúng ta chạy lại <mark>rails db:migrate</mark> và <mark>bundle</mark>

```yaml
# config/storage.yml

test:
  service: Disk
  root: <%= Rails.root.join("tmp/storage") %>

local:
  service: Disk
  root: <%= Rails.root.join("storage") %>

amazon:
  service: S3
  access_key_id: <%= ENV.fetch('S3_ACCESS_KEY_ID', nil) %>
  secret_access_key: <%= ENV.fetch('S3_SECRET_ACCESS_KEY', nil) %>
  region: <%= ENV.fetch('S3_REGION', nil) %>
  bucket: <%= ENV.fetch('S3_BUCKET_NAME', nil) %>
```

```ruby
# config/application.rb hoặc config/environments/development.rb

config.active_storage.service = :amazon
```

#### 3. Presigned URL
```ruby
# app/controllers/api/presigned_upload_controller.rb

class Api::PresignedUploadController < Api::BaseController
  # POST /api/presigned-upload
  def create
    create_blob

    render_success(
      data: {
        url: @blob.service_url_for_direct_upload(expires_in: 30.minutes),
        headers: @blob.service_headers_for_direct_upload,
        signed_id: @blob.signed_id
      }
    )
  end

  private

  def create_blob
    @blob = ActiveStorage::Blob.create_before_direct_upload!(
      filename: blob_params[:filename],
      byte_size: blob_params[:byte_size],
      checksum: blob_params[:checksum],
      content_type: blob_params[:content_type]
    )
  end

  def blob_params
    params.require(:file).permit(:filename, :byte_size, :checksum, :content_type)
  end
end
```

request payload và respond trông nó sẽ như thế này
```json
{
  "file": {
    "filename": "test",
    "byte_size": 1024, #có thể dùng ls -l để xem file nặng bao nhiêu byte
    "checksum": "3Tbhfs6EB0ukAPTziowN0A==", #mã hóa md5 của base64, openssl md5 -binary file_path | base64
    "content_type": "image/png"
  }
}

{
  "data": {
    "url": "https://bucket.s3.region.amazonaws.com/etc",
    "headers": {
      "Content-Type": "image/png",
      "Content-MD5": "3Tbhfs6EB0ukAPTziowN0A==",
      "Content-Disposition": "inline; filename=\"test\"; filename*=UTF-8''test"
    },
    "signed_id": "signedidoftheblob"
  }
}
```
Chúng ta sẽ test url với postman, chọn method là PUT, và với headers, hãy khai báo 3 giá trị <mark>Content-Type</mark>, <mark>Content-MD5</mark> và <mark>Content-Disposition</mark> chúng ta nhận về ở response. Với body, chọn Body > binary và select file.

![Postman headers](/assets/images/post_027/presigned_url_postman_header.png "Postman headers")

![Postman body](/assets/images/post_027/presigned_url_postman_body.png "Postman body")

#### 4. Truy cập file

Vậy là ảnh đã được lưu vào cả S3. Trong database, mỗi khi tạo presigned url, nó sẽ tạo ra một blob, và các thông tin của blob này sẽ được lưu vào database. Các bạn hoàn toàn có thể tạo được link ảnh từ blob, tất nhiên là với blob mà ảnh chưa được upload lên s3 thì sẽ link ảnh đó sẽ báo lỗi.

```ruby
ActiveStorage::Blob.last.url
```
![Blob polymorphic tables](/assets/images/post_027/presigned_url_blob_polymorphic.png "Blob polymorphic tables")
Blob được dùng để gán cho một object nào đó như là user hoặc bài sản phẩm như là avatar hoặc ảnh minh họa cho sản phẩm đó. Giờ là lúc các bạn dùng <mark>signed_id</mark> ở trên
```ruby
# app/models/user.rb
class User < ApplicationRecord
  has_one_attached :avatar
end

User.first.update(avatar: 'signedidoftheblob')
User.first.avatar.url
```

#### 5. Các option khác
Một nhu cầu rất chính đáng là tạo ảnh thumbnail.

```ruby
# app/models/user.rb

class User < ApplicationRecord
  has_one_attached :avatar do |attachable|
    attachable.variant :thumb, resize_to_limit: [170, 230], preprocessed: true,
                       saver: {strip_everything_but_profile: true, quality: 100}
  end
end
```

Hiện tại thì ActiveStorage vẫn chưa thấy hỗ trợ customize file path trên s3, nghe hơi củ chuối, nhưng nếu các bạn cần một giải pháp toàn diện hơn, thì có thể xem qua [Shrine](https://github.com/shrinerb/shrine).
