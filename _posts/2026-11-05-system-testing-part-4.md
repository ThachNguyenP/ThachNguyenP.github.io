---
layout: post
title:  "172. Kiểm thử hệ thống (Bài 4: Kiểm thử bảo mật cho app của chính mình)."
date:   2026-11-05 10:30:00 +0700
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_172/security-test.png
---
"Pentest" thường được hiểu là thuê một công ty bên ngoài làm một lần mỗi năm. Việc đó có giá trị, nhưng phần lớn lỗ hổng trong web app thuộc một danh sách ngắn, lặp đi lặp lại, và **tự kiểm tra được bằng test như mọi test khác**: header phòng thủ, cờ của cookie, escape dữ liệu người dùng, phân quyền trên dữ liệu, CSRF, chống đoán mật khẩu, thư viện có lỗ hổng đã công bố. Bài này viết chúng thành spec hộp đen (chạy cho Ruby, Go, NestJS như bài 2), chạy lên shop, **đỏ 8 trên 11**, sửa từng cái, rồi chạy lên bản Go để thấy danh sách việc cần làm cho một bản cài đặt mới. Cuối bài là audit thư viện, và nó tìm ra hai CVE thật trong Puma tôi đang dùng.

Phạm vi: đây là kiểm thử bảo mật cho **hệ thống của chính bạn**, chạy trong CI của bạn. Quét hệ thống của người khác khi chưa được phép là bất hợp pháp ở hầu hết nơi.

#### Bộ test
```ruby
# spec/system/security_spec.rb
# Kiểm thử bảo mật cho CHÍNH app của mình, qua HTTP như mọi system test khác. Mỗi test là một yêu cầu
# mà bất kỳ bản cài đặt nào (Ruby, Go, NestJS) cũng phải đạt; test đỏ nghĩa là có việc phải sửa.
require_relative "system_helper"

RSpec.describe "Bảo mật" do
  describe "header phòng thủ" do
    before { client.get("/") }

    it "chặn đoán kiểu nội dung (nosniff)" do
      expect(client.last["x-content-type-options"]).to eq("nosniff")
    end

    it "không cho site khác nhúng vào iframe" do
      expect(client.last["x-frame-options"]).to match(/DENY|SAMEORIGIN/i)
    end

    it "có Content-Security-Policy" do
      expect(client.last["content-security-policy"]).to include("default-src")
    end

    it "không rò URL nội bộ qua Referer" do
      expect(client.last["referrer-policy"]).not_to be_nil
    end
  end

  describe "cookie phiên đăng nhập" do
    it "có HttpOnly và SameSite" do
      login("an@example.com", "an-pass-123")
      cookie = client.last.get_fields("set-cookie").join("; ")
      expect(cookie.downcase).to include("httponly")
      expect(cookie.downcase).to include("samesite=lax").or include("samesite=strict")
    end
  end

  describe "dữ liệu người dùng nhập vào" do
    it "được escape khi hiển thị lại (ô tìm kiếm)" do
      client.get("/?q=#{URI.encode_www_form_component('<b>abc</b>')}")
      expect(client.last.body).not_to include("<b>abc</b>")                     # không được in thô
      expect(client.last.body).to include("&lt;b&gt;abc&lt;/b&gt;") if client.last.body.include?("abc")
    end

    it "tham số next khi đăng nhập không đưa người dùng sang site khác" do
      login("an@example.com", "an-pass-123", next: "//example.org/")
      location = client.last["location"].to_s
      expect(location).not_to include("example.org")
    end

    it "không cho tự phong admin khi đăng ký" do
      client.get("/register")
      client.submit("/register", email: "t#{SecureRandom.hex(4)}@example.com", password: "mat-khau-moi", role: "admin")
      client.get("/admin/orders")
      expect(client.last.code).to eq("403")
    end
  end

  describe "phân quyền trên dữ liệu" do
    it "khách này không xem được đơn của khách khác" do
      register
      buy(3, 1)
      order_path = URI(client.last["location"]).path

      other = Client.new
      register(client: other)
      other.get(order_path)
      expect(other.last.code).to eq("404").or eq("403")
    end
  end

  describe "CSRF" do
    it "POST tạo đơn từ form không có token bị từ chối" do
      register
      client.post("/orders", product_id: 3, qty: 1)   # Client này không gửi token
      expect(client.last.code).to eq("403")
    end
  end

  describe "đoán mật khẩu" do
    it "sau nhiều lần sai liên tiếp thì bị chặn tạm thời (429)" do
      email = register
      codes = 8.times.map { |i| login(email, "sai-#{i}", client: Client.new).code }
      expect(codes).to include("429")
      expect(login(email, "mat-khau-moi", client: Client.new).code).to eq("429")   # đúng mật khẩu cũng phải chờ
    end
  end
end
```

