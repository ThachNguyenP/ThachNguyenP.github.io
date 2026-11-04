---
layout: post
title:  "126. Video (Xử lý với ffmpeg & HLS)."
date:   2026-11-03 02:30:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_126/video-transcode.png
---
File gốc đã nằm trên S3. Bài này biến nó thành thứ phát được ở mọi nơi và tải nhanh. Mọi số liệu đều đo thật trên một video mẫu 1 phút, bạn làm theo được ngay cả khi không có sẵn video nào.

#### Chuẩn bị: ffmpeg và video mẫu
Không cần cài ffmpeg, dùng Docker image chỉ chứa đúng một binary (237MB)
```sh
docker pull mwader/static-ffmpeg:7.1

# tạo alias để gõ cho ngắn, chạy trong thư mục chứa video
alias ffmpeg='docker run --rm --entrypoint /ffmpeg -v "$PWD":/w -w /w mwader/static-ffmpeg:7.1 -hide_banner'
alias ffprobe='docker run --rm --entrypoint /ffprobe -v "$PWD":/w -w /w mwader/static-ffmpeg:7.1 -v error'
```
Trên macOS có thể <mark>brew install ffmpeg</mark>, Ubuntu <mark>apt install ffmpeg</mark>, kết quả như nhau.

Tạo một video mẫu giống video điện thoại quay: 1080p, 30fps, 60 giây, bitrate 12Mbps
```sh
ffmpeg -f lavfi -i "testsrc2=size=1920x1080:rate=30" -f lavfi -i "sine=frequency=440" \
  -t 60 -c:v libx264 -preset veryfast -b:v 12M -pix_fmt yuv420p -c:a aac -b:a 128k source.mp4
```

#### Bước 1: Xem file gốc là gì
Trước khi xử lý, hỏi <mark>ffprobe</mark>. Đây cũng là cách kiểm tra file **thật sự** là video (bài 125 chỉ tin <mark>content_type</mark> trình duyệt báo)
```sh
ffprobe -show_entries format=duration,size,bit_rate -show_entries stream=codec_name,width,height,r_frame_rate \
  -of default=noprint_wrappers=1 source.mp4
```
```
codec_name=h264
width=1920
height=1080
r_frame_rate=30/1
codec_name=aac
duration=60.000000
size=91057468
bit_rate=12140995
```
**91MB cho 1 phút**, 12Mbps. Người xem bằng 4G (thực tế khoảng 5 - 20Mbps, không ổn định) sẽ giật liên tục. Thêm <mark>-of json</mark> để nhận JSON, tiện parse trong Ruby.

#### Bước 2: Vấn đề moov atom
File MP4 gồm các khối (atom). Khối <mark>moov</mark> chứa "mục lục": có bao nhiêu frame, mỗi frame ở byte nào. Trình duyệt **phải đọc được moov mới phát được**. Vấn đề: hầu hết phần mềm (kể cả ffmpeg mặc định và camera điện thoại) ghi <mark>moov</mark> ở **cuối** file, vì chỉ khi ghi xong mới biết mục lục.

Đọc cấu trúc khối của file mẫu bằng một đoạn Python ngắn (mỗi khối bắt đầu bằng 4 byte kích thước + 4 byte tên)
```python
import struct, os, sys

path = sys.argv[1]
pos = 0
with open(path, "rb") as f:
    while pos < os.path.getsize(path):
        f.seek(pos)
        size, name = struct.unpack(">I4s", f.read(8))
        print(f"{name.decode()} tại byte {pos:,} ({size:,} bytes)")
        pos += size
```
```
$ python3 atoms.py source.mp4
ftyp tại byte 0 (32 bytes)
free tại byte 32 (8 bytes)
mdat tại byte 40 (90,991,405 bytes)      <- dữ liệu hình và tiếng
moov tại byte 90,991,445 (66,023 bytes)  <- mục lục, nằm cuối!
```
Trình duyệt tải 90MB xong mới thấy mục lục, hoặc phải mò bằng Range request tới cuối file (bài 127). Sửa chỉ mất 1 giây vì không encode lại gì, chỉ sắp xếp lại khối
```sh
ffmpeg -i source.mp4 -c copy -movflags +faststart faststart.mp4
```
```
$ python3 atoms.py faststart.mp4
ftyp tại byte 0 (32 bytes)
moov tại byte 32 (66,023 bytes)          <- mục lục lên đầu
free tại byte 66,055 (8 bytes)
mdat tại byte 66,063 (90,991,405 bytes)
```
Giờ trình duyệt đọc **66KB** là biết cách phát, và bắt đầu phát ngay khi có vài giây dữ liệu đầu. Mọi file MP4 bạn đưa lên web **phải** có <mark>+faststart</mark>. Các lệnh phía dưới đều có.

