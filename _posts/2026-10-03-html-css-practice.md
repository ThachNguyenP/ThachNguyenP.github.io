---
layout: post
title:  "129. HTML & CSS thực hành (Phương pháp: từ thiết kế tới trang web)."
date:   2026-10-03 02:36:00 +0700
author: thach
categories: [Coding]
tags: [Css, Front End]
image: assets/images/post_129/html-css-method.png
---
Nhiều bạn mới học biết thẻ <mark>div</mark> là gì, biết <mark>flex</mark> là gì, nhưng đưa cho một tấm ảnh thiết kế thì không biết bắt đầu từ đâu, và kết quả là một trang có 40 cái <mark>div</mark> lồng nhau với class tên <mark>box1</mark>, <mark>box2</mark>. Series này là 8 bài thực hành, mỗi bài một trang web từ dễ tới khó, làm theo **cùng một quy trình 7 bước**. Bài này mô tả quy trình đó, các bài sau chỉ áp dụng.

Không framework, không JavaScript (trừ khi ghi rõ), chỉ HTML và CSS (từ bài 134 dùng thêm SCSS). Mọi bài đều có ảnh kết quả, mã nguồn đầy đủ để tải về, và chạy được bằng cách mở file <mark>index.html</mark>.

#### Quy trình 7 bước
1. **Nhìn thiết kế, tách thành component.** Khoanh từng khối lặp lại hoặc độc lập: header, card, nút, danh sách... Viết ra giấy dưới dạng cây.
2. **Đặt tên** cho từng khối theo quy ước BEM (bên dưới).
3. **Viết HTML khung**: đúng thẻ ngữ nghĩa, đúng class, chưa có CSS. Trang lúc này xấu nhưng đọc được.
4. **Layout**: đặt các khối lớn vào đúng chỗ bằng flexbox và grid (bài 009), chưa quan tâm màu sắc.
5. **Style component**: màu, chữ, khoảng cách, bo góc, bóng cho từng khối, dùng token.
6. **Hiệu ứng**: hover, transition, animation. Làm sau cùng, vì chúng là phần "thêm", không phải nền tảng.
7. **Responsive**: thu nhỏ trình duyệt, sửa những chỗ vỡ bằng media query. Chỉ sửa những gì vỡ.

Thứ tự này quan trọng: layout trước, màu sau. Người mới hay làm ngược lại, chỉnh màu nút rất đẹp rồi mới phát hiện cả trang không căn được.

#### Bước 1: Tách component
Lấy ví dụ một card hồ sơ (bài 130). Nhìn vào ảnh và liệt kê
```
card
├── cover (ảnh bìa)
├── avatar
├── body
│   ├── name
│   ├── title
│   ├── bio
│   ├── stats (3 cột số liệu)
│   │   └── stat × 3 (value + label)
│   └── actions
│       └── btn × 2 (primary, outline)
```
Hai câu hỏi giúp tách đúng:
- Khối này có **lặp lại** không? (3 stat giống nhau → một component <mark>stat</mark> dùng 3 lần)
- Khối này có **dùng được ở trang khác** không? (nút → component <mark>btn</mark> riêng, không phải <mark>card__button</mark>)

#### Bước 2: Đặt tên theo BEM
BEM = Block, Element, Modifier. Một quy ước đặt tên class để nhìn tên là biết nó thuộc khối nào, và tránh CSS của khối này đè lên khối kia.

| Loại | Cú pháp | Ví dụ | Ý nghĩa |
|---|---|---|---|
| Block | <mark>.block</mark> | <mark>.card</mark>, <mark>.btn</mark>, <mark>.nav</mark> | Khối độc lập, dùng được ở bất kỳ đâu |
| Element | <mark>.block__element</mark> | <mark>.card__title</mark>, <mark>.nav__link</mark> | Một phần **bên trong** block, không có nghĩa khi đứng một mình |
| Modifier | <mark>.block--modifier</mark> | <mark>.btn--primary</mark>, <mark>.card--featured</mark> | Một biến thể của block (màu khác, kích thước khác, trạng thái) |

