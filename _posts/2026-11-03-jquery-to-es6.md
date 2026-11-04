---
layout: post
title:  "115. Thay jQuery bằng JavaScript hiện đại (Chọn & Sửa DOM)."
date:   2026-11-03 02:08:00 +0700
author: thach
categories: [ Coding, Javascript, Front End]
image: assets/images/post_115/jquery-to-es6-dom.png
---
jQuery ra đời năm 2006 để giải quyết hai việc: trình duyệt mỗi ông một kiểu, và DOM API quá dài dòng. Gần 20 năm sau, trình duyệt đã thống nhất và chính DOM API đã học lại những gì jQuery làm hay. Phần lớn những gì bạn viết với <mark>$</mark> giờ viết được bằng JavaScript thuần, ngắn gần bằng, không cần tải thêm 30KB và không phụ thuộc vào một thư viện đang ít được cập nhật.

Series này gồm 4 bài, mỗi bài là một nhóm việc jQuery hay làm, với cách viết tương đương bằng ES6 trở lên: chọn và sửa DOM, sự kiện, gọi API, và hiệu ứng cùng các hàm tiện ích. Code chạy được trên mọi trình duyệt hiện nay (Chrome, Firefox, Safari, Edge từ khoảng 2020 trở đi).

#### Chọn phần tử
```javascript
// jQuery
const $items = $('.product .item');
const $first = $('#cart');

// JavaScript
const items = document.querySelectorAll('.product .item'); // NodeList, tất cả
const first = document.querySelector('#cart');             // phần tử đầu tiên hoặc null
```
<mark>querySelector</mark> nhận **đúng cú pháp CSS** như jQuery: <mark>'ul > li:first-child'</mark>, <mark>'[data-id="5"]'</mark>, <mark>'input:checked'</mark>. Chỉ vài selector riêng của jQuery là không có (<mark>:visible</mark>, <mark>:contains()</mark>, <mark>:eq()</mark>).

Hai khác biệt quan trọng:
- jQuery trả về một object luôn tồn tại, không tìm thấy thì rỗng và gọi method gì cũng im lặng. <mark>querySelector</mark> trả về <mark>null</mark>, gọi tiếp sẽ lỗi. Dùng optional chaining: <mark>document.querySelector('#cart')?.remove()</mark>.
- jQuery áp dụng method lên **tất cả** phần tử đã chọn. <mark>NodeList</mark> thì phải lặp.

```javascript
// jQuery
$('.item').addClass('active');

// JavaScript
document.querySelectorAll('.item').forEach(el => el.classList.add('active'));
```
Chọn **trong** một phần tử thì gọi trên phần tử đó thay vì <mark>document</mark>
```javascript
// jQuery
$form.find('input[type=text]');

// JavaScript
form.querySelectorAll('input[type=text]');
```
Nếu viết nhiều, tự định nghĩa 2 hàm ngắn, cả series sẽ dùng
```javascript
const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
```
<mark>[...nodeList]</mark> chuyển NodeList thành mảng thật, để dùng <mark>map</mark>, <mark>filter</mark>, <mark>find</mark>.

#### Đi lại trong cây DOM
```javascript
// jQuery                      // JavaScript
$el.parent()                   el.parentElement
$el.closest('.card')           el.closest('.card')
$el.children()                 el.children                 // HTMLCollection
$el.next()                     el.nextElementSibling
$el.prev()                     el.previousElementSibling
$el.is('.active')              el.matches('.active')
$el.siblings()                 [...el.parentElement.children].filter(c => c !== el)
```
<mark>closest</mark> và <mark>matches</mark> là hai method quan trọng nhất, bài 116 sẽ dùng rất nhiều cho event delegation.

