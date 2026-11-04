---
layout: post
title:  "118. Thay jQuery bằng JavaScript hiện đại (Hiệu ứng, tiện ích & Kế hoạch gỡ jQuery)."
date:   2026-11-03 02:14:00 +0700
author: thach
categories: [ Coding, Javascript, Front End]
image: assets/images/post_118/jquery-to-es6-effects.png
---
Bài cuối gom những gì còn lại: hiệu ứng, các hàm tiện ích <mark>$.xxx</mark>, plugin, và quan trọng nhất là làm sao gỡ jQuery khỏi một dự án đang chạy mà không phải viết lại từ đầu.

#### Hiệu ứng: để CSS làm
<mark>fadeIn</mark>, <mark>slideDown</mark>, <mark>animate</mark> của jQuery chạy bằng JavaScript, đổi <mark>style</mark> mỗi vài mili giây. CSS transition làm việc đó mượt hơn, chạy trên GPU, và JavaScript chỉ cần đổi class
```css
.toast {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 0.3s, transform 0.3s;
}
.toast.is-visible {
  opacity: 1;
  transform: translateY(0);
}
```
```javascript
// jQuery
$toast.fadeIn(300);
$toast.fadeOut(300, () => $toast.remove());

// JavaScript
toast.classList.add('is-visible');

toast.classList.remove('is-visible');
toast.addEventListener('transitionend', () => toast.remove(), { once: true });
```
Bẫy nhỏ: phần tử vừa <mark>append</mark> xong mà thêm class ngay thì không có transition, vì trình duyệt chưa kịp vẽ trạng thái đầu. Chờ một frame
```javascript
document.body.append(toast);
requestAnimationFrame(() => toast.classList.add('is-visible'));
```

<mark>slideDown</mark>/<mark>slideUp</mark> (mở rộng chiều cao) khó làm bằng CSS vì <mark>height: auto</mark> không transition được. Hai cách: dùng <mark>&lt;details&gt;</mark> nếu chỉ cần đóng mở, hoặc transition <mark>grid-template-rows</mark> từ <mark>0fr</mark> sang <mark>1fr</mark>
```css
.collapsible { display: grid; grid-template-rows: 0fr; transition: grid-template-rows 0.3s; }
.collapsible.is-open { grid-template-rows: 1fr; }
.collapsible > div { overflow: hidden; }
```

Khi thật sự cần animate bằng JavaScript (giá trị tính toán lúc chạy), có **Web Animations API**, cú pháp gần <mark>.animate()</mark> của jQuery
```javascript
// jQuery
$el.animate({ opacity: 0, left: '100px' }, 500, () => $el.remove());

// JavaScript
const animation = el.animate(
  [{ opacity: 1, transform: 'translateX(0)' }, { opacity: 0, transform: 'translateX(100px)' }],
  { duration: 500, easing: 'ease-out', fill: 'forwards' }
);
await animation.finished;
el.remove();
```
Cuộn mượt tới một phần tử, thay cho <mark>$('html, body').animate({ scrollTop: ... })</mark>
```javascript
el.scrollIntoView({ behavior: 'smooth', block: 'start' });
window.scrollTo({ top: 0, behavior: 'smooth' });
```

#### Các hàm tiện ích
jQuery có một loạt <mark>$.xxx</mark> từ thời JavaScript thiếu thốn. Giờ ngôn ngữ đã có sẵn hết
```javascript
// jQuery                              // JavaScript
$.each(arr, (i, v) => ...)             arr.forEach((v, i) => ...)   // chú ý thứ tự tham số đảo lại
$.each(obj, (k, v) => ...)             Object.entries(obj).forEach(([k, v]) => ...)
$.map(arr, fn)                         arr.map(fn)
$.grep(arr, fn)                        arr.filter(fn)
$.inArray(v, arr) !== -1               arr.includes(v)
$.extend({}, a, b)                     { ...a, ...b }  hoặc Object.assign({}, a, b)
$.extend(true, {}, a)                  structuredClone(a)            // deep copy
$.trim(s)                              s.trim()
$.isArray(x)                           Array.isArray(x)
$.isFunction(x)                        typeof x === 'function'
$.isEmptyObject(o)                     Object.keys(o).length === 0
$.parseJSON(s)                         JSON.parse(s)
$.param(obj)                           new URLSearchParams(obj).toString()
$.now()                                Date.now()
$.unique(arr)                          [...new Set(arr)]
$.proxy(fn, ctx)                       fn.bind(ctx)  hoặc arrow function
```
<mark>$.Deferred</mark> thay bằng <mark>Promise</mark>, <mark>$.when</mark> thay bằng <mark>Promise.all</mark> (bài 117).

#### Kích thước và vị trí
```javascript
// jQuery                      // JavaScript
$el.width()                    el.clientWidth  (hoặc getBoundingClientRect().width, có số lẻ)
$el.outerWidth()               el.offsetWidth
$el.outerWidth(true)           el.offsetWidth + margin (đọc từ getComputedStyle)
$el.offset()                   el.getBoundingClientRect() + window.scrollY/scrollX
$el.position()                 { top: el.offsetTop, left: el.offsetLeft }
$(window).width()              window.innerWidth
$(window).scrollTop()          window.scrollY
$(document).height()           document.documentElement.scrollHeight
```
<mark>getBoundingClientRect()</mark> là thứ hay dùng nhất: trả về <mark>top</mark>, <mark>left</mark>, <mark>width</mark>, <mark>height</mark> so với khung nhìn. Kiểm tra phần tử có đang hiện trong màn hình không (lazy load, infinite scroll) thì có hẳn API riêng, tốt hơn tính tay
```javascript
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) loadMore();
  });
});
observer.observe(document.querySelector('#load-more-sentinel'));
```