```html
<article class="card card--featured">
  <h2 class="card__title">Tiêu đề</h2>
  <a class="btn btn--primary" href="#">Xem</a>
</article>
```
Vài quy tắc tôi luôn giữ:
- **Không lồng element**: <mark>.card__body__title</mark> là sai. Dù HTML lồng 3 cấp, class vẫn là <mark>.card__title</mark>. Cấu trúc HTML có thể đổi, tên class thì không nên.
- **Modifier luôn đi kèm block gốc**: <mark>class="btn btn--primary"</mark>, không bao giờ chỉ <mark>btn--primary</mark>.
- **Block bên trong block** thì vẫn là block: <mark>.btn</mark> nằm trong <mark>.card</mark> vẫn là <mark>.btn</mark>. Nếu cần chỉnh riêng vị trí của nó trong card, dùng element bao ngoài (<mark>.card__actions</mark>), không viết <mark>.card .btn { }</mark>.
- **Selector chỉ một cấp**: nhờ tên đã duy nhất, CSS chỉ cần <mark>.card__title { }</mark>, không cần <mark>.card .body .title</mark>. Specificity luôn thấp và bằng nhau, nên không bao giờ phải dùng <mark>!important</mark>.
- Tên theo **vai trò**, không theo hình thức: <mark>.btn--primary</mark> chứ không phải <mark>.btn--blue</mark>. Mai đổi màu thương hiệu, tên vẫn đúng.

#### Bước 3: HTML ngữ nghĩa
Dùng đúng thẻ trước khi nghĩ tới class. Trình duyệt, Google, và trình đọc màn hình đều hiểu các thẻ này; <mark>div</mark> thì không nói lên điều gì.

| Thay vì | Dùng |
|---|---|
| <mark>&lt;div class="header"&gt;</mark> | <mark>&lt;header&gt;</mark>, <mark>&lt;nav&gt;</mark> |
| <mark>&lt;div class="card"&gt;</mark> (nội dung độc lập) | <mark>&lt;article class="card"&gt;</mark> |
| <mark>&lt;div class="section"&gt;</mark> | <mark>&lt;section&gt;</mark> (có tiêu đề), <mark>&lt;aside&gt;</mark> (phụ) |
| <mark>&lt;div class="title"&gt;</mark> | <mark>&lt;h1&gt;</mark> - <mark>&lt;h3&gt;</mark>, đúng thứ bậc, mỗi trang một <mark>h1</mark> |
| <mark>&lt;div onclick&gt;</mark> | <mark>&lt;button&gt;</mark> (hành động) hoặc <mark>&lt;a href&gt;</mark> (đi tới trang khác) |
| <mark>&lt;div class="list"&gt;</mark> | <mark>&lt;ul&gt;</mark>/<mark>&lt;li&gt;</mark> |

<mark>div</mark> và <mark>span</mark> chỉ dùng khi không có thẻ nào phù hợp hơn (khối bọc để layout, một đoạn chữ cần style riêng).

#### Bước 4 - 5: Token và cấu trúc file CSS
Mọi màu, cỡ chữ, khoảng cách, bo góc được khai báo **một lần** ở đầu file dưới dạng CSS variable (token). Đổi màu thương hiệu là sửa một dòng.
```css
:root {
  --color-primary: #4f46e5;
  --color-text: #1f2937;
  --color-muted: #6b7280;
  --color-bg: #f3f4f6;
  --color-surface: #ffffff;
  --color-border: #e5e7eb;
  --radius: 16px;
  --shadow: 0 1px 3px rgba(0, 0, 0, 0.06), 0 10px 30px rgba(0, 0, 0, 0.08);
  --font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
}
```
Và một reset tối thiểu để các trình duyệt bắt đầu từ cùng một điểm
```css
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: var(--font); color: var(--color-text); line-height: 1.5; }
img { display: block; max-width: 100%; }
```
File <mark>style.css</mark> của mỗi bài được chia đúng theo các bước, có comment đánh dấu
```
/* ===== 1. Token & reset ===== */
/* ===== 2. Layout ===== */
/* ===== 3. Component ===== */
/* ===== 4. Hiệu ứng ===== */
/* ===== 5. Responsive ===== */
```
Từ bài 134 dùng SCSS, mỗi phần thành một file riêng (<mark>_tokens.scss</mark>, <mark>_layout.scss</mark>, <mark>components/_card.scss</mark>...) và một file <mark>main.scss</mark> gom lại.