Mỗi <mark>describe</mark> là một yêu cầu, và yêu cầu nào cũng diễn đạt được bằng HTTP:

| Yêu cầu | Lỗ hổng nếu thiếu | Cách test |
|---|---|---|
| <mark>X-Content-Type-Options: nosniff</mark>, <mark>X-Frame-Options</mark>, <mark>Content-Security-Policy</mark>, <mark>Referrer-Policy</mark> | Trình duyệt đoán kiểu file, clickjacking, script lạ, rò URL nội bộ | Đọc header của một trang |
| Cookie phiên có <mark>HttpOnly</mark> và <mark>SameSite</mark> | JavaScript đọc được cookie; cookie bị gửi kèm request từ site khác | Đọc <mark>Set-Cookie</mark> sau khi đăng nhập |
| Dữ liệu người dùng được escape khi hiển thị | XSS lưu trữ hoặc phản xạ | Gửi <mark>&lt;b&gt;abc&lt;/b&gt;</mark> vào ô tìm kiếm, body không được chứa thẻ thô |
| Tham số <mark>next</mark> chỉ nhận đường dẫn nội bộ | Open redirect (link đăng nhập "thật" đưa sang site lừa đảo) | Đăng nhập với <mark>next=//example.org/</mark> |
| Không tự phong quyền khi đăng ký | Mass assignment | Gửi thêm <mark>role=admin</mark>, rồi thử vào trang admin |
| Khách chỉ xem được đơn của mình | IDOR (đổi số trong URL là xem đơn người khác) | Hai client, một mua, một xem URL của người kia |
| POST phải có token | CSRF | POST không kèm token phải bị 403 |
| Nhiều lần sai mật khẩu bị chặn tạm | Đoán mật khẩu không giới hạn | 8 lần sai liên tiếp, phải thấy 429 |

Để test CSRF được, <mark>Client</mark> của bài 2 học thêm một việc: nhớ token trong form vừa GET và gửi kèm khi <mark>submit</mark>. Các helper <mark>register</mark>, <mark>login</mark>, <mark>buy</mark> đều GET trang form trước rồi mới submit, đúng như người dùng:

```ruby
# spec/system/system_helper.rb (một phần)
class Client
  attr_reader :last, :token

  # Gửi form như trình duyệt: kèm token lấy từ trang form đã GET trước đó (nếu trang có).
  def submit(path, form = {})
    post(path, token ? form.merge(authenticity_token: token) : form)
  end

  private

  def request(req)
    ...
    @token = @last.body[/name="authenticity_token" value="([^"]+)"/, 1] if req.is_a?(Net::HTTP::Get) && @last.body
    ...
  end
end

module SystemHelpers
  def register(password: "mat-khau-moi", client: self.client)
    email = "t#{SecureRandom.hex(4)}@example.com"
    client.get("/register")
    client.submit("/register", email: email, password: password)
    expect(client.last).to be_a(Net::HTTPRedirection)
    email
  end

  def login(email, password, client: self.client, **extra)
    client.get("/login")
    client.submit("/login", { email: email, password: password }.merge(extra))
  end

  # Mua hàng như người dùng: mở trang sản phẩm (có form) rồi bấm Mua.
  def buy(product_id, qty, client: self.client)
    client.get("/products/#{product_id}")
    client.submit("/orders", product_id: product_id, qty: qty)
  end
end
```

