---
layout: post
title:  "125. Video (Upload đúng cách)."
date:   2026-11-03 02:28:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_125/video-upload.png
---
Tính năng "đăng video" nghe đơn giản: một ô chọn file, một nút gửi. Rồi production xuất hiện đủ thứ: upload 200MB làm treo server, video quay bằng iPhone không xem được trên Chrome, trang có video load 10 giây, 4G xem giật. Series này đi qua cả vòng đời của một video, với số liệu đo thật trên một video mẫu: **upload** (bài này), **xử lý** bằng ffmpeg và HLS (bài 126), và **phát** sao cho nhanh (bài 127).

Version sử dụng: Rails 8, Active Storage, S3 (hoặc dịch vụ tương thích như Cloudflare R2, MinIO), ffmpeg 7.

#### Tại sao không upload qua Rails
Cách tự nhiên nhất: form <mark>multipart</mark>, file đi vào controller, Active Storage đẩy lên S3. Với ảnh vài trăm KB thì ổn. Với video thì không:
- Một video 1 phút quay bằng điện thoại khoảng **90MB** (sẽ thấy ở bài 126). Request upload chiếm một **thread Puma** trong suốt thời gian đó, với 4G khoảng 1 - 2 phút. Puma mặc định 3 thread mỗi process (bài 103): 3 người upload cùng lúc là trang web ngừng phục vụ.
- File đi 2 chặng: điện thoại → Rails → S3. Tốn băng thông server và gấp đôi thời gian chờ.
- Nginx/load balancer thường giới hạn body (<mark>client_max_body_size</mark>), timeout (<mark>proxy_read_timeout</mark>), phải nới hết.

Giải pháp chuẩn: **direct upload**. Trình duyệt upload **thẳng lên S3** bằng một URL có chữ ký do Rails cấp; Rails chỉ nhận một request nhỏ lúc đầu (xin URL) và một request nhỏ lúc cuối (lưu form với id của file). Bài 027 đã làm presigned URL bằng tay; Active Storage có sẵn toàn bộ flow này.

```
Trình duyệt ──(1) POST /rails/active_storage/direct_uploads (metadata)──► Rails ──► trả về URL ký sẵn + signed_id
Trình duyệt ──(2) PUT file 90MB ─────────────────────────────────────────► S3
Trình duyệt ──(3) POST /videos { title, file: signed_id } (vài trăm byte)──► Rails ──► tạo Video, đẩy job xử lý
```

#### Cài đặt
```sh
bin/rails active_storage:install
bin/rails db:migrate
bin/rails g model Video title:string status:string duration:float user:references
bin/rails db:migrate
```
```yaml
# config/storage.yml

amazon:
  service: S3
  access_key_id: <%= Rails.application.credentials.dig(:aws, :access_key_id) %>
  secret_access_key: <%= Rails.application.credentials.dig(:aws, :secret_access_key) %>
  region: ap-southeast-1
  bucket: my-app-videos
```
```ruby
# config/environments/production.rb
config.active_storage.service = :amazon
```
S3 phải cho phép trình duyệt <mark>PUT</mark> từ domain của bạn (CORS). Thiếu bước này là lỗi hay gặp nhất, biểu hiện là console báo <mark>blocked by CORS policy</mark>
```json
[
  {
    "AllowedOrigins": ["https://myapp.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-MD5", "Content-Disposition"],
    "MaxAgeSeconds": 3600
  }
]
```

