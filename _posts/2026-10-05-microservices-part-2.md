---
layout: post
title:  "165. Microservices (Bài 2: Tách service, Database riêng & Saga)."
date:   2026-10-05 09:10:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_165/split-services.png
---
Bài trước có một monolith chạy ngon với một transaction bao trùm mọi thứ. Bài này tách nó thành ba service: **catalog**, **order**, **payment**, mỗi cái một process, một cổng, một database. Mục tiêu không phải "tách cho xong" mà là **nhìn thấy đúng cái giá phải trả**: transaction biến mất, và bạn sẽ thấy tồn kho bị mất thật trên terminal trước khi học cách bù lại bằng saga. Những gì bài này làm bằng tay chính là những gì các framework "microservices" lớn làm hộ bạn, và hiểu phần làm bằng tay là cách duy nhất để dùng framework đúng.

#### Kết quả cuối bài
Ba terminal, ba service:
```sh
bundle exec ruby services/catalog.rb     # Sinatra ... on 8081
bundle exec ruby services/payment.rb     # Sinatra ... on 8083
bundle exec ruby services/order/app.rb   # Sinatra ... on 8082
```
Thẻ bị từ chối, tồn kho vẫn nguyên; payment sập, tồn kho vẫn nguyên:
```sh
curl -s -X POST localhost:8082/orders -H 'Content-Type: application/json' \
  -d '{"product_id":1,"qty":1,"email":"an@example.com","card":"4000000000000002"}'
# {"error":"thẻ bị từ chối"}
curl -s localhost:8081/products/1
# {"id":1,"name":"Bàn phím cơ","price":1200000,"stock":10}
```

#### Bước 1: Vẽ ranh giới trước khi viết code
Câu hỏi đầu tiên không phải "tách thế nào" mà là "tách **ở đâu**". Quy tắc: mỗi service sở hữu **một mảng nghiệp vụ và toàn bộ dữ liệu của mảng đó**; service khác muốn dữ liệu phải hỏi qua API, không được đọc bảng. Với shop:

| Service | Sở hữu | API cung cấp |
|---|---|---|
| catalog | bảng <mark>products</mark>, tồn kho | xem sản phẩm, giữ hàng, trả hàng |
| order | bảng <mark>orders</mark> | tạo đơn, xem đơn |
| payment | giao dịch thẻ | thu tiền |

Để ý hai API mới của catalog: **giữ hàng** (reserve) và **trả hàng** (release). Trong monolith không cần "trả hàng" vì rollback làm hộ. Tách ra rồi thì mỗi hành động cần một hành động ngược, và việc **thiết kế API theo cặp thuận/nghịch** là thói quen đầu tiên phải có. Bài 095 (bounded context) nói kỹ về cách tìm ranh giới; ở đây ranh giới đã có sẵn từ cách chia module bài trước, đó là lý do tôi nhấn mạnh modular monolith.

Cấu trúc mới:
```
shop/
├── monolith.rb              # giữ lại để so sánh
├── services/
│   ├── catalog.rb           # :8081, catalog.db
│   ├── payment.rb           # :8083
│   └── order/
│       ├── app.rb           # :8082, order.db
│       ├── clients.rb       # gọi catalog và payment qua HTTP
│       └── store.rb         # bảng orders
└── lib/                     # catalog, payment, db, web dùng lại y nguyên
```
Trong thực tế mỗi service thường là một repo riêng. Tôi để chung một repo cho dễ đọc, nhưng quy tắc vẫn giữ: <mark>services/order</mark> **không được require** <mark>lib/catalog.rb</mark>. Nó chỉ biết catalog qua URL.