Test CSRF thì cố tình dùng <mark>post</mark> thô, không token. Với hệ thống không có token (như bản Go hiện tại), <mark>token</mark> là <mark>nil</mark> và <mark>submit</mark> hành xử như <mark>post</mark>, nên các test khác vẫn chạy.

#### Chạy lên shop: 8 trên 11 đỏ
```sh
$ BASE_URL=http://localhost:8080 bundle exec rspec spec/system/security_spec.rb
Bảo mật
  header phòng thủ
    chặn đoán kiểu nội dung (nosniff)
    không cho site khác nhúng vào iframe
    có Content-Security-Policy (FAILED - 1)
    không rò URL nội bộ qua Referer (FAILED - 2)
  cookie phiên đăng nhập
    có HttpOnly và SameSite (FAILED - 3)
  dữ liệu người dùng nhập vào
    được escape khi hiển thị lại (ô tìm kiếm) (FAILED - 4)
    tham số next khi đăng nhập không đưa người dùng sang site khác (FAILED - 5)
    không cho tự phong admin khi đăng ký
  phân quyền trên dữ liệu
    khách này không xem được đơn của khách khác (FAILED - 6)
  CSRF
    POST tạo đơn từ form không có token bị từ chối (FAILED - 7)
  đoán mật khẩu
    sau nhiều lần sai liên tiếp thì bị chặn tạm thời (429) (FAILED - 8)

Failures:
  4) ... được escape khi hiển thị lại
       expected "...<p>Kết quả cho \"<b>abc</b>\": 0 sản phẩm</p>..." not to include "<b>abc</b>"
  5) ... tham số next
       expected "http://localhost:8080//example.org/" not to include "example.org"
  6) ... khách này không xem được đơn của khách khác
       expected: "404"   got: "200"
  7) ... POST tạo đơn từ form không có token bị từ chối
       expected: "403"   got: "303"
  8) ... sau nhiều lần sai liên tiếp thì bị chặn tạm thời (429)
       expected ["401", "401", "401", "401", "401", "401", "401", "401"] to include "429"

11 examples, 8 failures
```

Ba cái qua là nhờ Sinatra bật sẵn <mark>Rack::Protection</mark> (nosniff, frame options) và nhờ route đăng ký không đọc <mark>params[:role]</mark>. Tám cái còn lại là tám lỗi thật trong một app "viết nhanh cho xong", và không cái nào hiếm.

#### Sửa
Phần lớn nằm ở đầu <mark>app.rb</mark>:

```ruby
# app.rb (một phần)
set :erb, escape_html: true                 # mọi <%= %> đều được escape; chỗ nào cố ý in HTML thì dùng <%== %>
set :sessions, httponly: true, same_site: :lax, expire_after: 86_400
set :session_secret, ENV.fetch("SESSION_SECRET") { "dev-secret-" * 8 }
use Rack::Protection::AuthenticityToken     # mọi request không phải GET phải kèm token của form
use Rack::Protection::ContentSecurityPolicy, default_src: "'self'", style_src: "'self' 'unsafe-inline'"
use Rack::Protection::ReferrerPolicy
```

- **Escape**: Sinatra không escape ERB mặc định. <mark>escape_html: true</mark> cần engine **Erubi** (thêm <mark>gem "erubi"</mark>; thiếu nó Tilt dùng ERB chuẩn và lặng lẽ bỏ qua tùy chọn này, tôi mất 10 phút vì chuyện đó), và layout phải đổi <mark>&lt;%= yield %&gt;</mark> thành <mark>&lt;%== yield %&gt;</mark> nếu không cả trang bị escape.
- **CSRF**: <mark>AuthenticityToken</mark> từ chối mọi POST không có token khớp session. Form thêm một input ẩn:

```erb
<!-- views/product.erb -->
<h1><%= @product["name"] %></h1>
<p>Giá: <strong><%= money(@product["price"]) %></strong>, còn <%= @product["stock"] %> cái</p>
<form method="post" action="/orders">
  <input type="hidden" name="authenticity_token" value="<%= csrf_token %>">
  <input type="hidden" name="product_id" value="<%= @product["id"] %>">
  <label>Số lượng <input type="number" name="qty" value="1" min="1"></label>
  <button>Mua</button>
</form>
```

