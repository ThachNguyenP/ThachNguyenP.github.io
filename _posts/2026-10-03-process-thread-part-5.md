---
layout: post
title:  "104. Process & Thread (Fiber & Ractor)."
date:   2026-10-03 01:46:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_104/process-thread-fiber-ractor.png
---
Process và thread chưa phải là tất cả. Ruby còn 2 công cụ nữa, giải quyết 2 điểm yếu của thread:
- **Fiber**: thread vẫn khá nặng, không tạo được 10.000 cái. Fiber nhẹ hơn rất nhiều, phù hợp cho số lượng lớn kết nối IO.
- **Ractor**: thread không chạy song song code Ruby vì GVL. Ractor thì có.

#### Fiber
Fiber là một đoạn code có thể **tạm dừng** và **chạy tiếp** từ chỗ đã dừng. Khác với thread, fiber **không tự chuyển** qua lại: chính code phải chủ động nhường (<mark>Fiber.yield</mark>) và chủ động chạy tiếp (<mark>resume</mark>).
```ruby
fiber = Fiber.new do
  puts "bước 1"
  Fiber.yield     # tạm dừng, trả quyền điều khiển về
  puts "bước 2"
  Fiber.yield
  puts "bước 3"
end

fiber.resume # => bước 1
puts "làm việc khác"
fiber.resume # => bước 2
fiber.resume # => bước 3
```
Vì không bao giờ bị ngắt ngang giữa chừng, fiber ít bị race condition hơn thread rất nhiều. Fiber cũng rất nhẹ: vài KB bộ nhớ, tạo và chuyển đổi nhanh hơn thread nhiều lần.

Bản thân <mark>Enumerator</mark> của Ruby cũng dùng fiber bên trong
```ruby
e = [1, 2, 3].each
e.next # => 1
e.next # => 2
```

#### Fiber scheduler
Tự gọi <mark>resume</mark>, <mark>yield</mark> thì rất cực. Từ Ruby 3.0, có **fiber scheduler**: khi một fiber gặp IO (gọi HTTP, đọc socket, <mark>sleep</mark>), Ruby tự động tạm dừng nó và chạy fiber khác, giống hệt thread nhả GVL. Code vẫn viết bình thường, không cần <mark>async/await</mark> như JavaScript.

Gem <mark>async</mark> là scheduler phổ biến nhất
```sh
gem install async
```
```ruby
# fiber_http.rb

require "async"
require "net/http"

urls = 100.times.map { |i| URI("https://api.example.com/items/#{i}") }

Async do |task|
  responses = urls.map do |url|
    task.async { Net::HTTP.get(url) } # mỗi request là một fiber
  end.map(&:wait)

  puts responses.size
end
```
100 request chạy đồng thời, chỉ trong **một thread**. Với thread thì nên giới hạn khoảng vài chục, còn fiber thì vài nghìn vẫn ổn.

Lưu ý: fiber vẫn chịu GVL, và vẫn chỉ chạy trên một thread, nên **không** giúp gì cho công việc CPU-bound. Fiber chỉ thay thế thread cho công việc **IO-bound với số lượng rất lớn**: websocket, crawler, gọi hàng nghìn API, chat server, streaming LLM...

Trong Rails:
- Web server **Falcon** dùng fiber thay cho thread của Puma, mỗi request là một fiber.
- Từ Rails 7 có thể cấu hình <mark>config.active_support.isolation_level = :fiber</mark>, để <mark>CurrentAttributes</mark> và connection pool hoạt động theo fiber thay vì thread.
- Thư viện cần hỗ trợ fiber scheduler mới chạy đồng thời được. <mark>Net::HTTP</mark>, <mark>pg</mark>, <mark>redis</mark> bản mới đều đã hỗ trợ.

#### Ractor
Ractor (Ruby actor), có từ Ruby 3.0, cho phép chạy code Ruby **song song thật sự** trên nhiều core trong **một process**. Mỗi Ractor có GVL riêng.

Chạy lại bài toán fib ở bài 101
```ruby
# ractor.rb

def fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2)

ractors = 4.times.map do
  Ractor.new { fib(32) }
end

p ractors.map(&:take) # chờ và lấy kết quả của từng ractor
```
Chạy trên 4 core, nhanh gần 4 lần, giống như dùng 4 process nhưng không phải fork.

Cái giá phải trả: để không bị race condition, Ractor **không cho chia sẻ object có thể thay đổi**.
```ruby
data = [1, 2, 3]
Ractor.new { data << 4 }
# => ArgumentError: can not isolate a Proc because it accesses outer variables (data).
```
Dữ liệu phải được **gửi** vào ractor. Object sẽ được copy, hoặc chuyển hẳn quyền sở hữu (<mark>move: true</mark>), còn object bất biến (số, symbol, string đã <mark>freeze</mark>, <mark>Data</mark>...) thì dùng chung được
```ruby
r = Ractor.new do
  numbers = Ractor.receive # nhận dữ liệu gửi vào
  numbers.sum
end

r.send([1, 2, 3])
p r.take # => 6
```
Tình trạng hiện tại:
- Ruby in ra cảnh báo <mark>Ractor is experimental</mark> khi dùng.
- Phần lớn gem chưa tương thích, vì chúng dùng biến class, hằng số có thể thay đổi, những thứ ractor không cho phép. Rails thì chưa chạy được trong Ractor.
- Ruby 4.0 thay đổi API: thay <mark>take</mark> bằng <mark>value</mark>/<mark>join</mark> và thêm <mark>Ractor::Port</mark> để giao tiếp. Code trên viết theo Ruby 3.4.

Vì vậy, hiện tại Ractor phù hợp cho các tác vụ tính toán **thuần Ruby, độc lập** (xử lý dữ liệu, tính toán số học). Còn trong ứng dụng Rails, muốn dùng nhiều core thì vẫn nên dùng process như Puma, Sidekiq.

#### Tổng kết series

| | Process | Thread | Fiber | Ractor |
|---|---|---|---|---|
| Bộ nhớ | Riêng | Chung | Chung | Gần như riêng |
| Song song nhiều core | Có | Không (GVL) | Không | Có |
| Chuyển đổi | Hệ điều hành | Hệ điều hành + GVL | Tự nhường / scheduler | Hệ điều hành |
| Chi phí | Nặng nhất | Trung bình | Nhẹ nhất | Trung bình |
| Rủi ro | Tốn RAM | Race condition | Thư viện chưa hỗ trợ scheduler | Gem chưa tương thích |
| Dùng cho | CPU-bound, cô lập lỗi | IO-bound vừa phải | IO-bound số lượng rất lớn | CPU-bound thuần Ruby |
| Ví dụ | Puma workers, Sidekiq process | Puma threads, Sidekiq concurrency | Falcon, gem async | Tính toán song song |

Với đa số ứng dụng Rails, công thức vẫn là: **nhiều process để dùng nhiều core, mỗi process vài thread để tận dụng thời gian chờ IO**, và viết code thread-safe. Fiber và Ractor là công cụ cho những trường hợp đặc biệt, nhưng rất đáng để theo dõi vì Ruby đang đầu tư mạnh vào cả hai.