Khoảng cách và cỡ chữ theo **thang**, không chọn số ngẫu nhiên: khoảng cách là bội số của 4 (4, 8, 12, 16, 24, 32, 48, 64); cỡ chữ theo rem (0.875, 1, 1.125, 1.25, 1.5, 2.25). Nhìn thiết kế thấy khoảng cách 13px thì làm tròn thành 12.

#### Bước 6: Hiệu ứng
Ba quy tắc để hiệu ứng không rẻ tiền:
- Chỉ transition <mark>transform</mark>, <mark>opacity</mark>, <mark>color</mark>, <mark>background-color</mark>, <mark>box-shadow</mark>. Đừng transition <mark>width</mark>, <mark>height</mark>, <mark>top</mark>, <mark>left</mark>: chúng làm trình duyệt tính lại layout mỗi frame.
- Thời gian 150 - 300ms cho hover, 300 - 600ms cho xuất hiện. Dài hơn là chậm chạp.
- Tôn trọng <mark>prefers-reduced-motion</mark>: người bị say chuyển động tắt animation trong hệ điều hành, CSS phải nghe theo.

#### Bước 7: Responsive
Làm cho desktop trước (vì thiết kế thường cho desktop), rồi thu nhỏ cửa sổ và sửa từng chỗ vỡ bằng <mark>@media (max-width: ...)</mark>. Ba mốc là đủ cho hầu hết trường hợp: <mark>900px</mark> (tablet), <mark>600px</mark> (điện thoại ngang), <mark>400px</mark> (điện thoại nhỏ). Nguyên tắc: nhiều cột thành một cột, menu ngang thành menu dọc, cỡ chữ tiêu đề giảm, padding giảm. Và luôn có <mark>&lt;meta name="viewport" content="width=device-width, initial-scale=1"&gt;</mark>, thiếu dòng này điện thoại sẽ hiển thị như desktop thu nhỏ.

Dùng grid với <mark>repeat(auto-fill, minmax(260px, 1fr))</mark> thì nhiều layout tự responsive mà không cần media query, bài 133 sẽ dùng.

#### Công cụ
- **VS Code** với extension **Live Server**: mở <mark>index.html</mark>, sửa là trình duyệt tự tải lại.
- **DevTools** (F12): tab Elements để xem và sửa thử CSS ngay trên trang; nút **Toggle device toolbar** (Ctrl+Shift+M) để xem ở kích thước điện thoại. Học cách dùng DevTools quan trọng ngang với học CSS.
- Từ bài 134: **Node.js** và <mark>npx sass --watch scss:css</mark> để biên dịch SCSS.
- Lấy màu từ ảnh thiết kế: công cụ chọn màu trong DevTools (bấm vào ô màu) hoặc extension ColorZilla.

#### 8 bài thực hành

| Bài | Trang | Kỹ năng mới |
|---|---|---|
| 130 | Card hồ sơ | BEM, token, flexbox, hover, transition |
| 131 | Bảng giá | Grid 3 cột, modifier, toggle bằng CSS, <mark>:has()</mark> |
| 132 | Landing page SaaS | Header/nav, hero 2 cột, menu di động không JS, animation xuất hiện |
| 133 | Danh sách sản phẩm | Grid auto-fill, sidebar lọc, <mark>aspect-ratio</mark>, hover hiện nút |
| 134 | Bài viết blog | SCSS, typography, mục lục sticky |
| 135 | Đăng nhập / đăng ký | Form, focus, floating label, trạng thái lỗi bằng CSS |
| 136 | Dashboard | <mark>grid-template-areas</mark>, bảng, biểu đồ bằng CSS |
| 137 | Trang nhà hàng | Keyframe animation, scroll-snap, dark mode, reduced motion |

Mỗi bài làm trong 1 - 3 giờ. Lời khuyên: **đừng copy code ngay**. Nhìn ảnh kết quả, tự tách component và viết HTML trước, rồi mới so với bài. Phần khó nhất của CSS không phải thuộc tính, mà là quyết định cấu trúc.
