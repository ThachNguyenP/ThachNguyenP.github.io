---
layout: post
title:  "117. Thay jQuery bằng JavaScript hiện đại (Gọi API với fetch)."
date:   2026-11-03 02:12:00 +0700
author: thach
categories: [ Coding, Javascript, Front End]
image: assets/images/post_117/jquery-to-es6-fetch.png
---
<mark>$.ajax</mark>, <mark>$.get</mark>, <mark>$.post</mark> là lý do nhiều dự án vẫn giữ jQuery. <mark>fetch</mark> có trong mọi trình duyệt từ lâu và kết hợp với <mark>async/await</mark> (bài 044) thì còn dễ đọc hơn. Bài này đi qua các trường hợp hay gặp, đặc biệt là những chỗ <mark>fetch</mark> hành xử **khác** <mark>$.ajax</mark> và gây bug nếu không biết.

#### GET và JSON
```javascript
// jQuery
$.getJSON('/api/products', function (data) {
  render(data);
});

// JavaScript
const response = await fetch('/api/products');
const data = await response.json();
render(data);
```
<mark>await</mark> dùng được ở top-level trong <mark>&lt;script type="module"&gt;</mark>, còn lại phải nằm trong hàm <mark>async</mark>.

Truyền tham số query, thay cho <mark>$.get(url, { q: 'iphone', page: 2 })</mark>
```javascript
const params = new URLSearchParams({ q: 'iphone', page: 2 });
const response = await fetch(`/api/products?${params}`);  // /api/products?q=iphone&page=2
```
<mark>URLSearchParams</mark> tự encode (khoảng trắng, dấu tiếng Việt, ký tự đặc biệt), đừng tự ghép chuỗi.

#### Khác biệt lớn nhất: lỗi HTTP không reject
Với <mark>$.ajax</mark>, response 404 hay 500 chạy vào <mark>error</mark>. Với <mark>fetch</mark>, **chỉ lỗi mạng** mới reject (mất kết nối, CORS, timeout). Server trả về 500 thì promise vẫn **resolve** bình thường, và nếu cứ <mark>.json()</mark> rồi render thì sẽ hiện ra dữ liệu lỗi. Phải tự kiểm tra <mark>response.ok</mark> (status 200 - 299)
```javascript
const response = await fetch('/api/products');
if (!response.ok) {
  throw new Error(`HTTP ${response.status}`);
}
const data = await response.json();
```
Vì chỗ nào cũng phải viết vậy, nên gói lại thành một hàm dùng chung, xem ở cuối bài.

#### POST JSON
```javascript
// jQuery
$.ajax({
  url: '/api/orders',
  method: 'POST',
  contentType: 'application/json',
  data: JSON.stringify({ productId: 5, quantity: 2 }),
  success: (order) => console.log(order.id),
});

// JavaScript
const response = await fetch('/api/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ productId: 5, quantity: 2 }),
});
const order = await response.json();
```
Ba thứ hay quên: <mark>method</mark> (mặc định GET), <mark>Content-Type</mark> (không tự thêm như jQuery), và <mark>JSON.stringify</mark> (body phải là chuỗi, FormData hoặc Blob).

#### Gửi form và file
```javascript
// jQuery, với file phải thêm processData: false, contentType: false
$.ajax({ url: '/api/avatar', method: 'POST', data: new FormData(form), processData: false, contentType: false });

// JavaScript
await fetch('/api/avatar', { method: 'POST', body: new FormData(form) });
```
Truyền <mark>FormData</mark> làm <mark>body</mark>, trình duyệt tự đặt <mark>Content-Type: multipart/form-data</mark> kèm boundary. **Đừng** tự đặt header này, sẽ hỏng. Gửi dạng <mark>application/x-www-form-urlencoded</mark> như form truyền thống thì <mark>body: new URLSearchParams(new FormData(form))</mark>.

#### Header, cookie và CSRF với Rails
jQuery (qua <mark>jquery_ujs</mark> hoặc <mark>rails-ujs</mark>) từng tự gắn CSRF token vào mọi request. Với <mark>fetch</mark> phải tự làm
```javascript
const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

await fetch('/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-CSRF-Token': csrfToken,
  },
  body: JSON.stringify({ order: { product_id: 5 } }),
});
```
<mark>Accept: application/json</mark> để Rails chạy vào <mark>format.json</mark> trong <mark>respond_to</mark>. Cookie (session) được gửi tự động với request cùng domain; gọi sang domain khác và cần cookie thì thêm <mark>credentials: 'include'</mark>.

#### Hủy và timeout
<mark>$.ajax</mark> có <mark>timeout</mark> và <mark>xhr.abort()</mark>. <mark>fetch</mark> dùng <mark>AbortController</mark> (bài 116 đã gặp)
```javascript
const response = await fetch('/api/products', { signal: AbortSignal.timeout(5000) }); // hủy sau 5s
```
Hủy request cũ khi gõ tiếp trong ô tìm kiếm, tránh kết quả cũ về sau đè lên kết quả mới
```javascript
let controller;

async function search(q) {
  controller?.abort();                 // hủy request trước nếu còn chạy
  controller = new AbortController();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    render(await response.json());
  } catch (error) {
    if (error.name === 'AbortError') return;  // bị hủy chủ động, không phải lỗi
    showError(error);
  }
}
```