#### Bước 2: Catalog service
Catalog dùng lại <mark>lib/catalog.rb</mark> của bài trước không sửa một dòng, chỉ bọc HTTP quanh nó:
```ruby
# services/catalog.rb
# Catalog service: sản phẩm và tồn kho. Database riêng (catalog.db), cổng riêng (8081).
# Chạy: ruby services/catalog.rb
require "sinatra"
require_relative "../lib/db"
require_relative "../lib/web"
require_relative "../lib/catalog"

Log.service = "catalog"
set :server, :puma
set :port, ENV.fetch("PORT", 8081).to_i
set :logging, false
set :show_exceptions, :after_handler
use Web::RequestLog
helpers Web::Helpers

DBH = DB.new(ENV.fetch("DB", "catalog.db"), Catalog::SCHEMA)
Catalog.seed(DBH)

get "/products" do
  json_body 200, Catalog.list(DBH)
end

get "/products/:id" do
  json_body 200, Catalog.get(DBH, params[:id])
end

# reserve và release là hai nửa của một "transaction" trải qua nhiều service.
# reserve trừ kho, release cộng lại (reserve với qty âm).
post "/products/:id/reserve" do
  qty = read_json["qty"].to_i
  json_error 400, "qty phải > 0" if qty <= 0
  Catalog.reserve(DBH, params[:id], qty)
  json_body 200, Catalog.get(DBH, params[:id])
end

post "/products/:id/release" do
  qty = read_json["qty"].to_i
  json_error 400, "qty phải > 0" if qty <= 0
  Catalog.reserve(DBH, params[:id], -qty)
  json_body 200, Catalog.get(DBH, params[:id])
end

error Catalog::NotFound do json_error 404, env["sinatra.error"].message end
error Catalog::OutOfStock do json_error 422, env["sinatra.error"].message end
```
<mark>release</mark> chỉ là <mark>reserve</mark> với số âm: cộng lại kho. Mỗi lời gọi là một câu <mark>UPDATE</mark> nguyên tử nên hai order service (bài 5 sẽ có nhiều instance) cùng giữ món cuối thì chỉ một bên được. Cổng và tên file database đọc từ biến môi trường (<mark>PORT</mark>, <mark>DB</mark>) vì từ giờ có nhiều process cùng chạy trên một máy.

#### Bước 3: Payment service
```ruby
# services/payment.rb
# Payment service: cổng thanh toán giả. Chạy: ruby services/payment.rb
require "sinatra"
require_relative "../lib/web"
require_relative "../lib/payment"

Log.service = "payment"
set :server, :puma
set :port, ENV.fetch("PORT", 8083).to_i
set :logging, false
set :show_exceptions, :after_handler
use Web::RequestLog
helpers Web::Helpers

post "/charges" do
  input = read_json
  json_error 400, "cần card và amount > 0" if input["card"].to_s.empty? || input["amount"].to_i <= 0
  json_body 201, Payment.charge(input["card"], input["amount"].to_i)
end

error Payment::Declined do json_error 422, env["sinatra.error"].message end
```
Nhỏ đến mức buồn cười, và đó là chủ ý: payment là service **có thể viết bằng ngôn ngữ khác** nhất. Ngoài đời nó thường là một app Java đã có sẵn, hoặc là Stripe. Order service không quan tâm, nó chỉ cần <mark>POST /charges</mark> trả về JSON.

#### Bước 4: Order service
Đây là phần thay đổi nhiều nhất. Bảng <mark>orders</mark> giờ nằm một mình trong <mark>order.db</mark>:
```ruby
# services/order/store.rb
# Bảng orders của riêng order service. Không còn bảng products ở đây.
module OrderStore
  SCHEMA = <<~SQL
    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY,
      product_id INTEGER NOT NULL,
      qty        INTEGER NOT NULL,
      total      INTEGER NOT NULL,
      email      TEXT    NOT NULL,
      status     TEXT    NOT NULL,
      charge_id  TEXT
    );
  SQL

  class NotFound < StandardError; end

  def self.insert(db, order)
    db.execute(
      "INSERT INTO orders (product_id, qty, total, email, status, charge_id) VALUES (?, ?, ?, ?, ?, ?)",
      order.values_at("product_id", "qty", "total", "email", "status", "charge_id")
    )
    get(db, db.last_insert_row_id)
  end

  def self.get(db, id)
    db.get_first_row("SELECT * FROM orders WHERE id = ?", id) or raise NotFound, "không có đơn hàng"
  end
end
```

