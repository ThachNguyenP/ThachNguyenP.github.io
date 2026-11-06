---
layout: post
title:  "127. Video (Phát nhanh trên trình duyệt)."
date:   2026-10-03 02:32:00 +0700
author: thach
categories: [Coding]
tags: [Javascript, Front End]
image: assets/images/post_127/video-playback.png
---
Đã có MP4 faststart và bộ HLS từ bài 126. Bài cuối nói về phía người xem: trình duyệt thật sự tải gì khi gặp thẻ <mark>&lt;video&gt;</mark>, cách để trang không bị chậm vì video, và cách phát HLS. Phần đo đạc dùng nginx chạy bằng Docker để thấy đúng những gì server trả về.

#### Trình duyệt tải video như thế nào
Chạy một web server tĩnh trong thư mục có các file của bài 126
```sh
docker run --rm -d --name video-nginx -p 8089:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
curl -sI http://localhost:8089/faststart.mp4
```
```
HTTP/1.1 200 OK
Content-Type: video/mp4
Content-Length: 91057468
Accept-Ranges: bytes
```
<mark>Accept-Ranges: bytes</mark> là dòng quan trọng nhất: server cho phép xin **một khúc** file thay vì cả file. Trình duyệt dựa vào đó để tua, và để không tải những phần người xem chưa tới
```sh
curl -sI -r 0-65535 http://localhost:8089/faststart.mp4
```
```
HTTP/1.1 206 Partial Content
Content-Length: 65536
Content-Range: bytes 0-65535/91057468
```
Với file **faststart**, trình duyệt xin vài trăm KB đầu, thấy <mark>moov</mark> ngay, biết cách phát, rồi xin tiếp đúng đoạn cần. Với file <mark>moov</mark> ở cuối, nó xin đầu file, không thấy mục lục, phải xin thêm **cuối file** (một Range request nữa) rồi mới tải lại từ đầu. Trên mạng chậm, đó là vài giây nhìn vòng xoay. Và nếu server không hỗ trợ Range (một số app server, hoặc file đi qua controller Rails bằng <mark>send_data</mark>), thì không tua được và phải tải hết 91MB.

S3, CloudFront, Cloudflare, nginx đều hỗ trợ Range sẵn. Vì vậy video nên được phát **thẳng từ S3/CDN**, không qua Rails.

#### Thẻ video đúng cách
```html
<video
  controls
  preload="metadata"
  poster="https://cdn.myapp.com/videos/42/poster.jpg"
  width="1280" height="720"
  playsinline>
  <source src="https://cdn.myapp.com/videos/42/web720.mp4" type="video/mp4">
</video>
```

| Thuộc tính | Tại sao |
|---|---|
| <mark>preload="metadata"</mark> | Chỉ tải phần đầu (moov, vài trăm KB) để biết thời lượng và kích thước. Mặc định của Chrome là <mark>auto</mark>, có thể tải trước vài MB cho **mỗi** video trên trang, dù người xem không bấm |
| <mark>poster</mark> | Ảnh JPEG 50KB hiện ngay, thay vì trình duyệt phải tải video để lấy khung đầu. Với <mark>preload="none"</mark> thì bắt buộc có poster, nếu không ô video sẽ đen |
| <mark>width</mark>/<mark>height</mark> | Trình duyệt giữ chỗ đúng tỷ lệ trước khi tải, trang không bị nhảy (CLS) |
| <mark>playsinline</mark> | iPhone phát trong trang thay vì bung toàn màn hình |
| <mark>type="video/mp4"</mark> | Trình duyệt biết có phát được không mà không cần tải thử |

Trang danh sách có 20 video: <mark>preload="none"</mark> + poster, chỉ tải khi bấm. Trang xem một video: <mark>preload="metadata"</mark>.

Video nền (hero) tự chạy thì phải <mark>muted</mark>, trình duyệt mới cho autoplay
```html
<video autoplay muted loop playsinline preload="auto" poster="hero.jpg">
  <source src="hero-480p.mp4" type="video/mp4">
</video>
```
Và video nền nên là bản **nhỏ** (480p, không tiếng, 10 - 15 giây, dưới 2MB), đừng dùng bản 1080p của trang xem video.