#### Class và thuộc tính
```javascript
// jQuery
$el.addClass('active');
$el.removeClass('active');
$el.toggleClass('active');
$el.hasClass('active');

// JavaScript
el.classList.add('active');
el.classList.remove('active');
el.classList.toggle('active');
el.classList.contains('active');

el.classList.add('a', 'b', 'c');         // nhiều class cùng lúc
el.classList.toggle('active', isActive); // tham số 2: true thì thêm, false thì bỏ
```
Thuộc tính HTML và <mark>data-*</mark>
```javascript
// jQuery
$el.attr('href');
$el.attr('href', '/new');
$el.removeAttr('disabled');
$el.data('productId');       // <div data-product-id="5">

// JavaScript
el.getAttribute('href');
el.setAttribute('href', '/new');
el.removeAttribute('disabled');
el.dataset.productId;        // data-product-id -> dataset.productId, tự đổi sang camelCase
```
Một bẫy nhỏ: <mark>$el.data()</mark> tự chuyển <mark>"5"</mark> thành số <mark>5</mark>, còn <mark>dataset</mark> luôn trả về **chuỗi**. Cần số thì <mark>Number(el.dataset.productId)</mark>.

Với các thuộc tính chuẩn, dùng thẳng property, ngắn và đúng kiểu hơn <mark>getAttribute</mark>
```javascript
input.value          // thay vì $input.val()
checkbox.checked     // thay vì $cb.prop('checked')
button.disabled = true;
link.href            // URL đầy đủ, khác getAttribute('href') trả về đúng chuỗi trong HTML
```

#### Nội dung và style
```javascript
// jQuery
$el.text();
$el.text('Xin chào');
$el.html('<b>Xin chào</b>');
$el.css('color', 'red');
$el.css({ color: 'red', fontSize: '14px' });
$el.show(); $el.hide();

// JavaScript
el.textContent;
el.textContent = 'Xin chào';
el.innerHTML = '<b>Xin chào</b>';
el.style.color = 'red';
Object.assign(el.style, { color: 'red', fontSize: '14px' });
el.hidden = false; el.hidden = true;   // thuộc tính hidden của HTML5
```
Hai lưu ý:
- <mark>innerHTML</mark> với dữ liệu từ người dùng là lỗ hổng XSS, giống hệt <mark>$el.html()</mark>. Hiển thị text thì dùng <mark>textContent</mark>.
- Đọc style **đã tính** (từ CSS, không phải inline) thì dùng <mark>getComputedStyle(el).color</mark>. <mark>el.style</mark> chỉ thấy style inline.

<mark>el.hidden = true</mark> tương đương <mark>display: none</mark>. Nếu CSS của bạn có đặt <mark>display</mark> cho phần tử đó với độ ưu tiên cao hơn, <mark>hidden</mark> sẽ bị ghi đè; cách chắc chắn là thêm một class <mark>.is-hidden { display: none !important }</mark> và dùng <mark>classList.toggle('is-hidden')</mark>.

#### Tạo, chèn, xóa phần tử
```javascript
// jQuery
const $li = $('<li class="item">Sản phẩm</li>');
$list.append($li);
$list.prepend($li);
$el.before($li); $el.after($li);
$el.remove();
$el.empty();

// JavaScript
const li = document.createElement('li');
li.className = 'item';
li.textContent = 'Sản phẩm';
list.append(li);
list.prepend(li);
el.before(li); el.after(li);
el.remove();
el.replaceChildren();   // xóa hết con
```
<mark>append</mark>, <mark>prepend</mark>, <mark>before</mark>, <mark>after</mark>, <mark>remove</mark>, <mark>replaceWith</mark> đều là DOM API chuẩn, tên giống jQuery, và nhận nhiều tham số, cả phần tử lẫn chuỗi (chuỗi được chèn dưới dạng **text**, an toàn).

Tạo một đoạn HTML từ chuỗi, cách gần với <mark>$('<div>...</div>')</mark> nhất
```javascript
list.insertAdjacentHTML('beforeend', `<li class="item">${escapeHtml(name)}</li>`);
// vị trí: beforebegin, afterbegin, beforeend, afterend
```
Hoặc dùng thẻ <mark>&lt;template&gt;</mark> trong HTML, cách tôi thích nhất vì HTML nằm trong file HTML
```html
<template id="item-template">
  <li class="item"><span class="name"></span> <button class="remove">x</button></li>
</template>
```
```javascript
const template = document.querySelector('#item-template');
const li = template.content.cloneNode(true);
li.querySelector('.name').textContent = name;   // gán text, không lo XSS
list.append(li);
```

