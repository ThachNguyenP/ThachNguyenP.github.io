---
layout: post
title:  "084. Overselling (Flash sale with Redis)."
date:   2026-11-03 01:14:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_084/overselling-flash-sale.png
---
Phần cuối trong series overselling. Flash sale 12h trưa: 100 chiếc iPhone giá 1 triệu, 50.000 người cùng bấm mua trong vài giây.

#### Vì sao database không chịu nổi
Với cách ở các bài trước, 50.000 request sẽ cùng <mark>UPDATE</mark> **một row duy nhất**. Database bắt chúng xếp hàng từng người một, mỗi người giữ một connection trong lúc chờ. Kết quả:
- Connection pool hết sạch, cả trang web bị treo, không chỉ trang flash sale.
- 49.900 người chắc chắn mua trượt vẫn phải chờ tới lượt để nghe câu "hết hàng".

Ý tưởng giải quyết: **chặn bớt người từ trước khi tới database**. Chỉ khoảng 100 người có cơ hội mua thật mới được đi tiếp.

#### Redis làm cổng chặn
Redis xử lý mọi lệnh **tuần tự trên một thread**, nên mỗi lệnh đều là atomic, và nhanh hơn database rất nhiều (hàng trăm nghìn lệnh mỗi giây).
```sh
bundle add redis
```
```ruby
# config/initializers/redis.rb

REDIS = Redis.new(url: ENV.fetch("REDIS_URL", "redis://localhost:6379/0"))
```
Trước giờ mở bán, đưa số lượng vào Redis
```ruby
REDIS.set("flash_sale:#{product.id}:stock", product.stock)
```

#### Trừ kho trên Redis
Cách đơn giản nhất là dùng lệnh <mark>DECR</mark>
```ruby
remaining = REDIS.decr("flash_sale:#{product.id}:stock")
if remaining < 0
  REDIS.incr("flash_sale:#{product.id}:stock") # trả lại, tránh số âm mãi
  raise OutOfStock
end
```
Nhưng nếu mỗi người được mua nhiều sản phẩm, <mark>DECR</mark> rồi <mark>INCR</mark> lại sẽ có khoảng hở. Cách chuẩn hơn là dùng **Lua script**: Redis chạy cả script như một lệnh atomic duy nhất.
```ruby
# app/services/flash_sale_stock.rb

class FlashSaleStock
  RESERVE_SCRIPT = <<~LUA
    local stock = tonumber(redis.call("GET", KEYS[1]) or "0")
    local quantity = tonumber(ARGV[1])
    if stock >= quantity then
      return redis.call("DECRBY", KEYS[1], quantity)
    end
    return -1
  LUA

  def self.reserve(product_id, quantity = 1)
    REDIS.eval(RESERVE_SCRIPT, keys: [key(product_id)], argv: [quantity]) >= 0
  end

  def self.release(product_id, quantity = 1)
    REDIS.incrby(key(product_id), quantity)
  end

  def self.key(product_id)
    "flash_sale:#{product_id}:stock"
  end
end
```
Đây chính là ý tưởng atomic update của bài 081, chỉ khác là chạy trên Redis thay vì PostgreSQL.

#### Mỗi người chỉ mua 1 lần
Flash sale thường giới hạn mỗi người một sản phẩm. Đồng thời user hay bấm nút mua liên tục vì sốt ruột. Dùng <mark>SET</mark> với option <mark>nx</mark> (chỉ set khi key chưa tồn tại) để giải quyết cả 2
```ruby
first_time = REDIS.set("flash_sale:#{product_id}:user:#{user_id}", 1, nx: true, ex: 1.day.to_i)
raise AlreadyPurchased unless first_time
```
Lần đầu trả về <mark>true</mark>, những lần sau trả về <mark>false</mark>, kể cả khi 2 request tới cùng lúc.

#### Đưa vào queue
Người qua được cổng Redis rồi cũng không nên ghi DB ngay trong request. Đẩy vào job để database xử lý theo tốc độ của nó, còn user nhận phản hồi ngay lập tức.
```ruby
# app/controllers/flash_sales_controller.rb

class FlashSalesController < ApplicationController
  rate_limit to: 10, within: 1.minute, only: :create

  def create
    product_id = params[:product_id]
    lock_key = "flash_sale:#{product_id}:user:#{current_user.id}"

    unless REDIS.set(lock_key, 1, nx: true, ex: 1.day.to_i)
      return render json: { message: "Bạn đã đặt mua sản phẩm này rồi" }, status: :conflict
    end

    unless FlashSaleStock.reserve(product_id)
      REDIS.del(lock_key)
      return render json: { message: "Sản phẩm đã hết hàng" }, status: :gone
    end

    FlashSaleOrderJob.perform_later(product_id, current_user.id)
    render json: { message: "Đang xử lý đơn hàng" }, status: :accepted
  end
end
```
```ruby
# app/jobs/flash_sale_order_job.rb

class FlashSaleOrderJob < ApplicationJob
  def perform(product_id, user_id)
    product = Product.find(product_id)
    ReserveService.call(product:, user: User.find(user_id)) # bài 083
  rescue ReserveService::OutOfStock
    FlashSaleStock.release(product_id)
    # thông báo cho user là mua trượt
  end
end
```
- 49.900 người hết lượt sẽ nhận ngay câu "hết hàng" từ Redis, database không hề biết tới họ.
- 100 người còn lại được tạo reservation trong job, rồi đi tiếp flow thanh toán của bài 083. FE có thể poll API hoặc dùng ActionCable để báo khi order đã sẵn sàng.
- <mark>rate_limit</mark>: chặn bớt những ai dùng tool spam request.

#### Database vẫn là nguồn sự thật
Redis chỉ là **cổng chặn**, không phải nơi lưu tồn kho chính thức. Trong job chúng ta vẫn dùng atomic update và check constraint của bài 081. Nếu vì lý do nào đó Redis và DB bị lệch (ví dụ Redis restart mất data), DB vẫn đảm bảo không bao giờ bán vượt. Điều tệ nhất có thể xảy ra là một vài người qua được cổng Redis rồi mới bị báo hết hàng.

Lưu ý thêm: reservation hết hạn ở bài 083 trả hàng lại DB, thì cũng nên trả lại vào Redis bằng <mark>FlashSaleStock.release</mark>, để người khác còn có cơ hội mua.

#### Tổng kết series
| Bài | Cách làm | Dùng khi |
|---|---|---|
| 081 | Atomic update + check constraint | Mặc định, luôn nên có |
| 082 | Pessimistic lock | Logic phức tạp, nhiều sản phẩm |
| 083 | Giữ hàng có thời hạn | Có bước thanh toán |
| 084 | Redis + queue | Flash sale, traffic cực lớn |

Không cần dùng hết. Phần lớn các shop chỉ cần bài 081 và 083 là đủ. Chỉ khi thật sự có flash sale mới cần tới Redis.