- **Open redirect**: <mark>"//example.org"</mark> bắt đầu bằng "/" nên qua được kiểm tra cũ. Đường dẫn nội bộ là bắt đầu bằng "/" **và không** bắt đầu bằng "//":

```ruby
# app.rb (một phần)
  def csrf_token = Rack::Protection::AuthenticityToken.token(session)

  # Chỉ nhận đường dẫn nội bộ: "/orders" được, "//example.org" (protocol-relative) hay "https://..." thì không.
  def safe_path(p) = p.to_s.start_with?("/") && !p.to_s.start_with?("//") ? p : "/"
```

- **IDOR**: route xem đơn chỉ kiểm tra "đã đăng nhập", không kiểm tra "đơn của ai". Trả 404 chứ không 403, để không xác nhận là đơn đó tồn tại:

```ruby
# lib/shop.rb (một phần)
    # Khách chỉ thấy đơn của mình; admin thấy tất cả. Trả 404 (không phải 403) để không lộ việc đơn đó tồn tại.
    def self.get_for_user(id, user)
      order = get(id)
      raise NotFound, "không có đơn #{id}" unless user["role"] == "admin" || order["user_id"] == user["id"]
      order
    end
```

- **Chống đoán mật khẩu**: đếm số lần sai theo email trong bộ nhớ; 5 lần sai trong 10 phút thì từ chối **kể cả khi nhập đúng**, vì mục tiêu là làm việc thử hàng nghìn mật khẩu trở nên vô ích:

```ruby
# lib/login_guard.rb
# Chặn đoán mật khẩu: sau LIMIT lần sai liên tiếp với một email, từ chối mọi lần đăng nhập email đó trong WINDOW giây.
# Đếm trong bộ nhớ của process: đủ cho một instance. Nhiều instance thì chuyển sang Redis (INCR + EXPIRE), logic y hệt.
module LoginGuard
  LIMIT = 5
  WINDOW = 600

  @fails = Hash.new { |h, k| h[k] = [] }
  @mutex = Mutex.new

  def self.blocked?(email) = recent(email).size >= LIMIT

  def self.fail!(email)
    @mutex.synchronize { @fails[email] << Time.now }
  end

  def self.clear(email)
    @mutex.synchronize { @fails.delete(email) }
  end

  def self.recent(email)
    @mutex.synchronize do
      @fails[email].select! { |t| t > Time.now - WINDOW }
      @fails[email].dup
    end
  end
end
```

```ruby
# app.rb (một phần)
post "/login" do
  email = params[:email].to_s
  halt 429, erb(:login, locals: { login_error: "Sai quá nhiều lần, thử lại sau 10 phút" }) if LoginGuard.blocked?(email)
  user = Shop::Users.authenticate(email, params[:password])
  unless user
    LoginGuard.fail!(email)
    halt 401, erb(:login, locals: { login_error: "Sai email hoặc mật khẩu" })
  end
  LoginGuard.clear(email)
  session[:user_id] = user["id"]
  redirect safe_path(params[:next])
end
```

Chạy lại cả bộ system test, gồm 17 test của bài 2 (để chắc là sửa bảo mật không làm hỏng nghiệp vụ, chuyện rất hay xảy ra với CSRF) và 11 test mới:

```sh
$ BASE_URL=http://localhost:8080 bundle exec rspec spec/system
...
28 examples, 0 failures

$ curl -s -D - -o /dev/null localhost:8080/ | grep -iE "^(x-|content-security|referrer)"
referrer-policy: strict-origin-when-cross-origin
content-security-policy: default-src 'self'; style-src 'self' 'unsafe-inline'
x-xss-protection: 1; mode=block
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
$ curl -s -D - -o /dev/null -d "email=an@example.com&password=an-pass-123" localhost:8080/login | grep -i set-cookie
set-cookie: rack.session=...; path=/; expires=Fri, 06 Nov 2026 10:00:18 GMT; httponly; samesite=lax
```

Một unit test hộp trắng cho phần duy nhất không nhìn thấy từ ngoài, mật khẩu phải được băm:

