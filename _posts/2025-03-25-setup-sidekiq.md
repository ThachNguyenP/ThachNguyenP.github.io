---
layout: post
title:  "025.Setup Rails sidekiq."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_025/sidekiq.jpg
---
Rails 8 đã ra, tích hợp sẵn Solid Quece để xử lý background job, và thậm chí có thể sử dụng Postgres để lưu trữ hàng đợi. Trong lúc chờ xem phản ứng của cộng đồng, hãy cùng xem qua Sidekiq + Redis, một combo kinh điển để xử lý background job cho các Rails dev.

#### 1. Install redis
Cái này dễ, với Ubuntu, bạn chỉ cần
```sh
sudo apt update
sudo apt install redis-server
```

Sau đó sửa file cấu hình của redis
sudo nano /etc/redis/redis.conf

```sh
# /etc/redis/redis.conf

# If you run Redis from upstart or systemd, Redis can interact with your
# supervision tree. Options:
#   supervised no      - no supervision interaction
#   supervised upstart - signal upstart by putting Redis into SIGSTOP mode
#   supervised systemd - signal systemd by writing READY=1 to $NOTIFY_SOCKET
#   supervised auto    - detect upstart or systemd method based on
#                        UPSTART_JOB or NOTIFY_SOCKET environment variables
# Note: these supervision methods only signal "process is ready."
#       They do not enable continuous liveness pings back to your supervisor.
supervised systemd
```
Giờ thì bạn có thể bật redis lên thông qua systemd
```sh
sudo systemctl restart redis.service
```

Còn với Mac, thì hãy dùng Homebrew
```sh
brew install redis
redis-server
```

#### 2. Setup sidekiq
Add gem vào Gemfile
```ruby
gem 'sidekiq-cron'
```

```ruby
# config/initializers/sidekiq.rb

require 'sidekiq'
require 'sidekiq-cron'
require 'sidekiq/web'
require 'sidekiq/cron/web'

Sidekiq::Web.use ActionDispatch::Cookies
Sidekiq::Web.use ActionDispatch::Session::CookieStore, key: "_interslice_session"
Sidekiq.strict_args!(false)

Sidekiq::Web.use(Rack::Auth::Basic) do |user, password|
  [user, password] == [ENV['SIDEKIQ_ADMIN'], ENV['SIDEKIQ_PASSWORD']]
end

Sidekiq.configure_client do |config|
  config.logger.level = Rails.logger.level # Logger::DEBUG / 0 : log everything

  config.redis = {
    :url => ENV["REDIS_URI"] || "redis://127.0.0.1:6379/1"
  }
end
Sidekiq.configure_server do |config|
  config.logger.level = Rails.logger.level # Logger::DEBUG / 0 : log everything

  config.redis = {
    :url => ENV["REDIS_URI"] || "redis://127.0.0.1:6379/1"
  }
end
```

```ruby
# sidekiq.yml

:pidfile: ./tmp/pids/sidekiq.pid
:logfile: ./log/sidekiq.log
max_retries: 5
:concurrency: 5
staging:
  :concurrency: 10
production:
  :concurrency: 15
:queues:
  - critical
  - default
  - low
```
```ruby
# config/environments/development.rb

config.active_job.queue_adapter = :sidekiq
config.action_mailer.perform_deliveries = true
config.action_mailer.deliver_later_queue_name = 'mailers'
```
Sau cùng là khởi động **sidekiq**
```sh
bundle exec sidekiq -C config/sidekiq.yml
```
#### 2.2. Setup sidekiq web
```ruby
# config/routes.rb

mount Sidekiq::Web, at: "/sidekiq"
```

Nếu bạn sử dụng Rails api, thì bạn cần thêm các dòng sau

```ruby
#config/application.rb

# This configures session_options for sidekiq-web if you are using api_only: true
config.session_store :cookie_store, key: '_interslice_session'
config.middleware.use config.session_store
```

Khởi động lại app Rails, chúng ta cũng có thêm một page để quản lý sidekiq ở địa chỉ **http://localhost:3000/sidekiq**. Đã được thêm basic authen với các biến môi trường **SIDEKIQ_ADMIN** và **SIDEKIQ_PASSWORD**

