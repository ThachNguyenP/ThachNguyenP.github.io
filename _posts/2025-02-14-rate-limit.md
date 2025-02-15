---
layout: post
title:  "024.Rate limit trong rails."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_024/rate_limit.svg
---
#### 1. Với rails phiên bản mới
Hiện tại **rails** phiên bản từ **7.2** đã tích hợp sẵn nên các bạn chỉ cần dùng thông qua hàm <mark>rate_limit</mark> trong controller.
```ruby
class HelloWorldController < ApplicationController
  rate_limit to: 5, within: 1.minute
end
```
Cách sử dụng tương tự như một **before_action**, không thể đơn giản hơn.
Nhưng khi các bạn chạy thử dưới môi trường **development** thì sẽ chưa thấy nó hoạt động đâu. Chúng ta cần phải kích hoạt cache lên.

```sh
rails dev:cache
# or in config/environments/development.rb
config.action_controller.perform_caching = true
```
Cuối cùng là thử xem nó hoạt động chưa nhé.
```sh
for i in {1..7};
do curl -I http://localhost:3000/hello_world;
done
```
Chỉ có 5 request đầu thành công trả về **200 OK**, còn 2 request sau thì sẽ trả về **429 Too Many Requests**. Vậy là chúng ta đã giới hạn tần suất request thành công :tada:

Check qua một số ví dụ khác của **rate_limit**
```ruby
# filter by action
rate_limit to: 5, within: 1.minute, only: :create
# limit by domain instead of IP
rate_limit to: 5, within: 1.minute, by: -> { request.domain }, only: :created
# Add after_action for rate limiting
rate_limit to: 5,
           within: 1.minute,
           with: -> { redirect_to(ip_restrictions_controller_url),
           alert: "Signup Attempts failed four times. Please try again later." },
           only: :create
```

#### 2. Với rails phiên bản cũ
Dùng gem thôi, <mark>rack-attack</mark> cũng là một gem nổi tiếng. Gem hỗ trợ bạn 4 tính năng theo đúng thứ tự ưu tiên từ trên xuống.
- **safelist**: nếu request khớp với điều kiện của safelist, nó sẽ được pass.
- **blocklist**: nếu request khớp với điều kiện của blocklist, nó sẽ bị block.
- **throttle**: kiểm tra tần suất truy cập, nếu chạm giới giạn, request sẽ bị block (rate limit)
- **tracks**: request được pass, và có thể được đánh dấu lại để kiểm soát về sau.

```ruby
# Gemfile
gem 'rack-attack'
```
Safe list thường được sử dụng để allow các IP của công ty bạn, hoặc là các IP của các dịch vụ bên thứ 3.
```ruby
# config/initializers/rack-attack.rb

class Rack::Attack
  # Get the IP addresses of stripe as an array
  stripe_ips_webhooks = Net::HTTP.get(URI('https://stripe.com/files/ips/ips_webhooks.txt')).split("\n")
  # Allow those IP addresses to send us as many webhooks as they like
  safelist('allow from Stripe (To Webhooks)') do |req|
    req.base_url == "https://webhooks.example.com" && req.post? && stripe_ips_webhooks.include?(req.ip)
  end
end
```
Block list thì có 2 cách, một là block hẳn luôn, hoặc là block tạm thời, thông qua <mark>Allow2Ban</mark> và <mark>Fail2Ban</mark>.

Ở những endpoint như login, là nơi các hacker sẽ liên tục gửi request để cố tìm ra password của bạn, thì sử dụng <mark>Allow2Ban</mark> sẽ tạm thời chặn IP đó lại trong 1 khoảng thời gian.

Còn với <mark>Fail2Ban</mark>, các bạn sẽ dùng với các endpoint nơi mà người dùng thực sự không dùng tới, hoặc nghi vấn là bot.

```ruby
# config/initializers/rack-attack.rb

class Rack::Attack
  bad_ips = ['31.13.114.65', '204.15.20.0']
  blocklist "block known bad IP address" do |req|
    bad_ips.include?(req.ip) # Block these IPs

    # The count for the IP is incremented if the return value is truthy.
    Allow2Ban.filter(req.ip, maxretry: 5, findtime: 1.minute, bantime: 1.hour) do
      (req.path == '/users/sessions' && req.post?)
    end

    # The count for the IP is incremented if the return value is truthy
    Fail2Ban.filter("pentesters-#{req.ip}", maxretry: 3, findtime: 10.minutes, bantime: 30.minutes) do
      CGI.unescape(req.query_string) =~ %r{/etc/passwd} ||
        req.path.include?('/etc/passwd') ||
        req.path.include?('wp-admin') ||
        req.path.include?('wp-login')
    end
  end
end
```
Tiếp theo là ví dụ về **throttle** aka **rate limit**, biết đâu bạn lại có chức năng như là giới hạn user chỉ được tạo 10 bài viết trong 1 ngày.
```ruby
# config/initializers/rack-attack.rb

Rack::Attack.throttle("expensive-endpoint/posts", limit: 10, period: 1.days) do |req|
  "posts-endpoint" if req.path.include?('/posts') && req.post?
end
```
Cuối cùng là **tracks**, có thể là khi user vượt ngưỡng limit nào đó, bạn chưa muốn block họ ngay, mà chỉ là đánh dấu lại tài khoản của họ, trong lúc chờ có kế hoạch tiếp theo của mình.

```ruby
# config/initializers/rack-attack.rb

# Track requests from a special user agent.
Rack::Attack.track("special_agent") do |req|
  req.user_agent == "SpecialAgent"
end

# Supports optional limit and period, triggers the notification only when the limit is reached.
Rack::Attack.track("special_agent", limit: 6, period: 60) do |req|
  req.user_agent == "SpecialAgent"
end

# Track it using ActiveSupport::Notification
ActiveSupport::Notifications.subscribe("track.rack_attack") do |name, start, finish, instrumenter_id, payload|
  req = payload[:request]
  if req.env['rack.attack.matched'] == "special_agent"
    Rails.logger.info "special_agent: #{req.path}"
    STATSD.increment("special_agent")
  end
end
```

#### 2.5. Unblock một IP
Gỡ block tất cả
```ruby
# Clears all the Redis store
Rack::Attack.cache.store.flushdb
# Clears all the Rack::Attack Keys
Rack::Attack.reset!
```
Gỡ block một IP trực tiếp từ Redis
```sh
$ redis-cli -u redis://127.0.0.1:6379/1 # Replace this with your REDIS_URL from Heroku
$ keys *
# 1) "rack::attack:26990977:req/ip/comments-tries:1.2.3.4"
$ 127.0.0.1:6379[1]> keys *1.2.3.4:*
# 1) "rack::attack:26990977:req/ip/comments-tries:1.2.3.4"
$ 127.0.0.1:6379[1]> del rack::attack:26990977:req/ip/comments-tries:1.2.3.4
# (integer) 1
```
Bài viết tham khảo rất nhiều từ [wafris](https://wafris.org/guides/ultimate-guide-to-rack-attack)