#### Bước 3: Một bản MP4 cho web
Nếu dự án nhỏ, chỉ cần **một** file MP4 tốt là đủ: H.264 (mọi trình duyệt đều phát được bằng phần cứng), AAC, 720p, bitrate hợp lý
```sh
ffmpeg -i source.mp4 \
  -vf "scale=-2:720" \
  -c:v libx264 -preset medium -crf 23 -profile:v high -level 4.0 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  -movflags +faststart \
  web720.mp4
```
```
source.mp4   91,057,468 bytes   12.1 Mbps
web720.mp4   11,172,861 bytes    1.5 Mbps     mất 11 giây
```
**Nhỏ hơn 8 lần**, chất lượng mắt thường khó phân biệt trên màn hình điện thoại. Giải thích các tham số:

| Tham số | Ý nghĩa |
|---|---|
| <mark>scale=-2:720</mark> | Cao 720px, rộng tự tính và chẵn (H.264 cần kích thước chẵn) |
| <mark>-crf 23</mark> | Chất lượng cố định, ffmpeg tự chọn bitrate. 18 rất đẹp và nặng, 28 nhẹ và mờ. 23 là điểm cân bằng |
| <mark>-preset medium</mark> | Tốc độ encode. <mark>veryfast</mark> nhanh gấp đôi (7 giây) nhưng file lớn hơn ở cùng chất lượng; <mark>slow</mark> ngược lại |
| <mark>-profile:v high -level 4.0</mark> | Giới hạn tính năng H.264 để thiết bị cũ và phần cứng giải mã được |
| <mark>-pix_fmt yuv420p</mark> | Định dạng màu mà mọi trình duyệt hỗ trợ. Thiếu dòng này là một số video "đen màn hình" |

Ảnh đại diện (poster) để hiện trước khi bấm play, lấy ở giây thứ 2 (giây 0 thường là khung đen)
```sh
ffmpeg -ss 2 -i source.mp4 -frames:v 1 -vf "scale=-2:720" -q:v 3 poster.jpg   # 53KB
```

#### Bước 4: HLS cho mạng không ổn định
Một file 720p 1.5Mbps vẫn giật khi 4G tụt xuống 1Mbps, và lãng phí khi người xem có WiFi và màn hình 4K. **Adaptive bitrate**: tạo nhiều phiên bản (rendition), cắt mỗi phiên bản thành đoạn 4 giây, player tự chọn phiên bản theo tốc độ mạng và **đổi giữa chừng**. YouTube, Netflix đều làm vậy. Chuẩn phổ biến nhất là **HLS** (<mark>.m3u8</mark> + các đoạn).
```sh
mkdir -p hls

ffmpeg -i source.mp4 \
  -filter_complex "[0:v]split=4[v1][v2][v3][v4];[v1]scale=-2:1080[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:480[v3o];[v4]scale=-2:360[v4o]" \
  -map "[v1o]" -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k \
  -map "[v2o]" -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k \
  -map "[v3o]" -c:v:2 libx264 -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k \
  -map "[v4o]" -c:v:3 libx264 -b:v:3 800k  -maxrate:v:3 856k  -bufsize:v:3 1200k \
  -map a:0 -map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k \
  -preset medium -profile:v high -pix_fmt yuv420p \
  -g 60 -keyint_min 60 -sc_threshold 0 \
  -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:1080p v:1,a:1,name:720p v:2,a:2,name:480p v:3,a:3,name:360p" \
  -hls_segment_filename "hls/%v/seg_%03d.m4s" hls/%v/index.m3u8
```
Dài, nhưng chỉ có vài ý:
- <mark>split=4</mark> rồi <mark>scale</mark>: decode một lần, encode ra 4 kích thước.
- Mỗi phiên bản một bitrate mục tiêu (<mark>-b:v</mark>) có trần (<mark>-maxrate</mark>), để player đoán được tốc độ cần.
- <mark>-g 60 -sc_threshold 0</mark>: keyframe đúng mỗi 2 giây, bắt buộc để các đoạn cắt khớp nhau giữa các phiên bản (nếu không, đổi phiên bản giữa chừng sẽ vỡ hình).
- <mark>-hls_time 4</mark>: mỗi đoạn 4 giây. <mark>fmp4</mark>: đoạn dạng MP4 phân mảnh, chuẩn hiện đại, dùng chung được cho DASH.

