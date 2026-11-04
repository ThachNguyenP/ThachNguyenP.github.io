---
layout: post
title:  "116. Thay jQuery bằng JavaScript hiện đại (Sự kiện)."
date:   2026-11-03 02:10:00 +0700
author: thach
categories: [ Coding, Javascript, Front End]
image: assets/images/post_116/jquery-to-es6-events.png
---
Phần lớn code jQuery trong một dự án là xử lý sự kiện: <mark>$(document).ready</mark>, <mark>.on('click')</mark>, <mark>.on('submit')</mark>. Bài này chuyển toàn bộ sang <mark>addEventListener</mark>, kể cả những tính năng tiện nhất của jQuery như delegation và <mark>.one()</mark>.

#### Chờ DOM sẵn sàng
```javascript
// jQuery
$(function () { init(); });
$(document).ready(init);

// JavaScript
document.addEventListener('DOMContentLoaded', init);
```
Hoặc không cần gì cả: đặt <mark>&lt;script defer src="app.js"&gt;</mark> hoặc <mark>&lt;script type="module"&gt;</mark> trong <mark>&lt;head&gt;</mark>, script sẽ tự chạy sau khi HTML đã parse xong, trước <mark>DOMContentLoaded</mark>. Đây là cách tôi dùng, hết hẳn việc bọc code trong <mark>ready</mark>.

#### Gắn và gỡ sự kiện
```javascript
// jQuery
$btn.on('click', handler);
$btn.off('click', handler);
$btn.one('click', handler);
$btn.trigger('click');

// JavaScript
btn.addEventListener('click', handler);
btn.removeEventListener('click', handler);
btn.addEventListener('click', handler, { once: true });
btn.click();  // hoặc btn.dispatchEvent(new Event('click'))
```
Để <mark>removeEventListener</mark> hoạt động, phải truyền **đúng function** đã gắn, không dùng được với arrow function viết inline. Cách gỡ hàng loạt mà không cần giữ tham chiếu: <mark>AbortController</mark>
```javascript
const controller = new AbortController();

btn.addEventListener('click', () => console.log('click'), { signal: controller.signal });
input.addEventListener('input', () => console.log('input'), { signal: controller.signal });

controller.abort(); // gỡ cả 2 cùng lúc
```
Rất hợp khi một component bị gỡ khỏi trang (modal đóng, tab chuyển) và cần dọn hết listener của nó.

Nhiều sự kiện cùng một handler: jQuery có <mark>.on('mouseenter mouseleave', fn)</mark>, JavaScript thì lặp
```javascript
['mouseenter', 'mouseleave'].forEach(type => el.addEventListener(type, fn));
```

#### Event object
```javascript
btn.addEventListener('click', (event) => {
  event.preventDefault();      // giống jQuery
  event.stopPropagation();     // giống jQuery
  event.target;                // phần tử thật sự được click (có thể là <span> trong <button>)
  event.currentTarget;         // phần tử đang gắn listener (chính btn), giống this của jQuery
  event.key;                   // với keydown: 'Enter', 'Escape', 'ArrowDown'
  event.ctrlKey, event.metaKey;
});
```
jQuery từng chuẩn hóa <mark>event.which</mark> vì các trình duyệt khác nhau; giờ <mark>event.key</mark> đã chuẩn ở mọi nơi.

Một khác biệt: trong jQuery, <mark>return false</mark> trong handler vừa <mark>preventDefault</mark> vừa <mark>stopPropagation</mark>. <mark>addEventListener</mark> **không** làm vậy, phải gọi rõ.

#### Event delegation
Tính năng quan trọng nhất của jQuery: gắn **một** listener trên cha, xử lý cho mọi con, kể cả con được thêm sau này
```javascript
// jQuery
$('#cart').on('click', '.remove', function (e) {
  $(this).closest('.item').remove();
});
```
JavaScript không có tham số selector, nhưng <mark>closest</mark> làm được đúng việc đó
```javascript
document.querySelector('#cart').addEventListener('click', (event) => {
  const button = event.target.closest('.remove');
  if (!button) return;                 // click vào chỗ khác trong #cart, bỏ qua

  button.closest('.item').remove();
});
```
Dùng <mark>closest</mark> thay vì <mark>event.target.matches('.remove')</mark> để vẫn bắt được khi click trúng icon nằm **trong** nút. Nếu muốn chắc chắn phần tử tìm được nằm trong vùng đang lắng nghe (không vượt ra ngoài), thêm <mark>&& event.currentTarget.contains(button)</mark>.

Nếu dùng nhiều, viết một hàm nhỏ
```javascript
function on(scope, type, selector, handler) {
  scope.addEventListener(type, (event) => {
    const target = event.target.closest(selector);
    if (target && scope.contains(target)) handler.call(target, event, target);
  });
}

on(document, 'click', '.remove', (event, button) => {
  button.closest('.item').remove();
});
```
Giờ cú pháp đã rất gần <mark>$(document).on('click', '.remove', ...)</mark>.

Lưu ý với <mark>focus</mark>, <mark>blur</mark>: hai sự kiện này **không nổi bọt** (bubble) nên không delegate được. Dùng <mark>focusin</mark>, <mark>focusout</mark> thay thế, jQuery cũng âm thầm làm vậy.

