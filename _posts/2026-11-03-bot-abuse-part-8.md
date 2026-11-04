---
layout: post
title:  "092. Bot & Abuse protection (Web scraping & IDOR)."
date:   2026-11-03 01:23:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_092/bot-abuse-scraping.png
---
Bài này về 2 vấn đề liên quan tới việc dữ liệu bị lấy ra ngoài: **web scraping** (lấy dữ liệu công khai với số lượng lớn) và **IDOR** (lấy được dữ liệu không phải của mình).

#### Web scraping
Đối thủ dùng bot lấy toàn bộ giá sản phẩm mỗi giờ để bán rẻ hơn. Trang tin tức bị copy bài ngay sau khi đăng. Dữ liệu user công khai bị gom lại để bán. Ngày nay còn có thêm các bot thu thập dữ liệu để train AI.

Cần nói trước: dữ liệu đã **công khai** thì không thể chặn scraping hoàn toàn. Người thật xem được thì bot cũng xem được. Mục tiêu là làm cho việc scrape **chậm, tốn kém và dễ bị phát hiện**.

**1. Rate limit và giới hạn page size**
Rack::Attack ở bài 087 là lớp đầu tiên. Ngoài ra, đừng để API trả về quá nhiều dữ liệu trong một lần
```ruby
# app/controllers/products_controller.rb

MAX_PER_PAGE = 50

def index
  per_page = params[:per_page].to_i.clamp(1, MAX_PER_PAGE)
  products = Product.page(params[:page]).per(per_page)
  # ...
end
```
Không có giới hạn thì chỉ cần gọi <mark>?per_page=1000000</mark> là lấy được cả database trong một request.

**2. Không dùng ID tăng dần ở URL**
Với <mark>/products/1</mark>, <mark>/products/2</mark>... bot chỉ cần một vòng lặp là lấy được tất cả, và đối thủ còn biết được mình có bao nhiêu sản phẩm, bao nhiêu đơn hàng mỗi ngày. Dùng một chuỗi ngẫu nhiên thay thế
```ruby
# app/models/product.rb

class Product < ApplicationRecord
  has_secure_token :public_id, length: 24

  def to_param = public_id
end
```
```ruby
# app/controllers/products_controller.rb

def show
  product = Product.find_by!(public_id: params[:id])
  # ...
end
```
<mark>id</mark> vẫn được dùng bên trong cho foreign key, chỉ có <mark>public_id</mark> được đưa ra ngoài. Cách khác là dùng UUID làm primary key ngay từ đầu.

**3. Chỉ trả về những gì cần thiết**
Đây là lỗi rất phổ biến: API trả về cả object user, gồm email, số điện thoại, ngày sinh, trong khi FE chỉ hiển thị tên và avatar. Dùng serializer hoặc Entity (bài 013) để chỉ expose những field thật sự cần. Thông tin chi tiết thì bắt buộc đăng nhập mới xem được.

**4. Honeypot link**
Đặt một link ẩn mà người thật không nhìn thấy, nhưng bot scrape thì sẽ đi theo. Ai vào link đó thì gần như chắc chắn là bot.
```erb
<a href="/catalog/archive" style="display: none" rel="nofollow">Archive</a>
```
```ruby
# config/routes.rb
get "/catalog/archive", to: "traps#show"

# app/controllers/traps_controller.rb
class TrapsController < ApplicationController
  def show
    Rails.cache.write("blocked_ip:#{request.remote_ip}", true, expires_in: 1.day)
    head :not_found
  end
end
```
Nhớ thêm đường dẫn này vào <mark>robots.txt</mark> với <mark>Disallow</mark>, để Google và các bot đàng hoàng không đi vào và bị chặn nhầm. Blocklist ở bài 087 sẽ chặn các IP này.

**5. robots.txt và điều khoản sử dụng**
<mark>robots.txt</mark> chỉ là lời đề nghị, bot xấu sẽ không tuân theo. Nhưng nó giúp chặn các bot đàng hoàng, ví dụ các bot thu thập dữ liệu AI
```sh
# public/robots.txt

User-agent: GPTBot
Disallow: /

User-agent: CCBot
Disallow: /
```
Cùng với điều khoản sử dụng cấm scraping, đây là cơ sở pháp lý nếu sau này cần xử lý.

Với các app lớn, các dịch vụ như Cloudflare Bot Management phát hiện bot tốt hơn nhiều so với tự làm.

#### IDOR
**IDOR** (Insecure Direct Object Reference) là lỗi bảo mật cực kỳ phổ biến, và rất dễ mắc. Ví dụ
```ruby
# ❌ Sai
def show
  order = Order.find(params[:id])
  render json: order
end
```
User A đăng nhập, gọi <mark>GET /orders/124</mark>, và xem được order của user B. Không cần hack gì, chỉ cần đổi số trên URL.

Cách sửa đơn giản nhất là **luôn tìm trong phạm vi của user hiện tại**
```ruby
# ✅ Đúng
def show
  order = current_user.orders.find(params[:id])
  render json: order
end
```
Order không phải của user hiện tại sẽ raise <mark>ActiveRecord::RecordNotFound</mark> và trả về 404. Trả về 404 thay vì 403 để không lộ ra là order đó có tồn tại.

Với logic phức tạp hơn (admin, quản lý, thành viên của team...), dùng Pundit hoặc CanCanCan như ở các bài trước. Quan trọng nhất là **mọi action** đều phải kiểm tra quyền. Với Pundit, thêm <mark>after_action :verify_authorized</mark> để Rails báo lỗi nếu có action nào quên gọi <mark>authorize</mark>.

Dùng <mark>public_id</mark> như phần trên cũng giúp IDOR khó khai thác hơn, nhưng **không thay thế** việc kiểm tra quyền.

#### Mass assignment
Một lỗi họ hàng với IDOR: cho phép user sửa những field không được phép.
```ruby
# ❌ Sai: user gửi thêm "role": "admin" là thành admin
params.require(:user).permit!

# ✅ Đúng: chỉ permit những field user được sửa
params.require(:user).permit(:name, :avatar)
```
Tương tự, đừng bao giờ permit <mark>user_id</mark> khi tạo record. Hãy gán từ <mark>current_user</mark>: <mark>current_user.orders.create(order_params)</mark>.

#### Tóm tắt

| Vấn đề | Biện pháp |
|---|---|
| Scraping | Rate limit, giới hạn page size, public_id, chỉ trả field cần thiết, honeypot link |
| IDOR | <mark>current_user.orders.find</mark>, Pundit / CanCanCan |
| Mass assignment | Strong params, không permit field nhạy cảm |