#### Phát HLS
Safari (iOS và macOS) phát <mark>.m3u8</mark> trực tiếp trong thẻ <mark>&lt;video&gt;</mark>. Chrome, Firefox, Edge thì không, cần thư viện **hls.js** (khoảng 100KB gzip), nó tải các đoạn và đưa vào trình duyệt qua Media Source Extensions
```html
<video id="player" controls preload="metadata" poster="poster.jpg" width="1280" height="720" playsinline></video>
<script src="https://cdn.jsdelivr.net/npm/hls.js@1.6.2/dist/hls.min.js"></script>
```
```javascript
const video = document.querySelector("#player");
const src = "https://cdn.myapp.com/videos/42/master.m3u8";

if (video.canPlayType("application/vnd.apple.mpegurl")) {
  video.src = src;                       // Safari: phát thẳng
} else if (Hls.isSupported()) {
  const hls = new Hls({ startLevel: -1 }); // -1: tự chọn phiên bản đầu theo tốc độ đo được
  hls.loadSource(src);
  hls.attachMedia(video);
  hls.on(Hls.Events.LEVEL_SWITCHED, (_, data) => {
    console.log("đang phát", hls.levels[data.level].height + "p");
  });
} else {
  video.src = "https://cdn.myapp.com/videos/42/web720.mp4"; // trình duyệt rất cũ: fallback MP4
}
```
Mở DevTools, tab Network, khi phát thấy đúng những gì bài 126 mô tả: <mark>master.m3u8</mark>, rồi <mark>360p/index.m3u8</mark> hoặc <mark>720p/index.m3u8</mark> tùy mạng, rồi <mark>init_1.mp4</mark> (1.3KB) và <mark>seg_000.m4s</mark> (444KB ở 360p, 1.4MB ở 720p), và cứ vài giây một đoạn mới. Bật throttling "Slow 4G" trong DevTools sẽ thấy hls.js tự chuyển xuống 360p, log in ra <mark>đang phát 360p</mark>.

Nếu không muốn tự ghép, các player như **Video.js**, **Plyr**, **Vidstack** đã tích hợp hls.js, có giao diện đẹp và phụ đề, tốc độ phát.

#### Server phải trả đúng Content-Type
Thử xem nginx mặc định trả gì cho các file HLS
```sh
for f in hls/master.m3u8 hls/720p/seg_000.m4s hls/720p/init_1.mp4; do
  echo "$f: $(curl -sI http://localhost:8089/$f | grep -i content-type)"
done
```
```
hls/master.m3u8:        Content-Type: application/vnd.apple.mpegurl
hls/720p/seg_000.m4s:   Content-Type: application/octet-stream     <- sai
hls/720p/init_1.mp4:    Content-Type: video/mp4
```
nginx không biết <mark>.m4s</mark>. Hầu hết player vẫn phát được với <mark>octet-stream</mark>, nhưng một số CDN sẽ **không nén và không cache** đúng, và Safari đôi khi từ chối. Khai báo thêm
```
# nginx.conf
types {
    application/vnd.apple.mpegurl  m3u8;
    video/iso.segment              m4s;
    video/mp4                      mp4;
}
```
Với S3 thì <mark>content_type</mark> được set lúc upload, đó là lý do bài 126 có hàm <mark>content_type_for</mark>.

#### CDN và cache
Video là thứ nặng nhất trên trang, luôn đặt sau CDN (CloudFront, Cloudflare, Bunny). Hai quy tắc cache:
- Các đoạn HLS và file MP4 **không bao giờ đổi** (đổi là tạo video mới với id mới): <mark>Cache-Control: public, max-age=31536000, immutable</mark>. CDN và trình duyệt giữ mãi.
- <mark>master.m3u8</mark> và <mark>index.m3u8</mark> của VOD cũng không đổi, cache như trên. Chỉ với livestream playlist mới cần <mark>max-age</mark> vài giây.