Và thay vì <mark>Catalog.get(db, id)</mark>, order gọi HTTP bằng <mark>Net::HTTP</mark> của thư viện chuẩn. Tôi viết một hàm <mark>Remote.call</mark> dùng chung rồi bọc thành hai client:
```ruby
# services/order/clients.rb
# Client HTTP tới catalog và payment. Order service chỉ biết URL của họ, không biết database của họ.
require "net/http"
require "json"

# Bọc mọi lỗi mà service bên kia trả về (4xx, 5xx).
class RemoteError < StandardError
  attr_reader :service, :status, :remote_message

  def initialize(service, status, remote_message)
    @service = service
    @status = status
    @remote_message = remote_message
    super("#{service} trả về #{status}: #{remote_message}")
  end

  # Lỗi do dữ liệu (4xx), không phải do mạng hay service sập.
  def client_error? = status < 500
end

module Remote
  # Gửi một request JSON, giải mã câu trả lời. Lỗi mạng (không kết nối được) sẽ raise lỗi của Net::HTTP.
  def self.call(service, method, url, body = nil)
    uri = URI(url)
    req = (method == :get ? Net::HTTP::Get : Net::HTTP::Post).new(uri)
    req["Content-Type"] = "application/json"
    req.body = JSON.generate(body) if body
    res = Net::HTTP.start(uri.host, uri.port) { |http| http.request(req) }
    data = JSON.parse(res.body) rescue {}
    raise RemoteError.new(service, res.code.to_i, data["error"] || res.message) if res.code.to_i >= 400

    data
  rescue SystemCallError, IOError, Net::OpenTimeout, Net::ReadTimeout => e
    raise "gọi #{service}: #{e.message}"
  end
end

class CatalogClient
  def initialize(url) = @url = url

  def get(id) = Remote.call("catalog", :get, "#{@url}/products/#{id}")
  def reserve(id, qty) = Remote.call("catalog", :post, "#{@url}/products/#{id}/reserve", { qty: qty })
  def release(id, qty) = Remote.call("catalog", :post, "#{@url}/products/#{id}/release", { qty: qty })
end

class PaymentClient
  def initialize(url) = @url = url

  def charge(card, amount) = Remote.call("payment", :post, "#{@url}/charges", { card: card, amount: amount })
end
```
Hai điều đáng chú ý. Thứ nhất, order **không dùng chung class** <mark>Product</mark> với catalog, nó chỉ nhận một Hash và lấy đúng những key cần (<mark>id</mark>, <mark>price</mark>). Nếu sau này catalog thêm field thì order không bị ảnh hưởng (bài 5 sẽ thử). Thứ hai, <mark>RemoteError</mark> giữ lại status code để phân biệt lỗi **do dữ liệu** (404 không có sản phẩm, 422 hết hàng hay thẻ hỏng) với lỗi **do hạ tầng** (mạng đứt, service sập, các exception của <mark>Net::HTTP</mark> được đổi thành <mark>RuntimeError</mark>). Hai loại này xử lý khác nhau: loại đầu trả về cho người dùng, loại sau là chuyện của bài 4.

Giờ tới <mark>create</mark>. Phiên bản đầu tiên, dịch thẳng từ monolith sang:
```ruby
# services/order/app.rb (phiên bản ngây thơ, chưa đúng)
  def create(product_id:, qty:, email:, card:)
    product = @catalog.get(product_id)
    @catalog.reserve(product["id"], qty)
    total = product["price"] * qty
    charge = @payment.charge(card, total) # lỗi ở đây thì hàng đã giữ, ai trả lại?
    OrderStore.insert(@db, "product_id" => product["id"], "qty" => qty, "total" => total,
                           "email" => email, "status" => "paid", "charge_id" => charge["id"])
  end
```
Trông giống bài trước, bỏ transaction đi. Chạy thử xem sao.

