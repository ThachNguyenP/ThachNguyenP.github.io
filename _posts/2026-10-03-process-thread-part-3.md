---
layout: post
title:  "102. Process & Thread (Thread safety)."
date:   2026-10-03 01:42:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_102/process-thread-safety.png
---
Thread dùng chung bộ nhớ, và Ruby có thể chuyển sang thread khác ở bất kỳ đâu. Kết hợp 2 điều đó lại sẽ có **race condition**: kết quả phụ thuộc vào việc thread nào chạy trước, và mỗi lần chạy có thể ra một kết quả khác.

#### Race condition
Một tài khoản có 100k, 20 thread cùng rút 10k
```ruby
# race.rb

class Account
  attr_reader :balance

  def initialize(balance) = @balance = balance

  def withdraw(amount)
    return false if @balance < amount

    sleep 0.01 # giả lập xử lý: ghi log, gọi API...
    @balance -= amount
    true
  end
end

account = Account.new(100)
threads = 20.times.map { Thread.new { account.withdraw(10) } }

p threads.map(&:value).count(true) # => 20
p account.balance                  # => -100
```
20 lần rút thành công, tài khoản **âm 100k**. Chuyện gì đã xảy ra:
1. Thread 1 kiểm tra <mark>@balance < amount</mark>: 100 đủ, đi tiếp, rồi <mark>sleep</mark> (nhả GVL).
2. Thread 2, 3, ... 20 lần lượt kiểm tra, ai cũng thấy 100, ai cũng đi tiếp.
3. Sau đó cả 20 thread cùng trừ tiền.

Đây là kiểu **check-then-act**: kiểm tra một điều kiện, rồi hành động dựa trên điều kiện đó, nhưng giữa 2 bước thì dữ liệu đã bị thread khác thay đổi. Giống hệt bài toán overselling (bài 081), chỉ khác là lần này nằm trong bộ nhớ thay vì database.

<mark>sleep</mark> chỉ để lỗi xảy ra 100%. Bỏ đi thì lỗi xuất hiện ít hơn, nhưng **vẫn có thể xảy ra**, và đó mới là điều đáng sợ: test pass, lên production thỉnh thoảng sai, không tái hiện được.

Thêm một ví dụ: <mark>count += 1</mark> thực ra là 3 bước: đọc <mark>count</mark>, cộng 1, ghi lại. Trên CRuby, nhờ GVL nên thường không sai, nhưng Ruby **không đảm bảo** điều đó, và chạy trên JRuby là sai ngay.

#### Mutex
**Mutex** (mutual exclusion) là cái khóa: tại một thời điểm chỉ một thread được chạy đoạn code bên trong <mark>synchronize</mark>, các thread khác phải chờ.
```ruby
class Account
  def initialize(balance)
    @balance = balance
    @lock = Mutex.new
  end

  def withdraw(amount)
    @lock.synchronize do
      return false if @balance < amount

      sleep 0.01
      @balance -= amount
      true
    end
  end
end
```
```
10
0
```
Đúng 10 lần thành công, số dư về 0.

Vài lưu ý khi dùng Mutex:
- **Khóa càng ít càng tốt**: chỉ bọc đoạn đọc/ghi dữ liệu chung. Bọc cả lời gọi HTTP 2 giây vào trong thì các thread khác phải chờ 2 giây, mất hết ý nghĩa của thread.
- **Deadlock**: thread A giữ khóa 1, chờ khóa 2. Thread B giữ khóa 2, chờ khóa 1. Cả 2 chờ nhau mãi mãi. Tránh bằng cách luôn lấy các khóa theo **cùng một thứ tự**, hoặc tốt nhất là đừng giữ nhiều khóa cùng lúc.
- Mutex của Ruby **không reentrant**: gọi <mark>synchronize</mark> lồng nhau trên cùng một mutex sẽ raise <mark>ThreadError: deadlock; recursive locking</mark>. Cần lồng nhau thì dùng <mark>Monitor</mark>.
- Mutex chỉ có tác dụng **trong một process**. Puma chạy 4 worker là 4 process, mỗi process một Mutex riêng. Dữ liệu dùng chung giữa các process (database, Redis) phải dùng lock của database (bài 082) hoặc Redis.

#### Queue
Cách tốt nhất để tránh lỗi khi chia sẻ dữ liệu là... **không chia sẻ**. Thay vào đó, các thread gửi dữ liệu cho nhau qua <mark>Queue</mark>, một hàng đợi đã thread-safe sẵn.

