---
layout: post
title:  "128. Avatar crop (Chọn ảnh, cắt tròn, lưu bằng Active Storage)."
date:   2026-11-03 02:34:00 +0700
author: thach
categories: [ Coding, Javascript, Front End]
image: assets/images/post_128/avatar-crop.png
---
Tính năng đổi ảnh đại diện: người dùng chọn một tấm ảnh, kéo và phóng to để đưa khuôn mặt vào trong vòng tròn, bấm lưu. Bài này làm từ đầu bằng JavaScript thuần (không thư viện) và Rails với Active Storage, khoảng 100 dòng JS và 30 dòng Ruby. Làm xong bạn sẽ hiểu cách mọi thư viện crop hoạt động bên trong.

Version sử dụng: Rails 8, Active Storage, libvips. Phần JavaScript chạy được trên mọi trình duyệt hiện nay, kể cả cảm ứng.

#### Thiết kế
Ba quyết định trước khi code:
1. **Crop ở trình duyệt**, server chỉ nhận ảnh đã cắt. Ảnh gốc từ điện thoại 5 - 10MB, ảnh cắt xong chỉ 50KB; không cần tải ảnh gốc lên.
2. **Lưu ảnh vuông, hiển thị tròn bằng CSS** (<mark>border-radius: 50%</mark>). Hình tròn thật phải là PNG có nền trong suốt, nặng hơn 5 lần, và sau này muốn đổi sang bo góc vuông thì không được. Instagram, GitHub đều lưu vuông.
3. **Server xử lý lại ảnh** (resize về 512×512, encode lại) bằng libvips. Không tin kích thước hay định dạng từ trình duyệt.

Giao diện gồm một khung vuông 300px, ảnh nằm trong và có thể kéo, một lớp phủ tối bên ngoài vòng tròn, một thanh trượt để phóng to.

```
┌─────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░ │   ░ = lớp phủ tối (ngoài vòng tròn)
│ ░░░░╭─────────╮░░░░ │
│ ░░░╱           ╲░░░ │   ảnh nằm dưới, kéo được
│ ░░│   (ảnh)     │░░ │
│ ░░░╲           ╱░░░ │
│ ░░░░╰─────────╯░░░░ │
│ ░░░░░░░░░░░░░░░░░░░ │
└─────────────────────┘
  [────●────────] zoom     [Lưu ảnh đại diện]
```

#### HTML và CSS
```html
<div class="avatar-crop">
  <input type="file" id="file" accept="image/jpeg,image/png,image/webp">

  <div class="viewport" id="viewport">
    <img id="image" alt="" draggable="false">
    <div class="mask"></div>
  </div>

  <input type="range" id="zoom" min="1" max="4" step="0.01" value="1" disabled>
  <button type="button" id="save" disabled>Lưu ảnh đại diện</button>
  <p id="status"></p>
</div>
```
```css
.viewport {
  position: relative;
  width: 300px;
  height: 300px;
  overflow: hidden;
  background: #222;
  cursor: grab;
  touch-action: none;        /* để trình duyệt không cuộn trang khi kéo ảnh bằng ngón tay */
}
.viewport img {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: 0 0;     /* phóng to từ góc trên trái, tính toán đơn giản hơn */
  user-select: none;
  -webkit-user-drag: none;
}
.viewport .mask {
  position: absolute;
  inset: 0;
  border-radius: 50%;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.6);   /* bóng khổng lồ phủ tối bên ngoài vòng tròn */
  pointer-events: none;      /* không chặn sự kiện kéo của ảnh bên dưới */
}
```
Mẹo lớp phủ: một <mark>div</mark> tròn trong suốt với <mark>box-shadow</mark> rất lớn. Bên trong vòng tròn nhìn xuyên xuống ảnh, bên ngoài bị bóng phủ tối. Không cần canvas, không cần SVG.