```ruby
# spec/unit/users_spec.rb
# Unit test bảo mật (hộp trắng, chỉ cho bản Ruby): mật khẩu phải được băm, không lưu thô.
require_relative "../spec_helper"

RSpec.describe Shop::Users do
  it "lưu mật khẩu dưới dạng bcrypt, không lưu mật khẩu thô" do
    create_user(email: "an@example.com", password: "an-pass-123")
    digest = Shop.db.get_first_value("SELECT password_digest FROM users WHERE email = 'an@example.com'")
    expect(digest).to start_with("$2a$")
    expect(digest).not_to include("an-pass-123")
  end

  it "xác thực đúng và sai mật khẩu" do
    create_user(email: "an@example.com", password: "an-pass-123")
    expect(described_class.authenticate("an@example.com", "an-pass-123")).to include("email" => "an@example.com")
    expect(described_class.authenticate("an@example.com", "an-pass-124")).to be_nil
  end
end
```

#### Cùng bộ test lên bản Go
```sh
$ BASE_URL=http://localhost:8090 bundle exec rspec spec/system/security_spec.rb
    chặn đoán kiểu nội dung (nosniff) (FAILED - 1)
    không cho site khác nhúng vào iframe (FAILED - 2)
    có Content-Security-Policy (FAILED - 3)
    không rò URL nội bộ qua Referer (FAILED - 4)
    có HttpOnly và SameSite (FAILED - 5)
    khách này không xem được đơn của khách khác (FAILED - 6)
    POST tạo đơn từ form không có token bị từ chối (FAILED - 7)
    sau nhiều lần sai liên tiếp thì bị chặn tạm thời (429) (FAILED - 8)
11 examples, 8 failures
```

Bản Go qua 17 test nghiệp vụ ở bài 2 và trượt 8 test bảo mật, trong đó 4 cái bản Ruby được Sinatra lo hộ (nosniff, frame options, cookie HttpOnly, escape của <mark>html/template</mark> nếu có dùng). Đây là điểm của test hộp đen: **nó là danh sách việc cần làm cho bất kỳ bản cài đặt nào**, viết một lần. Với NestJS, danh sách tương ứng là <mark>helmet</mark> (header), <mark>cookie-session</mark> với <mark>httpOnly/sameSite</mark>, <mark>csurf</mark> hoặc double-submit cookie, guard kiểm tra chủ sở hữu, <mark>@nestjs/throttler</mark> cho đăng nhập. Với Go: <mark>html/template</mark> (escape sẵn), <mark>gorilla/csrf</mark>, tự đặt header trong middleware. Việc sửa bản Go để xanh 11/11 là bài tập cuối bài.

#### Audit thư viện và phân tích tĩnh
Test ở trên nhìn hành vi. Loại lỗ hổng thứ hai nằm trong **thư viện bạn không viết**, chỉ bắt được bằng cách đối chiếu <mark>Gemfile.lock</mark> với cơ sở dữ liệu lỗ hổng đã công bố:

```sh
$ bundle-audit check --update
Name: puma
Version: 6.6.1
CVE: CVE-2026-47736
Criticality: High
Title: Puma PROXY Protocol v1 Parser Allows Remote Memory Exhaustion
Solution: update to '~> 7.2.1', '>= 8.0.2'
Name: puma
Version: 6.6.1
CVE: CVE-2026-47737
Criticality: High
Title: Puma PROXY Protocol v1 Accepts Repeated Protocol Headers on Persistent Connections
Solution: update to '~> 7.2.1', '>= 8.0.2'
Vulnerabilities found!
```

Hai CVE mức High trong web server tôi dùng suốt ba bài. Sửa là một dòng trong Gemfile và chạy lại cả bộ test để chắc Puma 7 không đổi gì:

```sh
$ sed -i '' 's/gem "puma", "~> 6.5"/gem "puma", "~> 7.2"/' Gemfile && bundle update puma
$ bundle-audit check
No vulnerabilities found
$ BASE_URL=http://localhost:8080 bundle exec rspec spec/system
28 examples, 0 failures
```

Tương đương: <mark>npm audit</mark> cho NestJS, <mark>govulncheck ./...</mark> cho Go. Đặt vào CI, chạy mỗi ngày (cơ sở dữ liệu lỗ hổng thay đổi dù code không đổi), và coi "High" là build đỏ.