Chạy mất **34 giây** cho 60 giây video (4 phiên bản). Kết quả
```
hls/master.m3u8
hls/1080p/  init_0.mp4 + 15 đoạn   37MB
hls/720p/   init_1.mp4 + 15 đoạn   21MB
hls/480p/   init_2.mp4 + 15 đoạn   11MB
hls/360p/   init_3.mp4 + 15 đoạn  6.7MB
```
<mark>master.m3u8</mark> là thứ duy nhất player cần biết URL
```
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-STREAM-INF:BANDWIDTH=5188080,AVERAGE-BANDWIDTH=5134126,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2972526,AVERAGE-BANDWIDTH=2934260,RESOLUTION=1280x720,CODECS="avc1.64001f,mp4a.40.2"
720p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1574486,AVERAGE-BANDWIDTH=1533186,RESOLUTION=854x480,CODECS="avc1.64001f,mp4a.40.2"
480p/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=954718,AVERAGE-BANDWIDTH=931477,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2"
360p/index.m3u8
```
Player đọc file này, đo tốc độ mạng, chọn phiên bản có <mark>BANDWIDTH</mark> phù hợp, rồi tải lần lượt các đoạn trong <mark>index.m3u8</mark> của phiên bản đó. Để bắt đầu phát ở 360p chỉ cần <mark>init_3.mp4</mark> (1.3KB) và đoạn đầu tiên <mark>seg_000.m4s</mark> (**444KB**), so với tải cả file 91MB ban đầu. Bài 127 sẽ đo điều này từ phía trình duyệt.

Chọn số phiên bản theo người dùng: video ngắn cho mạng xã hội thì 360/720 là đủ; khóa học xem trên laptop thì thêm 1080. Mỗi phiên bản thêm là thêm thời gian encode và dung lượng lưu trữ.