#### Phần toán: 4 hàm pure
Trạng thái của ảnh trong khung là 3 số: <mark>scale</mark> (1 pixel ảnh gốc = bao nhiêu pixel màn hình) và <mark>ox</mark>, <mark>oy</mark> (góc trên trái của ảnh nằm ở đâu trong khung). Mọi thao tác chỉ là tính ra 3 số mới. Viết chúng thành hàm pure (bài 119) để test được không cần trình duyệt
```javascript
// avatar_crop_math.js

// Tỷ lệ nhỏ nhất để ảnh phủ kín khung (không hở nền)
export function minScale(imgW, imgH, size) {
  return Math.max(size / imgW, size / imgH);
}

// Giữ ảnh luôn phủ kín khung: không kéo lọt mép
export function clampOffset(ox, oy, imgW, imgH, scale, size) {
  const w = imgW * scale;
  const h = imgH * scale;
  return {
    ox: Math.min(0, Math.max(size - w, ox)),
    oy: Math.min(0, Math.max(size - h, oy)),
  };
}

// Đổi tỷ lệ nhưng giữ điểm ảnh đang nằm dưới (cx, cy) đứng yên
export function zoomAround(state, newScale, cx, cy, imgW, imgH, size) {
  const ix = (cx - state.ox) / state.scale;   // điểm ảnh gốc đang ở dưới con trỏ
  const iy = (cy - state.oy) / state.scale;
  const ox = cx - ix * newScale;              // đặt lại để điểm đó vẫn ở (cx, cy)
  const oy = cy - iy * newScale;
  return { scale: newScale, ...clampOffset(ox, oy, imgW, imgH, newScale, size) };
}

// Vùng ảnh gốc đang nằm trong khung, tính bằng pixel ảnh gốc
export function cropRect(state, size) {
  return {
    sx: -state.ox / state.scale,
    sy: -state.oy / state.scale,
    sw: size / state.scale,
    sh: size / state.scale,
  };
}
```
Ví dụ: ảnh 4000×3000, khung 300. <mark>minScale</mark> = max(300/4000, 300/3000) = 0.1, ảnh hiển thị 400×300, vừa khít chiều cao. Kéo ngang được tối đa 100px (<mark>ox</mark> từ 0 tới -100). Nếu người dùng kéo tới <mark>ox = -150</mark>, <mark>clampOffset</mark> trả về -100.

Test nhanh bằng Node
```javascript
// avatar_crop_math.test.mjs
import assert from "node:assert";
import { minScale, clampOffset, zoomAround, cropRect } from "./avatar_crop_math.js";

const [W, H, SIZE] = [4000, 3000, 300];
const s = minScale(W, H, SIZE);
assert.equal(s, 0.1);

assert.deepEqual(clampOffset(-150, 10, W, H, s, SIZE), { ox: -100, oy: 0 });

// zoom gấp đôi quanh tâm khung: điểm ảnh ở tâm phải đứng yên
const before = { scale: s, ox: -50, oy: 0 };
const centerBefore = (SIZE / 2 - before.ox) / before.scale;
const after = zoomAround(before, s * 2, SIZE / 2, SIZE / 2, W, H, SIZE);
const centerAfter = (SIZE / 2 - after.ox) / after.scale;
assert.equal(centerAfter, centerBefore);

// vùng cắt phải nằm trong ảnh gốc
const r = cropRect(after, SIZE);
assert.ok(r.sx >= 0 && r.sy >= 0 && r.sx + r.sw <= W && r.sy + r.sh <= H);
assert.equal(r.sw, 1500); // 300 / 0.2

console.log("ok");
```
```sh
node avatar_crop_math.test.mjs # => ok
```