#### Bước 5: Chạy và tìm ra chỗ sai
Mở ba terminal, chạy ba service, rồi:
```sh
curl -s -X POST localhost:8082/orders -H 'Content-Type: application/json' \
  -d '{"product_id":1,"qty":2,"email":"an@example.com","card":"4242424242424242"}'
# {"id":1,"product_id":1,"qty":2,"total":2400000,"email":"an@example.com","status":"paid","charge_id":"ch_660170"}
curl -s localhost:8081/products/1
# {"id":1,"name":"Bàn phím cơ","price":1200000,"stock":8}
```
Đường vui thì giống hệt monolith. Log của catalog cho thấy order đã gọi nó hai lần, GET rồi reserve:
```
time=11:12:26.176 level=INFO msg=request service=catalog method=GET path=/products/1 status=200 ms=6
time=11:12:26.179 level=INFO msg=request service=catalog method=POST path=/products/1/reserve status=200 ms=1
```
Giờ thẻ bị từ chối:
```sh
curl -s -X POST localhost:8082/orders -H 'Content-Type: application/json' \
  -d '{"product_id":1,"qty":1,"email":"an@example.com","card":"4000000000000002"}'
# {"error":"thẻ bị từ chối"}
curl -s localhost:8081/products/1
# {"id":1,"name":"Bàn phím cơ","price":1200000,"stock":7}
```
**Mất một cái bàn phím.** Không ai mua, không ai trả tiền, nhưng kho đã trừ. Tắt payment service rồi đặt hàng lần nữa:
```sh
# {"error":"gọi payment: Failed to open TCP connection to localhost:8083 (Connection refused - connect(2) for \"localhost\" port 8083)"}
curl -s localhost:8081/products/1
# {"id":1,"name":"Bàn phím cơ","price":1200000,"stock":6}
```
Mất thêm một cái. Đây là **bài học số một của hệ phân tán**: bước 2 đã commit vào <mark>catalog.db</mark>, bước 3 lỗi, và không có <mark>ROLLBACK</mark> nào với tay được sang database của service khác. Monolith cho bạn điều này miễn phí; từ giờ bạn phải tự trả.

#### Bước 6: Saga, tức là tự viết phần "rollback"
Cách sửa có tên là **saga**: một chuỗi transaction cục bộ, mỗi bước có một **bước bù trừ** (compensating action) để hoàn tác nếu bước sau thất bại. Với tạo đơn: giữ hàng ↔ trả hàng, thu tiền ↔ hoàn tiền. Order service đóng vai **người điều phối** (orchestrator): gọi từng bước, bước nào lỗi thì gọi ngược các bước trước. Đây là file <mark>app.rb</mark> hoàn chỉnh:
```ruby
# services/order/app.rb
# Order service: tạo đơn hàng bằng cách GỌI catalog và payment qua HTTP. Chạy: ruby services/order/app.rb
require "sinatra"
require_relative "../../lib/db"
require_relative "../../lib/web"
require_relative "store"
require_relative "clients"

Log.service = "order"
set :server, :puma
set :port, ENV.fetch("PORT", 8082).to_i
set :logging, false
set :show_exceptions, :after_handler
use Web::RequestLog
helpers Web::Helpers

class Invalid < StandardError; end

class OrderService
  def initialize(db, catalog, payment)
    @db = db
    @catalog = catalog
    @payment = payment
  end

  # Không còn transaction nào bao trùm cả ba bước. Bước sau lỗi thì
  # phải TỰ hoàn tác bước trước (release), đó là ý tưởng của saga.
  def create(product_id:, qty:, email:, card:)
    raise Invalid, "thiếu qty, email hoặc card" if qty.to_i <= 0 || email.to_s.empty? || card.to_s.empty?

    product = @catalog.get(product_id)
    @catalog.reserve(product["id"], qty)
    total = product["price"] * qty
    begin
      charge = @payment.charge(card, total)
    rescue StandardError => e
      release(product["id"], qty) # bước bù trừ: trả lại hàng đã giữ
      raise e
    end
    OrderStore.insert(@db, "product_id" => product["id"], "qty" => qty, "total" => total,
                           "email" => email, "status" => "paid", "charge_id" => charge["id"])
  end

  def get(id) = OrderStore.get(@db, id)

  private

  def release(product_id, qty)
    @catalog.release(product_id, qty)
  rescue StandardError => e
    # Không bù trừ được: tồn kho đang lệch thật, phải làm cho người vận hành thấy.
    Log.error("release thất bại, tồn kho đang lệch", product: product_id, qty: qty, err: e.message)
  end
end

DBH = DB.new(ENV.fetch("DB", "order.db"), OrderStore::SCHEMA)
ORDERS = OrderService.new(
  DBH,
  CatalogClient.new(ENV.fetch("CATALOG_URL", "http://localhost:8081")),
  PaymentClient.new(ENV.fetch("PAYMENT_URL", "http://localhost:8083"))
)

post "/orders" do
  input = read_json
  order = ORDERS.create(product_id: input["product_id"], qty: input["qty"].to_i, email: input["email"], card: input["card"])
  json_body 201, order
end

get "/orders/:id" do
  json_body 200, ORDERS.get(params[:id])
end

error Invalid do json_error 400, env["sinatra.error"].message end
error OrderStore::NotFound do json_error 404, env["sinatra.error"].message end
error RemoteError do
  e = env["sinatra.error"]
  # 4xx từ service khác là lỗi dữ liệu: trả nguyên status và lời nhắn cho khách. 5xx hay lỗi mạng: 502.
  e.client_error? ? json_error(e.status, e.remote_message) : json_error(502, e.message)
end
error RuntimeError do json_error 502, env["sinatra.error"].message end
```
Hai chi tiết nhỏ nhưng quan trọng trong đoạn bù trừ:
- <mark>rescue StandardError => e</mark> quanh bước thu tiền bắt **mọi** loại lỗi (thẻ bị từ chối, mạng đứt, timeout), gọi <mark>release</mark>, rồi <mark>raise e</mark> để handler phía ngoài vẫn trả đúng status cho khách.
- Nếu chính <mark>release</mark> cũng lỗi thì chỉ ghi log mức <mark>ERROR</mark>. Lúc đó tồn kho đang lệch thật và cần người (hoặc một job đối soát) xử lý. Trong hệ phân tán, có những lỗi bạn không sửa được ngay tại chỗ, chỉ có thể **làm cho nó thấy được**.