#### Bước 5: Chạy trong Rails
Việc này tốn CPU (bài 101), chạy trong background job, ở **queue riêng** với ít thread (bài 103) để không chiếm hết CPU của các job khác
```ruby
# app/jobs/transcode_video_job.rb

require "open3"

class TranscodeVideoJob < ApplicationJob
  queue_as :video
  retry_on StandardError, attempts: 2

  def perform(video_id)
    video = Video.find(video_id)
    video.processing!

    Dir.mktmpdir do |dir|
      source = File.join(dir, "source")
      video.original.open { |file| FileUtils.cp(file.path, source) }   # tải từ S3 về đĩa tạm

      info = probe(source)
      raise "Không phải video" unless info.dig("streams", 0, "codec_type") == "video"

      run_ffmpeg(source, dir)

      video.poster.attach(io: File.open(File.join(dir, "poster.jpg")), filename: "poster.jpg", content_type: "image/jpeg")
      Dir.glob(File.join(dir, "hls", "**", "*")).select { |f| File.file?(f) }.each do |path|
        key = path.delete_prefix("#{dir}/hls/")
        video.renditions.attach(io: File.open(path), filename: key, key: "videos/#{video.id}/#{key}",
                                content_type: content_type_for(key))
      end

      video.update!(status: :ready, duration: info.dig("format", "duration").to_f)
    end

    video.broadcast_replace_to video, target: "video-status", partial: "videos/player", locals: { video: }
  rescue => e
    video.failed!
    raise
  end

  private

  def probe(path)
    out, status = Open3.capture2("ffprobe", "-v", "error", "-show_format", "-show_streams", "-of", "json", path)
    raise "ffprobe lỗi" unless status.success?

    JSON.parse(out)
  end

  def run_ffmpeg(source, dir)
    FileUtils.mkdir_p(File.join(dir, "hls"))
    system("ffmpeg", "-hide_banner", "-loglevel", "error", "-ss", "2", "-i", source,
           "-frames:v", "1", "-vf", "scale=-2:720", "-q:v", "3", File.join(dir, "poster.jpg"), exception: true)
    system("ffmpeg", "-hide_banner", "-loglevel", "error", "-i", source, *HLS_ARGS,
           "-hls_segment_filename", File.join(dir, "hls", "%v", "seg_%03d.m4s"),
           File.join(dir, "hls", "%v", "index.m3u8"), exception: true)
  end

  def content_type_for(key)
    case File.extname(key)
    when ".m3u8" then "application/vnd.apple.mpegurl"
    when ".m4s"  then "video/iso.segment"
    else "video/mp4"
    end
  end

  HLS_ARGS = %w[
    -filter_complex [0:v]split=4[v1][v2][v3][v4];[v1]scale=-2:1080[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:480[v3o];[v4]scale=-2:360[v4o]
    -map [v1o] -c:v:0 libx264 -b:v:0 5000k -maxrate:v:0 5350k -bufsize:v:0 7500k
    -map [v2o] -c:v:1 libx264 -b:v:1 2800k -maxrate:v:1 2996k -bufsize:v:1 4200k
    -map [v3o] -c:v:2 libx264 -b:v:2 1400k -maxrate:v:2 1498k -bufsize:v:2 2100k
    -map [v4o] -c:v:3 libx264 -b:v:3 800k -maxrate:v:3 856k -bufsize:v:3 1200k
    -map a:0 -map a:0 -map a:0 -map a:0 -c:a aac -b:a 128k
    -preset medium -profile:v high -pix_fmt yuv420p -g 60 -keyint_min 60 -sc_threshold 0
    -f hls -hls_time 4 -hls_playlist_type vod -hls_segment_type fmp4 -hls_flags independent_segments
    -master_pl_name master.m3u8
    -var_stream_map v:0,a:0,name:1080p\ v:1,a:1,name:720p\ v:2,a:2,name:480p\ v:3,a:3,name:360p
  ].freeze
end
```
Những điểm cần để ý:
- Gọi ffmpeg bằng **mảng tham số** (<mark>system("ffmpeg", "-i", source, ...)</mark>), không ghép chuỗi. Tên file do người dùng đặt mà ghép vào chuỗi lệnh là lỗ hổng command injection.
- <mark>key:</mark> khi attach để các file HLS nằm **cùng thư mục** trên S3 (<mark>videos/42/720p/seg_000.m4s</mark>), vì <mark>index.m3u8</mark> tham chiếu các đoạn bằng đường dẫn tương đối. Active Storage mặc định đặt key ngẫu nhiên, sẽ làm hỏng tham chiếu này.
- <mark>content_type</mark> đúng cho từng loại file, bài 127 sẽ thấy tại sao quan trọng.
- Video 10 phút mất khoảng 5 - 6 phút CPU với <mark>preset medium</mark>. Worker chạy job này nên là máy riêng có nhiều core, hoặc dùng <mark>-preset veryfast</mark> nếu cần nhanh.
- Video gốc giữ lại hay xóa tùy nhu cầu (muốn encode lại sau này với codec mới thì giữ). Nếu giữ, chuyển sang S3 storage class rẻ hơn (Glacier) bằng lifecycle rule.

Cấu hình queue (Solid Queue)
```yaml
# config/queue.yml
production:
  workers:
    - queues: [default, mailers]
      threads: 5
    - queues: video
      threads: 1
      processes: 2
```

#### Khi nào thuê dịch vụ
Tự chạy ffmpeg hợp lý khi lượng video vừa phải và bạn muốn kiểm soát chi phí. Khi video là tính năng chính, các dịch vụ **AWS MediaConvert**, **Mux**, **Cloudflare Stream**, **Bunny Stream** nhận file gốc và trả về HLS, poster, kèm CDN và player, tính tiền theo phút video. Đổi lại là chi phí mỗi phút và phụ thuộc nhà cung cấp. Dù chọn cách nào, những khái niệm ở bài này (faststart, H.264/AAC, bitrate, HLS) vẫn là thứ bạn cần hiểu để cấu hình và debug.

#### Tóm tắt
- <mark>ffprobe</mark> trước để biết file là gì và validate thật sự.
- Mọi MP4 trên web phải có <mark>-movflags +faststart</mark>.
- Dự án nhỏ: một bản MP4 720p H.264/AAC, nhỏ hơn file gốc 8 lần.
- Cần chất lượng theo mạng: HLS nhiều phiên bản, keyframe cố định, đoạn 4 giây.
- Chạy ffmpeg trong job ở queue riêng, truyền tham số dạng mảng, giữ cấu trúc thư mục HLS trên S3.