Mô hình producer/consumer: một bên bỏ việc vào queue, nhiều worker lấy ra làm
```ruby
# queue.rb

queue = Queue.new

workers = 3.times.map do |i|
  Thread.new do
    while (job = queue.pop) # chờ tới khi có việc, trả về nil khi queue đã close
      puts "worker #{i}: #{job}"
    end
  end
end

10.times { |j| queue << "job #{j}" }
queue.close        # báo không còn việc nữa
workers.each(&:join)
```
<mark>queue.pop</mark> sẽ **chờ** nếu queue rỗng, nên worker không tốn CPU khi rảnh. Nếu producer nhanh hơn consumer, dùng <mark>SizedQueue.new(100)</mark>: khi đầy, producer phải chờ, tránh tràn bộ nhớ.

Đây chính là cách Sidekiq, Puma hoạt động bên trong: một queue công việc và một nhóm thread lấy ra xử lý.

#### Thread pool với concurrent-ruby
Tạo thread mới cho mỗi việc rất lãng phí, và 10.000 việc mà tạo 10.000 thread thì máy chịu không nổi. **Thread pool** giữ cố định một số thread, tái sử dụng chúng. Gem <mark>concurrent-ruby</mark> (Rails đã cài sẵn) có đủ thứ cần thiết
```ruby
require "concurrent"
require "net/http"

urls = 100.times.map { |i| URI("https://api.example.com/items/#{i}") }

pool = Concurrent::FixedThreadPool.new(10)

futures = urls.map do |url|
  Concurrent::Promises.future_on(pool, url) { |u| Net::HTTP.get(u) }
end

results = Concurrent::Promises.zip(*futures).value! # chờ tất cả, raise nếu có lỗi
pool.shutdown
```
100 request, tối đa 10 request cùng lúc.

Một số class thread-safe hay dùng khác của concurrent-ruby:

| Class | Dùng để |
|---|---|
| <mark>Concurrent::AtomicFixnum</mark> | Bộ đếm: <mark>counter.increment</mark> |
| <mark>Concurrent::Map</mark> | Hash thread-safe, có <mark>compute_if_absent</mark> |
| <mark>Concurrent::Array</mark>, <mark>Concurrent::Hash</mark> | Array/Hash có khóa sẵn |

#### Code Rails cần cẩn thận ở đâu
Trong Rails, mỗi request chạy trên một thread, và các thread chạy song song. Những chỗ hay gây lỗi:

**Biến class và biến global**: dùng chung cho mọi thread, tức mọi request.
```ruby
# SAI: user của request này lộ sang request khác
class ApplicationController < ActionController::Base
  before_action { @@current_user = User.find(session[:user_id]) }
end
```
Thay vào đó, dùng <mark>ActiveSupport::CurrentAttributes</mark>, mỗi request một giá trị riêng và tự reset sau request
```ruby
# app/models/current.rb

class Current < ActiveSupport::CurrentAttributes
  attribute :user
end

# controller
before_action { Current.user = User.find(session[:user_id]) }
```

**Memoize ở class level**:
```ruby
class Setting
  def self.all_cached
    @all_cached ||= load_from_db # 2 thread có thể cùng load
  end
end
```
Nếu load 2 lần cũng không sao thì có thể chấp nhận. Nếu không, dùng Mutex hoặc load sẵn lúc boot trong initializer.

**Hằng số bị sửa**: <mark>CONFIG = {}</mark> rồi <mark>CONFIG[:x] = ...</mark> trong request. Thêm <mark>.freeze</mark> cho hằng số để phát hiện sớm.

Quy tắc chung, theo thứ tự ưu tiên:
1. **Không chia sẻ**: biến local, object tạo mới trong mỗi request.
2. **Chia sẻ dữ liệu không đổi**: <mark>freeze</mark>.
3. **Truyền qua Queue** thay vì ghi chung.
4. Thật sự phải ghi chung thì dùng **Mutex** hoặc class của concurrent-ruby.

#### Tóm tắt
- **Race condition** xảy ra khi nhiều thread cùng đọc/ghi một dữ liệu, đặc biệt kiểu check-then-act.
- **Mutex** để khóa, giữ đoạn khóa ngắn, cẩn thận deadlock, và nhớ nó chỉ có tác dụng trong một process.
- Ưu tiên **Queue** và **thread pool** thay vì tự quản lý thread.
- Trong Rails: tránh biến class/global, dùng <mark>CurrentAttributes</mark>.

Bài tiếp theo sẽ xem Puma, Sidekiq, Solid Queue kết hợp process và thread như thế nào, và cách chọn các con số cấu hình.
