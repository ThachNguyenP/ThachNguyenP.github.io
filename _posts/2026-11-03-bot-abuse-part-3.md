---
layout: post
title:  "087. Bot & Abuse protection (Rack::Attack)."
date:   2026-11-03 01:18:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_087/bot-abuse-rack-attack.png
---
Rate limit là lớp phòng thủ quan trọng nhất, chặn được brute force, API abuse, email bombing, SMS pumping và một phần DDoS. Ở bài Rate limit trước đây và bài 075, chúng ta đã dùng <mark>rate_limit</mark> của Rails trong controller. Bài này dùng <mark>Rack::Attack</mark> để làm việc đó ở mức toàn app.

#### rate_limit hay Rack::Attack?
| | <mark>rate_limit</mark> của Rails | Rack::Attack |
|---|---|---|
| Khai báo ở | Từng controller | Một file cho cả app |
| Chạy lúc | Sau khi request vào tới controller | Ở middleware, trước cả router |
| Blocklist, safelist | Không | Có |
| Phù hợp | Giới hạn đơn giản cho vài action | Quản lý tập trung, nhiều quy tắc |

Hai cái có thể dùng cùng nhau. Tôi hay dùng Rack::Attack cho các quy tắc chung, còn <mark>rate_limit</mark> cho các trường hợp riêng.

#### Cài đặt
```sh
bundle add rack-attack
```
Với Rails, gem sẽ tự thêm middleware. Rack::Attack lưu bộ đếm trong <mark>Rails.cache</mark>. Production của Rails 8 dùng Solid Cache là được. Còn development mặc định dùng <mark>:null_store</mark> nên sẽ không đếm gì cả, muốn test ở local thì thêm
```ruby
# config/environments/development.rb

config.cache_store = :memory_store
```

#### Các quy tắc cơ bản
```ruby
# config/initializers/rack_attack.rb

class Rack::Attack
  # 1. Giới hạn chung: mỗi IP tối đa 300 request / 5 phút
  throttle("req/ip", limit: 300, period: 5.minutes) do |req|
    req.ip unless req.path.start_with?("/assets")
  end

  # 2. Login: theo IP
  throttle("login/ip", limit: 5, period: 20.seconds) do |req|
    req.ip if req.path == "/login" && req.post?
  end

  # 3. Login: theo email, chống brute force một tài khoản từ nhiều IP
  throttle("login/email", limit: 5, period: 1.minute) do |req|
    if req.path == "/login" && req.post?
      Rack::Attack.param(req, "email")&.downcase&.strip
    end
  end

  # 4. Quên mật khẩu: theo email nhận, chống email bombing
  throttle("password_reset/email", limit: 3, period: 1.hour) do |req|
    if req.path == "/password_resets" && req.post?
      Rack::Attack.param(req, "email")&.downcase&.strip
    end
  end

  # 5. Endpoint nặng: search, export
  throttle("search/ip", limit: 30, period: 1.minute) do |req|
    req.ip if req.path.start_with?("/search")
  end
end
```
- <mark>throttle(name, limit:, period:)</mark>: block trả về một **key** để đếm (IP, email...). Trả về <mark>nil</mark> thì request đó không bị tính.
- Đếm theo **nhiều chiều**: theo IP để chặn một máy spam nhiều tài khoản, theo email để chặn nhiều máy cùng tấn công một tài khoản.

#### Lấy param từ JSON body
Đây là chỗ hay bị sai nhất. Rack::Attack chạy **trước** khi Rails parse params, nên <mark>req.params</mark> chỉ đọc được query string và form data. Nếu FE gửi JSON thì <mark>req.params["email"]</mark> sẽ là <mark>nil</mark>, và quy tắc theo email không bao giờ chạy.

Viết một hàm nhỏ để đọc được cả 2 kiểu
```ruby
# config/initializers/rack_attack.rb

class Rack::Attack
  def self.param(req, key)
    return req.params[key] if req.params[key].present?
    return unless req.media_type == "application/json"

    body = req.body.read
    req.body.rewind # trả lại body cho Rails đọc tiếp
    JSON.parse(body)[key]
  rescue JSON::ParserError
    nil
  end
end
```

#### Response khi bị chặn
Mặc định Rack::Attack trả về text <mark>Retry later</mark>. Với API thì nên trả JSON, kèm header <mark>Retry-After</mark>
```ruby
Rack::Attack.throttled_responder = lambda do |request|
  match_data = request.env["rack.attack.match_data"]
  retry_after = match_data[:period] - (match_data[:epoch_time] % match_data[:period])

  [
    429,
    { "Content-Type" => "application/json", "Retry-After" => retry_after.to_s },
    [{ message: "Too many requests" }.to_json]
  ]
end
```

#### Blocklist và safelist
```ruby
class Rack::Attack
  # cho qua: health check, IP nội bộ
  safelist("allow internal") do |req|
    req.path == "/up" || req.ip == "127.0.0.1"
  end

  # chặn hẳn: các IP trong danh sách đen
  blocklist("block bad ips") do |req|
    Rails.cache.read("blocked_ip:#{req.ip}")
  end

  # chặn các bot dò lỗ hổng: request vào /wp-admin, /.env... trên app Rails
  blocklist("block scanners") do |req|
    Rack::Attack::Fail2Ban.filter("scanner:#{req.ip}", maxretry: 3, findtime: 10.minutes, bantime: 1.day) do
      req.path.match?(%r{/wp-admin|/wp-login|\.php|/\.env|/\.git})
    end
  end
end
```
- <mark>Fail2Ban</mark>: IP nào vi phạm 3 lần trong 10 phút sẽ bị chặn **toàn bộ** request trong 1 ngày. Rất hợp với các bot dò lỗ hổng.
- Chặn IP thủ công: <mark>Rails.cache.write("blocked_ip:1.2.3.4", true, expires_in: 1.day)</mark>.

#### Lấy đúng IP
Nếu app chạy sau load balancer, Nginx hay Cloudflare, <mark>req.ip</mark> có thể là IP của proxy, và tất cả user sẽ bị đếm chung một bộ đếm. Cần cấu hình để Rails tin tưởng proxy và đọc IP thật từ header <mark>X-Forwarded-For</mark>. Với Cloudflare thì có thể dùng header <mark>CF-Connecting-IP</mark> hoặc gem <mark>cloudflare-rails</mark>.

#### Theo dõi
Ghi log mỗi khi có request bị chặn, để biết mình đang bị tấn công kiểu gì
```ruby
# config/initializers/rack_attack.rb

ActiveSupport::Notifications.subscribe(/rack_attack/) do |_name, _start, _finish, _id, payload|
  req = payload[:request]
  next unless %i[throttle blocklist].include?(req.env["rack.attack.match_type"])

  Rails.logger.warn({
    event: "rack_attack.#{req.env['rack.attack.match_type']}",
    rule: req.env["rack.attack.matched"],
    ip: req.ip,
    path: req.path
  }.to_json)
end
```

#### Lưu ý
- Rate limit theo IP **không đủ** với bot chuyên nghiệp, chúng dùng hàng nghìn IP khác nhau (residential proxy). Luôn kết hợp đếm theo email, số điện thoại, user.
- Đặt limit vừa phải, xem log một thời gian rồi điều chỉnh. Nhiều người dùng chung một mạng công ty, quán cà phê sẽ có cùng IP.
- DDoS lớn thì Rack::Attack không gánh nổi, vì request vẫn phải vào tới server. Phần đó cần CDN/WAF như Cloudflare chặn ở bên ngoài.