#### Gắn vào DOM
```javascript
// avatar_crop.js
import { minScale, clampOffset, zoomAround, cropRect } from "./avatar_crop_math.js";

const SIZE = 300;      // kích thước khung (px)
const OUTPUT = 512;    // kích thước ảnh xuất ra

const $ = (s) => document.querySelector(s);
const fileInput = $("#file"), viewport = $("#viewport"), img = $("#image");
const zoomInput = $("#zoom"), saveButton = $("#save"), status = $("#status");

let state = null;      // { scale, ox, oy }
let imgW = 0, imgH = 0;
let drag = null;

const render = () => {
  img.style.transform = `translate(${state.ox}px, ${state.oy}px) scale(${state.scale})`;
};

// 1. Chọn ảnh
fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;

  try {
    await loadImage(URL.createObjectURL(file));
  } catch {
    status.textContent = "Không đọc được ảnh này, hãy chọn JPG, PNG hoặc WebP";
    return;
  }

  imgW = img.naturalWidth;
  imgH = img.naturalHeight;
  const scale = minScale(imgW, imgH, SIZE);
  state = { scale, ox: (SIZE - imgW * scale) / 2, oy: (SIZE - imgH * scale) / 2 };  // căn giữa

  zoomInput.min = scale;
  zoomInput.max = scale * 4;
  zoomInput.value = scale;
  zoomInput.disabled = saveButton.disabled = false;
  status.textContent = "";
  render();
});

function loadImage(url) {
  return new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = url;
  });
}

// 2. Kéo (pointer events dùng chung cho chuột và cảm ứng)
viewport.addEventListener("pointerdown", (e) => {
  if (!state) return;
  drag = { x: e.clientX, y: e.clientY, ox: state.ox, oy: state.oy };
  viewport.setPointerCapture(e.pointerId);   // vẫn nhận pointermove khi con trỏ ra ngoài khung
});

viewport.addEventListener("pointermove", (e) => {
  if (!drag) return;
  const ox = drag.ox + (e.clientX - drag.x);
  const oy = drag.oy + (e.clientY - drag.y);
  state = { ...state, ...clampOffset(ox, oy, imgW, imgH, state.scale, SIZE) };
  render();
});

["pointerup", "pointercancel"].forEach((type) => viewport.addEventListener(type, () => (drag = null)));

// 3. Zoom bằng thanh trượt (quanh tâm) và con lăn chuột (quanh con trỏ)
zoomInput.addEventListener("input", () => {
  state = zoomAround(state, Number(zoomInput.value), SIZE / 2, SIZE / 2, imgW, imgH, SIZE);
  render();
});

viewport.addEventListener("wheel", (e) => {
  if (!state) return;
  e.preventDefault();
  const min = Number(zoomInput.min), max = Number(zoomInput.max);
  const next = Math.min(max, Math.max(min, state.scale * (e.deltaY < 0 ? 1.1 : 0.9)));
  const rect = viewport.getBoundingClientRect();
  state = zoomAround(state, next, e.clientX - rect.left, e.clientY - rect.top, imgW, imgH, SIZE);
  zoomInput.value = next;
  render();
}, { passive: false });

// 4. Cắt và upload
saveButton.addEventListener("click", async () => {
  const { sx, sy, sw, sh } = cropRect(state, SIZE);

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = OUTPUT;
  canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));

  const body = new FormData();
  body.append("avatar", blob, "avatar.jpg");

  saveButton.disabled = true;
  status.textContent = "Đang lưu...";
  try {
    const response = await fetch("/profile/avatar", {
      method: "PATCH",
      body,
      headers: {
        "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]').content,
        "Accept": "application/json",
      },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);

    document.querySelectorAll("img.avatar").forEach((el) => (el.src = data.url));  // cập nhật avatar trên header
    status.textContent = "Đã lưu";
  } catch (error) {
    status.textContent = error.message || "Có lỗi xảy ra, thử lại";
  } finally {
    saveButton.disabled = false;
  }
});
```
Hai dòng đáng chú ý:
- <mark>drawImage(img, sx, sy, sw, sh, 0, 0, OUTPUT, OUTPUT)</mark>: lấy vùng <mark>cropRect</mark> của ảnh gốc, vẽ co giãn vào canvas 512×512. Đây là toàn bộ phép cắt, và nó cắt từ **ảnh gốc đầy đủ** chứ không phải ảnh nhỏ đang hiển thị, nên avatar sắc nét.
- <mark>canvas.toBlob(..., "image/jpeg", 0.9)</mark>: ảnh 512×512 JPEG chất lượng 0.9 nặng khoảng 40 - 80KB. Chọn <mark>image/webp</mark> nếu không cần hỗ trợ Safari cũ.

Phần gọi API giống bài 117: <mark>FormData</mark>, không tự đặt <mark>Content-Type</mark>, kiểm tra <mark>response.ok</mark>.

#### Rails
```sh
bundle add image_processing
brew install vips   # macOS; Ubuntu: apt install libvips
```
```ruby
# app/models/user.rb

class User < ApplicationRecord
  has_one_attached :avatar do |attachable|
    attachable.variant :thumb, resize_to_fill: [128, 128], format: :webp, preprocessed: true
    attachable.variant :large, resize_to_fill: [512, 512], format: :webp
  end
end
```
```ruby
# config/routes.rb
resource :profile, only: [] do
  patch :avatar
end
```
```ruby
# app/controllers/profiles_controller.rb

class ProfilesController < ApplicationController
  ALLOWED = %w[image/jpeg image/png image/webp].freeze

  def avatar
    file = params.require(:avatar)
    type = Marcel::MimeType.for(file.tempfile)        # đọc byte đầu của file, không tin content_type trình duyệt gửi

    return render json: { error: "Chỉ nhận ảnh JPG, PNG, WebP" }, status: :unprocessable_entity unless type.in?(ALLOWED)
    return render json: { error: "Ảnh tối đa 2MB" }, status: :unprocessable_entity if file.size > 2.megabytes

    current_user.avatar.attach(io: file.tempfile, filename: "avatar.jpg", content_type: type)
    render json: { url: url_for(current_user.avatar.variant(:thumb)) }
  end
end
```
Điểm quan trọng: server **không dùng ảnh người dùng gửi lên để hiển thị**. Mọi nơi hiển thị đều qua <mark>variant</mark>, tức là libvips đã resize về đúng kích thước, encode lại sang WebP, bỏ metadata (EXIF, GPS). Kể cả khi ai đó bỏ qua giao diện và gửi thẳng một ảnh 8000×8000 vào API, thứ hiển thị vẫn là 128×128. <mark>preprocessed: true</mark> tạo sẵn variant <mark>thumb</mark> ngay khi attach (trong job), để lần hiển thị đầu không phải chờ.