#### Gọi nhiều request
```javascript
// jQuery
$.when($.get('/api/user'), $.get('/api/cart')).done((userRes, cartRes) => ...);

// JavaScript
const [user, cart] = await Promise.all([
  fetch('/api/user').then(r => r.json()),
  fetch('/api/cart').then(r => r.json()),
]);
```
<mark>Promise.all</mark> fail nếu **một** request fail. Muốn lấy được những cái thành công thì dùng <mark>Promise.allSettled</mark>.

Các request **phụ thuộc** nhau thì <mark>await</mark> tuần tự, đừng lồng callback
```javascript
const user = await api.get('/api/user');
const orders = await api.get(`/api/users/${user.id}/orders`);
```

#### Hàm api dùng chung
Gom tất cả những điều trên vào một module nhỏ, thay cho <mark>$.ajaxSetup</mark>
```javascript
// app/javascript/api.js

const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content;

export class ApiError extends Error {
  constructor(response, body) {
    super(`HTTP ${response.status}`);
    this.status = response.status;
    this.body = body;   // ví dụ { errors: { email: ["đã tồn tại"] } } từ Rails
  }
}

async function request(method, url, { body, params, timeout = 10000 } = {}) {
  const query = params ? `?${new URLSearchParams(params)}` : '';
  const isForm = body instanceof FormData;

  const response = await fetch(url + query, {
    method,
    headers: {
      'Accept': 'application/json',
      'X-CSRF-Token': csrfToken(),
      ...(body && !isForm ? { 'Content-Type': 'application/json' } : {}),
    },
    body: isForm ? body : body && JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });

  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(response, data);
  return data;
}

export const api = {
  get: (url, params) => request('GET', url, { params }),
  post: (url, body) => request('POST', url, { body }),
  patch: (url, body) => request('PATCH', url, { body }),
  delete: (url) => request('DELETE', url),
};
```
Sử dụng
```javascript
import { api, ApiError } from './api';

try {
  const order = await api.post('/orders', { order: { product_id: 5, quantity: 2 } });
  showToast(`Đã tạo đơn #${order.id}`);
} catch (error) {
  if (error instanceof ApiError && error.status === 422) {
    showErrors(error.body.errors);     // lỗi validation từ Rails
  } else {
    showToast('Có lỗi xảy ra, thử lại sau');
    console.error(error);
  }
}
```
Ngắn hơn <mark>$.ajax</mark>, và mọi quy ước (CSRF, JSON, timeout, xử lý lỗi) nằm ở một chỗ.

#### Ví dụ: giỏ hàng (tiếp)
Nút "Thêm vào giỏ" trên trang sản phẩm gọi API rồi cập nhật giao diện
```javascript
document.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-add-to-cart]');
  if (!button) return;

  button.disabled = true;
  try {
    const item = await api.post('/cart_items', { product_id: button.dataset.productId });
    addToCart(item);                 // hàm ở bài 115
  } catch (error) {
    showToast(error instanceof ApiError && error.status === 409 ? 'Hết hàng rồi' : 'Có lỗi xảy ra');
  } finally {
    button.disabled = false;
  }
});
```

#### Bảng tra nhanh

| jQuery | JavaScript |
|---|---|
| <mark>$.get(url, params)</mark> | <mark>fetch(url + '?' + new URLSearchParams(params))</mark> |
| <mark>$.getJSON</mark> | <mark>(await fetch(url)).json()</mark> |
| <mark>$.post(url, data)</mark> | <mark>fetch(url, { method: 'POST', body })</mark> |
| <mark>contentType: 'application/json'</mark> | <mark>headers: { 'Content-Type': 'application/json' }</mark> + <mark>JSON.stringify</mark> |
| <mark>processData: false, contentType: false</mark> | Chỉ cần <mark>body: formData</mark> |
| <mark>error:</mark> cho 4xx/5xx | Tự kiểm tra <mark>response.ok</mark> |
| <mark>timeout</mark>, <mark>xhr.abort()</mark> | <mark>AbortSignal.timeout()</mark>, <mark>AbortController</mark> |
| <mark>$.when()</mark> | <mark>Promise.all()</mark> |
| <mark>$.ajaxSetup()</mark> | Module <mark>api.js</mark> dùng chung |

Bài cuối: hiệu ứng (<mark>fadeIn</mark>, <mark>slideDown</mark>, <mark>animate</mark>), các hàm tiện ích (<mark>$.each</mark>, <mark>$.extend</mark>), và kế hoạch gỡ jQuery khỏi một dự án đang chạy.