#### Lặp và lọc
```javascript
// jQuery
$('.item').each(function (i, el) { console.log(i, $(this).text()); });
$('.item').filter('.active');
$('.item').first(); $('.item').eq(2);

// JavaScript
$$('.item').forEach((el, i) => console.log(i, el.textContent));
$$('.item').filter(el => el.matches('.active'));
$$('.item')[0]; $$('.item')[2]; // hoặc $('.item:nth-child(3)')
```
Vì đã có mảng, mọi hàm quen thuộc đều dùng được: <mark>map</mark> để lấy danh sách giá trị, <mark>find</mark> để lấy phần tử đầu tiên thỏa điều kiện, <mark>some</mark>/<mark>every</mark> để kiểm tra.
```javascript
const ids = $$('input[name="ids[]"]:checked').map(cb => Number(cb.value));
```

#### Ví dụ: giỏ hàng
Ghép lại thành một đoạn thực tế: thêm sản phẩm vào danh sách và cập nhật tổng
```html
<ul id="cart"></ul>
<p>Tổng: <span id="total">0</span>đ</p>
<template id="cart-item">
  <li class="item"><span class="name"></span> - <span class="price"></span>đ</li>
</template>
```
```javascript
const $ = (s, scope = document) => scope.querySelector(s);
const $$ = (s, scope = document) => [...scope.querySelectorAll(s)];

function addToCart({ id, name, price }) {
  const li = $('#cart-item').content.cloneNode(true);
  const item = li.querySelector('.item');
  item.dataset.id = id;
  item.dataset.price = price;
  $('.name', item).textContent = name;
  $('.price', item).textContent = price.toLocaleString('vi-VN');
  $('#cart').append(li);
  updateTotal();
}

function updateTotal() {
  const total = $$('#cart .item').reduce((sum, el) => sum + Number(el.dataset.price), 0);
  $('#total').textContent = total.toLocaleString('vi-VN');
}

addToCart({ id: 1, name: 'Ốp lưng', price: 150000 });
addToCart({ id: 2, name: 'Cáp sạc', price: 90000 });
// #total => "240.000"
```
Không có <mark>$</mark> của jQuery, nhưng đọc vẫn gọn như vậy.

#### Bảng tra nhanh

| jQuery | JavaScript |
|---|---|
| <mark>$(sel)</mark> | <mark>document.querySelector(sel)</mark> / <mark>querySelectorAll(sel)</mark> |
| <mark>.find(sel)</mark> | <mark>el.querySelectorAll(sel)</mark> |
| <mark>.closest(sel)</mark>, <mark>.is(sel)</mark> | <mark>el.closest(sel)</mark>, <mark>el.matches(sel)</mark> |
| <mark>.addClass/removeClass/toggleClass/hasClass</mark> | <mark>el.classList.add/remove/toggle/contains</mark> |
| <mark>.attr()</mark>, <mark>.data()</mark> | <mark>getAttribute/setAttribute</mark>, <mark>el.dataset</mark> |
| <mark>.val()</mark>, <mark>.prop()</mark> | <mark>el.value</mark>, <mark>el.checked</mark>, <mark>el.disabled</mark> |
| <mark>.text()</mark>, <mark>.html()</mark> | <mark>el.textContent</mark>, <mark>el.innerHTML</mark> |
| <mark>.css()</mark> | <mark>el.style.x</mark>, <mark>getComputedStyle(el)</mark> |
| <mark>.show()/.hide()</mark> | <mark>el.hidden</mark> hoặc class |
| <mark>.append/prepend/before/after/remove</mark> | Cùng tên |
| <mark>$('<li>...</li>')</mark> | <mark>createElement</mark>, <mark>insertAdjacentHTML</mark>, <mark>&lt;template&gt;</mark> |
| <mark>.each()</mark> | <mark>forEach</mark> trên NodeList hoặc mảng |

Bài tiếp theo: sự kiện, phần mà jQuery từng làm tốt nhất, và cách <mark>addEventListener</mark> hiện nay làm được tất cả những thứ đó.