#### Plugin jQuery
Đây là phần khó nhất. Datepicker, select2, slick carousel, lightbox... viết cho jQuery và không chạy nếu thiếu nó. Với mỗi plugin, có 3 lựa chọn:
1. **HTML có sẵn**: <mark>&lt;input type="date"&gt;</mark>, <mark>&lt;dialog&gt;</mark> (modal, có sẵn backdrop và phím Escape), <mark>&lt;details&gt;</mark> (accordion), <mark>&lt;datalist&gt;</mark> (autocomplete đơn giản), <mark>popover</mark> attribute (tooltip, dropdown). Đủ cho nhiều trường hợp, không cần thư viện.
2. **Thư viện không phụ thuộc jQuery** cùng chức năng: Tom Select thay select2, Flatpickr thay jQuery UI datepicker, Swiper thay slick, Sortable.js thay jQuery UI sortable, Chart.js, Choices.js.
3. **Giữ lại**: nếu plugin quá phức tạp để thay (một bảng dữ liệu đầy tính năng). Lúc đó jQuery vẫn ở lại, nhưng chỉ cho plugin đó, code mới không dùng.

Ví dụ modal, trước đây là plugin, giờ là HTML
```html
<dialog id="confirm">
  <p>Xóa sản phẩm này?</p>
  <form method="dialog">
    <button value="cancel">Hủy</button>
    <button value="ok">Xóa</button>
  </form>
</dialog>
```
```javascript
const dialog = document.querySelector('#confirm');
dialog.showModal();
dialog.addEventListener('close', () => {
  if (dialog.returnValue === 'ok') deleteItem();
}, { once: true });
```

#### Rails: Stimulus
Nếu bạn làm Rails, có một lựa chọn rất tự nhiên: **Stimulus** (có sẵn trong Rails 7+). Nó không thay DOM API, mà cho một cách **tổ chức** code vanilla JS theo HTML, giải quyết đúng vấn đề mà code jQuery hay gặp: không biết đoạn JS nào gắn vào đoạn HTML nào. Ví dụ giỏ hàng của 3 bài trước viết lại thành controller
```html
<ul id="cart" data-controller="cart" data-cart-total-id-value="total">
  <li class="item" data-price="150000">
    <input type="number" value="1" data-action="input->cart#update">
    <button data-action="cart#remove">x</button>
  </li>
</ul>
<span id="total">0</span>
```
```javascript
// app/javascript/controllers/cart_controller.js

import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = { totalId: String }

  remove(event) {
    event.target.closest(".item").remove()
    this.update()
  }

  update() {
    const total = [...this.element.querySelectorAll(".item")].reduce((sum, el) => {
      return sum + Number(el.dataset.price) * Number(el.querySelector("input").value || 1)
    }, 0)
    document.getElementById(this.totalIdValue).textContent = total.toLocaleString("vi-VN")
  }
}
```
Không còn <mark>querySelector</mark> để tìm nút, không còn lo gắn listener sau khi Turbo thay trang. Bên trong vẫn là đúng những API của series này.

#### Kế hoạch gỡ jQuery khỏi dự án đang chạy
Đừng viết lại một lần. Làm từng bước, mỗi bước deploy được:
1. **Đo**: tìm mọi chỗ dùng. <mark>grep -rn "\$(\|jQuery" app/javascript app/views</mark>. Lập danh sách file và plugin.
2. **Chặn code mới**: thêm rule ESLint <mark>no-restricted-globals</mark> cho <mark>$</mark> và <mark>jQuery</mark>, có ngoại lệ cho các file cũ. Từ giờ code mới là vanilla.
3. **Thay plugin trước**: đây là phần quyết định có gỡ được hay không. Mỗi plugin một PR.
4. **Chuyển từng file** theo thứ tự từ ít phụ thuộc tới nhiều, dùng bảng tra của 4 bài này. Test bằng tay từng màn hình, vì code jQuery cũ hiếm khi có test.
5. **Gỡ gem/package**: <mark>jquery-rails</mark>, <mark>jquery_ujs</mark>. Nếu dùng <mark>rails-ujs</mark> cho <mark>data-confirm</mark>, <mark>data-method</mark>, thay bằng Turbo (<mark>data-turbo-confirm</mark>, <mark>data-turbo-method</mark>).
6. **Kiểm tra lần cuối**: mở console trên các trang chính, bất kỳ <mark>$ is not defined</mark> nào là còn sót.

Dấu hiệu không nên gỡ: dự án sắp kết thúc, hoặc jQuery chỉ phục vụ một plugin lớn đang chạy ổn. Gỡ jQuery là để code mới dễ viết và dễ bảo trì hơn, không phải mục tiêu tự thân.

#### Tổng kết series

| Bài | Nội dung |
|---|---|
| 115 | <mark>querySelector</mark>, <mark>classList</mark>, <mark>dataset</mark>, <mark>append</mark>, <mark>&lt;template&gt;</mark> |
| 116 | <mark>addEventListener</mark>, delegation với <mark>closest</mark>, <mark>AbortController</mark>, <mark>CustomEvent</mark>, debounce |
| 117 | <mark>fetch</mark>, <mark>response.ok</mark>, <mark>FormData</mark>, CSRF, <mark>AbortSignal</mark>, module <mark>api.js</mark> |
| 118 | CSS transition, Web Animations, tiện ích, plugin, Stimulus, kế hoạch gỡ |

Nếu chỉ nhớ một điều: jQuery không sai, nó chỉ đã hoàn thành nhiệm vụ. Những gì nó dạy cho chúng ta giờ đã nằm sẵn trong trình duyệt.