#### Model
```ruby
# app/models/video.rb

class Video < ApplicationRecord
  MAX_SIZE = 2.gigabytes
  ALLOWED_TYPES = %w[video/mp4 video/quicktime video/webm video/x-matroska].freeze

  belongs_to :user
  has_one_attached :original   # file người dùng upload, không bao giờ phát trực tiếp
  has_one_attached :poster     # ảnh đại diện, bài 126 tạo
  has_many_attached :renditions # các bản đã xử lý, bài 126 tạo

  enum :status, { uploaded: "uploaded", processing: "processing", ready: "ready", failed: "failed" },
       default: :uploaded

  validate :original_is_acceptable

  after_create_commit { TranscodeVideoJob.perform_later(id) }

  private

  def original_is_acceptable
    return errors.add(:original, "chưa chọn video") unless original.attached?

    errors.add(:original, "chỉ nhận mp4, mov, webm, mkv") unless original.content_type.in?(ALLOWED_TYPES)
    errors.add(:original, "tối đa 2GB") if original.byte_size > MAX_SIZE
  end
end
```
Vài quyết định quan trọng ở đây:
- **Không phát file gốc** cho người xem. File gốc có thể là HEVC từ iPhone (Chrome trên Windows không xem được), 12Mbps (4G không tải nổi), hoặc có <mark>moov</mark> ở cuối (bài 126). File gốc chỉ là đầu vào cho bước xử lý.
- <mark>status</mark> để giao diện biết video đang ở đâu: vừa upload xong thì hiện "Đang xử lý", không hiện player.
- Validate <mark>content_type</mark> và <mark>byte_size</mark> **sau khi** file đã nằm trên S3, vì direct upload không đi qua Rails. Nếu không hợp lệ, record không được tạo, blob mồ côi sẽ được <mark>ActiveStorage::Blob.unattached.find_each(&:purge_later)</mark> dọn bằng một job định kỳ.
- <mark>content_type</mark> ở bước này do **trình duyệt báo**, chưa đáng tin. Bước xử lý ở bài 126 sẽ dùng <mark>ffprobe</mark> để biết chắc file là gì.

Với file nặng, nên dùng gem <mark>active_storage_validations</mark> để có <mark>validates :original, content_type: [...], size: { less_than: 2.gigabytes }</mark> gọn hơn, nhưng viết tay như trên cũng đủ.

#### Form và JavaScript
```erb
<%# app/views/videos/new.html.erb %>

<%= form_with model: @video, data: { controller: "upload" } do |f| %>
  <%= f.text_field :title, placeholder: "Tiêu đề" %>
  <%= f.file_field :original, direct_upload: true, accept: "video/*",
                   data: { upload_target: "input", action: "upload#validate" } %>
  <progress data-upload-target="progress" value="0" max="100" hidden></progress>
  <p data-upload-target="status"></p>
  <%= f.submit "Đăng video", data: { upload_target: "submit" } %>
<% end %>
```
<mark>direct_upload: true</mark> là tất cả những gì cần để Active Storage lo bước (1) và (2). Chỉ cần import JS của nó một lần
```javascript
// app/javascript/application.js
import "@rails/activestorage"
import { start } from "@rails/activestorage"
start()
```
Phần còn lại là trải nghiệm: kiểm tra file **trước khi** upload (đừng để người dùng chờ 2 phút rồi mới báo "file quá lớn"), thanh tiến trình, khóa nút gửi. Active Storage phát ra các sự kiện <mark>direct-upload:*</mark> cho việc này
```javascript
// app/javascript/controllers/upload_controller.js

import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["input", "progress", "status", "submit"]

  connect() {
    this.element.addEventListener("direct-upload:initialize", () => {
      this.progressTarget.hidden = false
      this.submitTarget.disabled = true
      this.statusTarget.textContent = "Đang tải lên..."
    })
    this.element.addEventListener("direct-upload:progress", (event) => {
      this.progressTarget.value = event.detail.progress   // 0..100
    })
    this.element.addEventListener("direct-upload:error", (event) => {
      event.preventDefault()
      this.statusTarget.textContent = `Lỗi tải lên: ${event.detail.error}`
      this.submitTarget.disabled = false
    })
    this.element.addEventListener("direct-upload:end", () => {
      this.statusTarget.textContent = "Tải lên xong, đang lưu..."
    })
  }

  validate() {
    const file = this.inputTarget.files[0]
    if (!file) return

    if (file.size > 2 * 1024 ** 3) {
      this.statusTarget.textContent = "File tối đa 2GB"
      this.inputTarget.value = ""
    } else if (!file.type.startsWith("video/")) {
      this.statusTarget.textContent = "Chỉ nhận file video"
      this.inputTarget.value = ""
    } else {
      this.statusTarget.textContent = `${file.name} (${(file.size / 1024 / 1024).toFixed(0)} MB)`
    }
  }
}
```
Khi bấm "Đăng video": Active Storage chặn submit, upload file lên S3 (kèm tiến trình), rồi mới submit form với <mark>signed_id</mark> của blob trong field <mark>original</mark>. Controller không cần biết gì về S3
```ruby
# app/controllers/videos_controller.rb

def create
  @video = current_user.videos.build(video_params)

  if @video.save
    redirect_to @video, notice: "Đã nhận video, đang xử lý"
  else
    render :new, status: :unprocessable_entity
  end
end

private

def video_params = params.require(:video).permit(:title, :original)
```