![Sidekiq]({{site.baseurl}}/assets/images/post_025/sidekiq-web.png)

#### 3. Write your first task
Ở những phiên bản cũ thì Sidekiq sẽ dùng <mark>worker</mark>, hiện tại đã đổi thành <mark>job</mark>.
```ruby
# app/sidekiq/mock_job.rb

class MockJob
  include Sidekiq::Job
  sidekiq_options queue: :default, retry: 5

  def perform
    Rails.logger.info 'Mock job working! --------------'
  end
end
```
#### 4. Cron tab task
```yaml
# config/schedule.yml

demo_mock_job:
  name: 'Mock job - every 5min',
  namespace: 'Mock',
  cron: "*/5 * * * *"
  class: "MockJob"
```
Để chạy định kì thì các bạn khai báo job trong file <mark>config/schedule.yml</mark>, đây là đường dẫn mặc định, các bạn có thể đổi lại, nhưng theo tôi là không cần. Thay vào đó, các bạn nên xem qua [crontab.guru](https://crontab.guru/) nếu chưa biết cách đặt thời gian chạy.

#### 5. Ứng dụng
Có 2 cách sử dụng job là **dynamic** và **scheduled**. Với **dynamic** thì các bạn sử dụng thông qua các hàm perform.

```ruby
MockJob.perform_async
# Thực hiện sau 5 phút
MockJob.perform_in(5.minutes)
MockJob.perform_at(5.minutes.from_now)

# Hoặc là có tham số
MockJob.perform_async('Foo', 3)
MockJob.perform_in(5.minutes, 'Foo', 3)
MockJob.perform_at(5.minutes.from_now, 'Foo', 3)

# Dùng với mail, vì chúng ta cũng đã chuyển mail quece sang sidekiq
Notifier.welcome(User.first).deliver_later
Notifier.welcome(User.first).deliver_later(wait: 1.hour)
Notifier.welcome(User.first).deliver_later(wait_until: 10.hours.from_now)
Notifier.welcome(User.first).deliver_later(priority: 10)
```

Một số hàm cho **scheduled** job
```ruby
Sidekiq::Cron::Job.count
Sidekiq::Cron::Job.count 'Mock'
Sidekiq::Cron::Job.all
Sidekiq::Cron::Job.all 'Mock'
Sidekiq::Cron::Job.all '*'
Sidekiq::Cron::Job.find "Mock job - every 5min"
Sidekiq::Cron::Job.find name: "Mock job - every 5min"

job = Sidekiq::Cron::Job.find('Mock job - every 5min', 'Mock').first
job.destroy

Sidekiq::Cron::Job.create(name: 'Mock job - every 5min', cron: '*/5 * * * *', class: 'MockJob')
Sidekiq::Cron::Job.create(name: 'Mock job - every 5min', cron: '*/5 * * * *', class: 'MockJob', args: 'Foo')
```
#### 6. Handle error
Theo mặc định thì sẽ có 25 lần retry nếu job fail. Và khoảng cách thực hiện các job này sẽ theo fibonanci, tức là sau 3s, 5s, 8s, 13s ...v.v.v... Tối đa là 21 ngày. Sau đó Sidekiq sẽ gọi vào hàm **sidekiq_retries_exhausted**, nếu như có define.

```ruby
# app/sidekiq/mock_job.rb

class MockJob
  include Sidekiq::Job
  sidekiq_options queue: :default, retry: 5

   sidekiq_retries_exhausted do |job, ex|
    Sidekiq.logger.warn "Failed #{job['class']} with #{job['args']}: #{job['error_message']}"
  end

  def perform
    Rails.logger.info 'Mock job working! --------------'
  end
end
```
Các bạn có thể sử dụng **sidekiq_retries_exhausted** để tracking lại error, phục vụ cho việc sữa lỗi. Nếu mà các job của bạn đều chỉ thực hiện một thao tác giống nhau, các bạn có thể dùng một callback tổng như ở dưới đây.

```ruby
# this goes in your initializer
Sidekiq.configure_server do |config|

  # ...
  config.death_handlers << ->(job, ex) do
    puts "Uh oh, #{job['class']} #{job["jid"]} just died with error #{ex.message}."
  end
end
```