Hiển thị
```erb
<%# app/views/shared/_avatar.html.erb %>
<% if user.avatar.attached? %>
  <%= image_tag user.avatar.variant(:thumb), class: "avatar", width: 40, height: 40, alt: user.name %>
<% else %>
  <%= image_tag "default-avatar.svg", class: "avatar", width: 40, height: 40, alt: user.name %>
<% end %>
```
```css
.avatar { border-radius: 50%; object-fit: cover; }
```
Ảnh vuông, CSS làm tròn. Muốn đổi sang bo góc 8px chỉ cần sửa một dòng CSS, không cần xử lý lại ảnh của mọi người dùng.

#### Những trường hợp cần để ý
- **Ảnh HEIC từ iPhone**: trình duyệt không hiển thị được, <mark>img.onerror</mark> sẽ nhảy vào nhánh báo lỗi ở trên. Với <mark>accept="image/jpeg,image/png,image/webp"</mark>, iOS tự chuyển HEIC sang JPEG khi chọn từ thư viện ảnh, nên thực tế hiếm gặp.
- **Ảnh bị xoay**: ảnh điện thoại có cờ EXIF orientation. Các trình duyệt hiện nay tự xoay khi hiển thị trong <mark>&lt;img&gt;</mark> và khi <mark>drawImage</mark>, nên không cần xử lý. Nếu phải hỗ trợ trình duyệt rất cũ, dùng <mark>createImageBitmap(file, { imageOrientation: "from-image" })</mark>.
- **Ảnh rất lớn** (50MP): Safari trên iPhone có giới hạn bộ nhớ cho canvas; ảnh trên 16MP có thể fail. Kiểm tra <mark>file.size</mark> trước (ví dụ từ chối trên 20MB) hoặc giảm kích thước bằng <mark>createImageBitmap(file, { resizeWidth: 2048 })</mark> trước khi đưa vào crop.
- **Pinch zoom** hai ngón trên điện thoại: code trên chưa có, thanh trượt vẫn dùng được. Thêm pinch cần theo dõi 2 pointer và tính khoảng cách giữa chúng, khoảng 20 dòng, dùng đúng <mark>zoomAround</mark> với tâm là điểm giữa 2 ngón.
- **Khung không phải 300px** (responsive): đọc <mark>viewport.clientWidth</mark> thay cho hằng <mark>SIZE</mark>, và tính lại <mark>state</mark> khi resize.

#### Dùng thư viện thì sao
<mark>Cropper.js</mark> (và bản React/Vue của nó) làm tất cả những thứ trên, kèm pinch zoom, xoay ảnh, tỷ lệ tùy ý, với khoảng 30KB. Nếu cần nhiều hơn avatar (cắt ảnh sản phẩm theo nhiều tỷ lệ, xoay), dùng nó. Phần server và cách hiển thị thì vẫn y như bài này: lưu vuông, xử lý lại bằng variant, làm tròn bằng CSS.

#### Tóm tắt
- Crop ở trình duyệt bằng <mark>drawImage</mark> với vùng cắt tính từ 3 số <mark>scale</mark>, <mark>ox</mark>, <mark>oy</mark>.
- Toán tách thành hàm pure, test bằng Node.
- Pointer events cho cả chuột và cảm ứng, <mark>touch-action: none</mark> để không cuộn trang.
- Lưu **vuông**, hiển thị **tròn** bằng CSS.
- Server kiểm tra loại file bằng byte thật và luôn hiển thị qua <mark>variant</mark>, không dùng ảnh gốc.