Chạy lại với tồn kho mới:
```sh
curl -s -X POST localhost:8082/orders -H 'Content-Type: application/json' \
  -d '{"product_id":1,"qty":1,"email":"an@example.com","card":"4000000000000002"}'
# {"error":"thẻ bị từ chối"}
curl -s localhost:8081/products/1
# {"id":1,"name":"Bàn phím cơ","price":1200000,"stock":10}
```
Log catalog giờ có ba dòng cho một lần đặt hàng thất bại:
```
time=11:12:35.431 level=INFO msg=request service=catalog method=GET path=/products/1 status=200 ms=7
time=11:12:35.434 level=INFO msg=request service=catalog method=POST path=/products/1/reserve status=200 ms=1
time=11:12:35.446 level=INFO msg=request service=catalog method=POST path=/products/1/release status=200 ms=1
```
Tắt payment và thử lại: vẫn 10. Tắt luôn catalog thì order trả 502 với thông báo rõ ràng, và không có gì để bù trừ vì chưa bước nào thành công.

#### Saga chưa phải là transaction
Vẫn còn một lỗ: order service **chết** đúng giữa reserve và release (ai đó <mark>kill -9</mark>, máy mất điện, deploy đúng lúc). Hàng đã giữ, không ai trả. Hai cách vá, bạn sẽ gặp cả hai trong thực tế:
- **Giữ hàng có hạn**: reserve tạo một bản ghi có <mark>expires_at</mark>, một job định kỳ trả lại các reservation hết hạn mà không có đơn. Bài 083 làm đúng việc này cho flash sale.
- **Outbox**: ghi "việc cần làm" vào database của chính mình trong cùng transaction với đơn hàng, một tiến trình khác bảo đảm việc đó rồi sẽ được làm. Bài 3 xây cái này.

Điều cần nhớ: trong microservices, "đúng" không còn nghĩa là "đúng ngay lập tức". Nó nghĩa là **rồi sẽ đúng** (eventually consistent), và nhiệm vụ của bạn là làm cho khoảng "rồi sẽ" ngắn và có thể quan sát.