#### Trang video khi chưa xử lý xong
```erb
<%# app/views/videos/show.html.erb %>

<% if @video.ready? %>
  <%= render "player", video: @video %>  <%# bài 127 %>
<% elsif @video.failed? %>
  <p>Video không xử lý được, vui lòng thử file khác.</p>
<% else %>
  <%= turbo_stream_from @video %>
  <p id="video-status">Đang xử lý, thường mất khoảng 1 phút cho mỗi phút video...</p>
<% end %>
```
Job ở bài 126 khi xong sẽ <mark>broadcast_replace_to video</mark> để thay đoạn "Đang xử lý" bằng player mà không cần người dùng refresh. Không có Turbo thì poll <mark>GET /videos/:id/status</mark> mỗi 5 giây cũng được.

#### File rất lớn và mạng chập chờn
Direct upload của Active Storage là **một** request <mark>PUT</mark>. Với file vài GB trên mạng di động, rớt ở 95% là phải làm lại từ đầu. Hai cách xử lý:
- **S3 multipart upload**: chia file thành các phần 5 - 100MB, upload từng phần, phần nào lỗi thì gửi lại phần đó. Phía trình duyệt dùng thư viện **Uppy** với plugin <mark>AwsS3</mark> (multipart), phía Rails viết vài endpoint ký URL cho từng phần bằng <mark>aws-sdk-s3</mark>. Tốn công hơn nhưng là cách đúng cho file lớn.
- **tus** protocol: chuẩn upload có thể tạm dừng và tiếp tục, có server riêng (tusd) và Uppy hỗ trợ sẵn. Hợp khi không dùng S3.

Với video dưới 500MB, direct upload thường là đủ. Khi nào người dùng than phiền mới cần multipart, đừng làm sớm.

#### Đừng làm
- **Nén/convert ở trình duyệt** bằng ffmpeg.wasm: chậm gấp nhiều lần so với server, nóng máy, hao pin. Để server làm.
- **Giới hạn định dạng quá chặt** (chỉ mp4): điện thoại quay ra <mark>.mov</mark> (iPhone) và <mark>.mp4</mark> với codec HEVC. Nhận hết, ffmpeg xử lý được tất cả.
- **Lưu file gốc rồi phát luôn**. Đó là nguồn của hầu hết các than phiền "video không xem được" và "video load chậm".

#### Tóm tắt
- Video không đi qua Rails: **direct upload** lên S3, Rails chỉ nhận metadata.
- Validate kích thước và loại file ở **cả 2 phía**: trình duyệt (để báo sớm) và model (để chắc chắn).
- File gốc chỉ là **đầu vào**; có <mark>status</mark> để giao diện biết video đang xử lý.
- File rất lớn thì S3 multipart với Uppy.

Bài tiếp theo: file 90MB vừa upload lên sẽ được ffmpeg biến thành thứ mà mọi trình duyệt phát được và 4G tải nổi, với số liệu đo thật.