#### Form
```javascript
// jQuery
$('#checkout').on('submit', function (e) {
  e.preventDefault();
  const data = $(this).serialize();
});

// JavaScript
document.querySelector('#checkout').addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);   // mọi field có name
  const data = Object.fromEntries(formData);            // { email: '...', quantity: '2' }
});
```
<mark>FormData</mark> gửi thẳng được cho <mark>fetch</mark> (bài 117), kể cả file. Muốn chuỗi query như <mark>serialize()</mark>: <mark>new URLSearchParams(formData).toString()</mark>.

Sự kiện trên input
```javascript
input.addEventListener('input', e => ...);   // mỗi lần gõ, giống .on('input') / .on('keyup')
input.addEventListener('change', e => ...);  // khi rời field hoặc chọn xong (select, checkbox)
select.addEventListener('change', e => console.log(e.target.value));
```
Rails: nếu dùng Turbo, thay <mark>DOMContentLoaded</mark> bằng <mark>turbo:load</mark>, hoặc tốt hơn là gắn listener lên <mark>document</mark> với delegation như trên, không cần gắn lại sau mỗi lần Turbo thay trang.

#### Debounce và throttle
Ô tìm kiếm gọi API mỗi lần gõ phím thì quá nhiều. jQuery cũng không có sẵn, thường dùng lodash. Tự viết chỉ vài dòng
```javascript
function debounce(fn, delay = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

searchInput.addEventListener('input', debounce((event) => {
  search(event.target.value);
}, 300));
```
Throttle (chạy tối đa một lần mỗi N ms, dùng cho <mark>scroll</mark>, <mark>resize</mark>)
```javascript
function throttle(fn, limit = 100) {
  let waiting = false;
  return (...args) => {
    if (waiting) return;
    fn(...args);
    waiting = true;
    setTimeout(() => (waiting = false), limit);
  };
}

window.addEventListener('scroll', throttle(() => updateHeader(), 100));
```
Với <mark>scroll</mark> và <mark>touchmove</mark>, thêm <mark>{ passive: true }</mark> để báo trình duyệt rằng handler không gọi <mark>preventDefault</mark>, cuộn sẽ mượt hơn.

#### Custom event
Các phần của trang nói chuyện với nhau mà không cần biết nhau
```javascript
// jQuery
$(document).trigger('cart:updated', { total: 240000 });
$(document).on('cart:updated', (e, data) => console.log(data.total));

// JavaScript
document.dispatchEvent(new CustomEvent('cart:updated', { detail: { total: 240000 } }));
document.addEventListener('cart:updated', (event) => console.log(event.detail.total));
```
Dispatch trên một phần tử cụ thể và muốn cha nghe được thì thêm <mark>bubbles: true</mark>.

#### Ví dụ: giỏ hàng (tiếp)
Thêm xóa sản phẩm và chỉnh số lượng vào ví dụ ở bài 115
```html
<template id="cart-item">
  <li class="item">
    <span class="name"></span>
    <input type="number" class="qty" value="1" min="1">
    <span class="price"></span>đ
    <button class="remove" type="button">x</button>
  </li>
</template>
```
```javascript
const cart = document.querySelector('#cart');

// một listener cho mọi nút xóa, kể cả sản phẩm thêm sau
cart.addEventListener('click', (event) => {
  const button = event.target.closest('.remove');
  if (!button) return;
  button.closest('.item').remove();
  updateTotal();
});

// một listener cho mọi ô số lượng
cart.addEventListener('input', (event) => {
  if (!event.target.matches('.qty')) return;
  updateTotal();
});

function updateTotal() {
  const total = [...cart.querySelectorAll('.item')].reduce((sum, el) => {
    return sum + Number(el.dataset.price) * Number(el.querySelector('.qty').value || 1);
  }, 0);
  document.querySelector('#total').textContent = total.toLocaleString('vi-VN');
  document.dispatchEvent(new CustomEvent('cart:updated', { detail: { total } }));
}
```

#### Bảng tra nhanh

| jQuery | JavaScript |
|---|---|
| <mark>$(fn)</mark>, <mark>$(document).ready(fn)</mark> | <mark>DOMContentLoaded</mark> hoặc <mark>&lt;script defer&gt;</mark> |
| <mark>.on(type, fn)</mark>, <mark>.off()</mark> | <mark>addEventListener</mark>, <mark>removeEventListener</mark> / <mark>AbortController</mark> |
| <mark>.one()</mark> | <mark>{ once: true }</mark> |
| <mark>.on(type, selector, fn)</mark> | <mark>event.target.closest(selector)</mark> |
| <mark>.trigger()</mark> | <mark>dispatchEvent(new CustomEvent(...))</mark> |
| <mark>$(this)</mark> | <mark>event.currentTarget</mark> |
| <mark>return false</mark> | <mark>preventDefault()</mark> + <mark>stopPropagation()</mark> |
| <mark>event.which</mark> | <mark>event.key</mark> |
| <mark>.serialize()</mark> | <mark>new FormData(form)</mark>, <mark>URLSearchParams</mark> |

Bài tiếp theo: <mark>$.ajax</mark> và <mark>fetch</mark>.