#### Cái JOIN đã mất
Còn một thứ im lặng biến mất: <mark>GET /report</mark>. Bảng <mark>products</mark> ở <mark>catalog.db</mark>, bảng <mark>orders</mark> ở <mark>order.db</mark>, không có câu SQL nào JOIN được hai file. Ba cách giải quyết, theo thứ tự nên thử:
1. **Ghép ở tầng API** (API composition): service báo cáo gọi order lấy danh sách đơn, gọi catalog lấy tên sản phẩm, ghép trong bộ nhớ. Đơn giản, chậm nếu dữ liệu lớn.
2. **Nhân bản dữ liệu qua event**: service báo cáo nghe sự kiện "đơn đã thanh toán", tự ghi bảng tổng hợp của mình. Nhanh khi đọc, phải chấp nhận trễ vài giây. Bài 3 làm cách này.
3. **Data warehouse**: đổ dữ liệu mọi service về một chỗ cho đội phân tích. Báo cáo nặng thì nên đi đường này, không nên bắt service nghiệp vụ gánh.

#### Được gì, mất gì sau bài này

| | Monolith (bài 1) | Ba service (bài này) |
|---|---|---|
| Deploy catalog | Deploy cả shop | Chỉ restart catalog, order và payment không biết |
| Ngôn ngữ của payment | Phải là Ruby | Bất kỳ, miễn nói HTTP/JSON |
| Thẻ bị từ chối | Rollback tự động | Phải tự viết release |
| Payment sập | Không có khái niệm này | 502, và phải bù trừ |
| Báo cáo | Một câu JOIN | Chưa có |
| Số process phải chạy | 1 | 3 |
| Thời gian tạo đơn | 5 ms | 24 ms (ba lời gọi mạng) |

Hai dòng đầu là lý do người ta tách. Năm dòng sau là cái giá. Bài 3, 4, 5 lần lượt trả từng khoản.

#### Mẹo và lỗi hay gặp
- Tách service đầu tiên nên là cái **ít phụ thuộc nhất** (payment, notify), không phải cái ở giữa (order). Tách cái ở giữa là sửa mọi thứ cùng lúc.
- Đừng để hai service **cùng ghi** một bảng, kể cả tạm thời. Chỉ cần một bên thêm cột <mark>NOT NULL</mark> là bên kia sập lúc nửa đêm.
- API bù trừ phải **idempotent**: gọi <mark>release</mark> hai lần (vì retry) không được cộng kho hai lần. Phiên bản ở đây chưa làm, bài tập 2 bên dưới.
- Phân biệt lỗi 4xx và 5xx từ service khác ngay ở client, như <mark>client_error?</mark>. Gom hết thành một exception là mất thông tin để quyết định có retry hay không.
- Đừng tin con số "24 ms" là nhỏ. Ba hop trên localhost là 24 ms; ba hop qua mạng thật giữa hai availability zone cộng thêm 30 - 50 ms, và một trang web gọi chuỗi 6 service thì người dùng cảm nhận được.

#### Checklist
- Ba service chạy ở 8081, 8082, 8083, ba file <mark>.db</mark> riêng.
- Đặt hàng thẻ 4242 được; thẻ 4000 bị từ chối và tồn kho **không đổi**; tắt payment, đặt hàng, tồn kho **không đổi**.
- Log của catalog có đủ ba dòng GET, reserve, release cho một lần thất bại.
- Chỉ ra được tình huống saga vẫn làm lệch kho (order chết giữa chừng).

#### Bài tập thêm
1. Thêm bước hoàn tiền: nếu <mark>OrderStore.insert</mark> lỗi sau khi đã thu tiền, gọi <mark>POST /charges/:id/refund</mark> trên payment. Bạn cần thêm route đó vào payment service.
2. Làm <mark>reserve</mark> và <mark>release</mark> idempotent: nhận thêm <mark>order_ref</mark>, lưu bảng <mark>reservations(order_ref, product_id, qty, released)</mark>, gọi lại cùng <mark>order_ref</mark> thì không trừ thêm.
3. Viết <mark>GET /report</mark> bằng cách ghép API: service mới gọi <mark>GET /orders</mark> (bạn cần thêm route liệt kê đơn) và <mark>GET /products</mark>, ghép trong bộ nhớ. So sánh với kết quả bài 1.

Mã nguồn cuối bài: [post_165.zip](/assets/code/post_165.zip)