Với Active Storage, đặt header này khi upload qua <mark>config.active_storage.service_urls_expire_in</mark> không đủ; cần cấu hình <mark>upload:</mark> trong <mark>storage.yml</mark>
```yaml
amazon:
  service: S3
  bucket: my-app-videos
  upload:
    cache_control: "public, max-age=31536000, immutable"
```
Và trỏ CDN vào bucket, dùng URL CDN trong thẻ video thay vì <mark>rails_blob_url</mark> (URL này redirect qua Rails mỗi lần, mất một round trip và không cache được).

#### Video riêng tư
Khóa học trả phí, video nội bộ: không thể để URL công khai. Cách làm với HLS hơi khác ảnh, vì có hàng chục file đoạn:
- **CloudFront signed cookie**: Rails set một cookie có chữ ký cho domain CDN khi người dùng có quyền; mọi request tới <mark>videos/42/*</mark> đều được kiểm tra bằng cookie đó. Hợp nhất với HLS vì ký một lần cho cả thư mục.
- **Signed URL** từng file: Rails phải viết lại <mark>m3u8</mark> để mỗi dòng đoạn có chữ ký riêng. Phức tạp, chỉ dùng khi không có CDN hỗ trợ cookie.
- Dịch vụ như Mux, Cloudflare Stream có sẵn signed playback token.

Lưu ý: đây là chống **chia sẻ link**, không chống **tải về**. Người có quyền xem luôn có thể ghi lại; DRM thật (Widevine, FairPlay) là một thế giới khác và hiếm khi đáng công với ứng dụng thông thường.

#### Lazy load và nhiều video trên trang
Trang feed có hàng chục video, chỉ tải cái đang nhìn thấy. Dùng <mark>IntersectionObserver</mark> (bài 118), và chỉ giữ **một** player hls.js hoạt động tại một thời điểm, vì mỗi instance giữ buffer vài MB
```javascript
let active = null;

const observer = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    const video = entry.target;
    if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
      if (active && active !== video) { active.pause(); active.removeAttribute("src"); active.load(); }
      if (!video.src) video.src = video.dataset.src;
      video.play().catch(() => {});   // autoplay có thể bị chặn, bỏ qua
      active = video;
    } else if (video === active) {
      video.pause();
    }
  });
}, { threshold: [0, 0.6] });

document.querySelectorAll("video[data-src]").forEach((v) => observer.observe(v));
```
```html
<video data-src="https://cdn.myapp.com/videos/42/web480.mp4" poster="..." muted playsinline preload="none" width="720" height="1280"></video>
```
<mark>removeAttribute("src")</mark> + <mark>load()</mark> giải phóng bộ nhớ của video đã cuộn qua. Thiếu bước này, feed dài sẽ làm tab Safari trên iPhone bị tải lại.

#### Tua video có nhanh không
Câu hỏi hay gặp: người xem kéo thanh thời gian tới phút 30 của video 60 phút, có phải tải 30 phút đầu không? **Không**, nếu làm đúng 3 điều ở các bài trước. Với mỗi cách phát, trình duyệt làm như sau:

**MP4 faststart**: <mark>moov</mark> (đã có từ đầu) chứa bảng "frame thứ N nằm ở byte nào, frame nào là keyframe". Kéo tới 30:00, trình duyệt tra bảng, tìm keyframe gần nhất **trước** mốc đó, gửi **một Range request** từ byte tương ứng, bỏ qua hoàn toàn 30 phút đầu. Độ trễ bằng thời gian tải vài trăm KB, thường dưới 1 giây. Điều kiện: file có faststart **và** server trả <mark>Accept-Ranges</mark>. Thiếu một trong hai, trình duyệt phải tải tuần tự từ đầu, và kéo tới phút 30 là chờ cả chục MB.

**HLS**: <mark>index.m3u8</mark> ghi rõ từng đoạn dài bao nhiêu giây. Kéo tới 30:00 với đoạn 4 giây, hls.js tính ngay cần đoạn số 450, tải <mark>seg_450.m4s</mark> (khoảng 1.4MB ở 720p) và phát. Các đoạn trước đó không được tải. Nếu mạng lúc đó yếu, nó còn có thể lấy đoạn 450 của phiên bản 360p (444KB) để hiện hình nhanh rồi mới nâng chất lượng.

Ba tham số ở bài 126 quyết định tua nhanh hay chậm:

| Tham số | Ảnh hưởng khi tua |
|---|---|
| <mark>-movflags +faststart</mark> | Không có thì MP4 phải tải tới cuối file mới có bảng chỉ mục để tua |
| <mark>-g 60</mark> (keyframe mỗi 2 giây) | Chỉ giải mã được **từ keyframe**. Kéo tới 30:01 thì phải tải và giải mã từ keyframe 30:00, bỏ 1 giây đầu. Keyframe thưa (10 giây) thì mỗi lần tua phải giải mã tới 10 giây thừa, cảm giác "lag" rõ |
| <mark>-hls_time 4</mark> | Đoạn càng ngắn tua càng mịn (tải ít hơn trước khi phát) nhưng nhiều request hơn. 2 - 6 giây là khoảng hợp lý, và nên là bội số của khoảng keyframe |

Hai thứ khác hay làm tua chậm mà không phải do file:
- **CDN không cache theo khúc**: một số CDN khi nhận Range request lần đầu sẽ tải **cả file** từ S3 về rồi mới trả khúc đó. CloudFront, Cloudflare có chế độ cache theo khúc (range-based caching), hãy kiểm tra cấu hình nếu lần tua đầu tiên chậm bất thường còn lần sau thì nhanh.
- **Phát qua controller Rails** bằng <mark>send_data</mark>/<mark>send_file</mark>: Rails không trả Range, không tua được.

Kiểm tra nhanh trong DevTools: kéo thanh thời gian rồi nhìn tab Network. Với MP4 phải thấy **một** request <mark>206</mark> có <mark>Content-Range</mark> bắt đầu từ byte rất lớn; với HLS phải thấy đúng **một** đoạn có số thứ tự tương ứng, không phải một loạt đoạn từ 000.

Muốn giống YouTube, hiện ảnh nhỏ khi rê chuột trên thanh thời gian: tạo một ảnh ghép (sprite) mỗi 10 giây một khung bằng ffmpeg, kèm file WebVTT chỉ tọa độ, các player như Video.js, Plyr, Vidstack đọc được
```sh
ffmpeg -i source.mp4 -vf "fps=1/10,scale=160:-2,tile=10x6" -q:v 5 sprite.jpg
```
```
WEBVTT

00:00:00.000 --> 00:00:10.000
sprite.jpg#xywh=0,0,160,90

00:00:10.000 --> 00:00:20.000
sprite.jpg#xywh=160,0,160,90
```
Một ảnh 60 khung chỉ vài trăm KB, tải một lần, rê tới đâu thấy hình tới đó mà không tải video.

#### Đo
Hai con số đáng theo dõi, lấy từ sự kiện của thẻ video:
```javascript
const started = performance.now();
video.addEventListener("playing", () => {
  console.log("time to first frame:", Math.round(performance.now() - started), "ms");
}, { once: true });

let stalls = 0;
video.addEventListener("waiting", () => stalls++);   // hết buffer, phải chờ
video.addEventListener("ended", () => console.log("rebuffer:", stalls, "lần"));
```
Gửi 2 số này về analytics (bài 073). **Time to first frame** dưới 1 giây và **rebuffer** gần 0 là mục tiêu; nếu rebuffer cao ở 4G, thêm phiên bản 360p hoặc giảm bitrate.

#### Tổng kết series

| Bài | Việc | Điểm chính |
|---|---|---|
| 125 | Upload | Direct upload lên S3, validate 2 phía, file gốc chỉ là đầu vào |
| 126 | Xử lý | <mark>+faststart</mark>, H.264/AAC 720p (91MB → 11MB), HLS 4 phiên bản (34s/phút video), job queue riêng |
| 127 | Phát | Range requests, <mark>preload="metadata"</mark> + poster, hls.js, Content-Type đúng, CDN cache immutable, lazy load, tua nhanh |

Checklist khi có người than "video chậm": file có faststart chưa, có đang phát file gốc không, URL có qua CDN không, server có trả <mark>Accept-Ranges</mark> không, <mark>preload</mark> là gì, và mở tab Network xem đoạn đầu tiên nặng bao nhiêu.