Lớp thứ ba là **phân tích tĩnh**: đọc code tìm mẫu nguy hiểm (SQL nối chuỗi, <mark>html_safe</mark> bừa bãi, mass assignment). Với Rails là <mark>brakeman</mark>, rất đáng dùng; với Sinatra nó không hiểu nên bài này không chạy. Go có <mark>gosec</mark> (và <mark>go vet</mark> cho lỗi thường), NestJS có <mark>eslint-plugin-security</mark>; <mark>semgrep</mark> chạy cho mọi ngôn ngữ. Chúng nhiều cảnh báo giả hơn test hành vi, nhưng rẻ và bắt được thứ test hộp đen không thấy.

```sh
$ cd twin-go && go vet ./...
go vet: không có cảnh báo
```

#### Mẹo và lỗi hay gặp
- Thứ tự ưu tiên khi thời gian ít: **audit thư viện** (5 phút, bắt lỗ hổng đã có exploit công khai), rồi **IDOR và CSRF** (hai lỗi nghiệp vụ hay bị bỏ sót nhất), rồi header và cookie.
- Test escape chỉ kiểm tra **một** chỗ in dữ liệu người dùng. Bật escape mặc định ở engine template (Erubi, <mark>html/template</mark>, mọi framework hiện đại) quan trọng hơn viết test cho từng ô.
- Chặn đoán mật khẩu theo **email** chứ không chỉ theo IP: kẻ tấn công có nhiều IP, nhưng nạn nhân chỉ có một email. Và nhớ cho phép reset mật khẩu, vì giờ chính chủ cũng bị khóa 10 phút.
- Khi bật CSRF, hãy chạy lại **toàn bộ** test nghiệp vụ: mọi form, mọi script gọi POST (kể cả <mark>bin/load.rb</mark> ở bài 3) đều cần token hoặc cần một cơ chế khác cho API (header <mark>Authorization</mark> thay vì cookie).
- CSP với <mark>'unsafe-inline'</mark> cho style là nhượng bộ vì layout có thẻ <mark>&lt;style&gt;</mark>. Chuyển CSS ra file là bỏ được nó. Không bao giờ cho <mark>'unsafe-inline'</mark> ở <mark>script-src</mark>.
- Nếu muốn quét tự động từ ngoài (OWASP ZAP, nuclei): chạy lên **staging của bạn**, trong CI, với tài khoản test. Nó tìm được header thiếu và vài mẫu phổ biến, nhưng không hiểu nghiệp vụ; IDOR và phân quyền vẫn phải là test bạn tự viết.

#### Checklist
- Nêu được 8 yêu cầu trong bảng và lỗ hổng tương ứng khi thiếu.
- Bộ security spec: trước 8/11 đỏ, sau 11/11 xanh; 28/28 cả bộ system test.
- <mark>bundle-audit</mark> sạch và chạy trong CI.
- Giải thích được vì sao chặn đoán mật khẩu phải chặn cả lần nhập đúng, và vì sao IDOR trả 404 thay vì 403.

#### Bài tập thêm
1. Sửa <mark>twin-go/main.go</mark> cho qua 11/11 test bảo mật (gợi ý: một middleware đặt header, <mark>html/template</mark>, cookie <mark>HttpOnly: true, SameSite: http.SameSiteLaxMode</mark>, token CSRF lưu trong session, map đếm lần sai).
2. Thêm test: tài khoản khách không gọi được <mark>GET /admin/orders</mark> **kể cả khi** gửi header <mark>X-Role: admin</mark> hay cookie giả. Rồi thêm test cho API: <mark>/api/products</mark> không được trả trường nào ngoài 4 trường công khai (cost, supplier...).
3. Đặt <mark>bundle-audit</mark> (hoặc <mark>npm audit</mark>, <mark>govulncheck</mark>) vào một workflow chạy mỗi ngày với <mark>schedule</mark>, gửi thông báo khi đỏ.

Mã nguồn cuối bài: [post_172.zip](/assets/code/post_172.zip)
