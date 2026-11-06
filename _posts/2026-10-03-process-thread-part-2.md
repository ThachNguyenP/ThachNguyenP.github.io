---
layout: post
title:  "101. Process & Thread (GVL)."
date:   2026-10-03 01:40:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_101/process-thread-gvl.png
---
Máy có 8 core, tạo 4 thread để tính toán, kỳ vọng nhanh gấp 4 lần. Kết quả: **không nhanh hơn chút nào**. Thủ phạm là **GVL**.

#### Thử nghiệm
Một hàm tính toán nặng CPU, và một việc chỉ ngồi chờ (giả lập gọi API, query database)
```ruby
# gvl.rb

require "benchmark"

def fib(n) = n < 2 ? n : fib(n - 1) + fib(n - 2)

Benchmark.bm(12) do |x|
  x.report("cpu seq")     { 4.times { fib(32) } }
  x.report("cpu thread")  { 4.times.map { Thread.new { fib(32) } }.each(&:join) }
  x.report("cpu process") { 4.times { fork { fib(32) } }; Process.waitall }

  x.report("io seq")      { 4.times { sleep 0.5 } }
  x.report("io thread")   { 4.times.map { Thread.new { sleep 0.5 } }.each(&:join) }
end
```
Kết quả trên máy tôi (8 core)
```
                   user     system      total        real
cpu seq        0.623459   0.000168   0.623627 (  0.623640)
cpu thread     0.620823   0.000394   0.621217 (  0.621169)
cpu process    0.000197   0.001583   0.661873 (  0.166940)
io seq         0.000118   0.000134   0.000252 (  2.002921)
io thread      0.001697   0.001064   0.002761 (  0.505553)
```
Nhìn cột <mark>real</mark>:
- Tính toán (CPU): 4 thread **bằng** chạy tuần tự (0.62s). 4 process nhanh gần **4 lần** (0.17s).
- Chờ (IO): 4 thread nhanh **4 lần** (2s xuống 0.5s).

#### GVL là gì
CRuby (bản Ruby chuẩn, viết bằng C) có một cái khóa toàn cục gọi là **GVL** (Global VM Lock), trước đây hay gọi là GIL. Quy tắc rất đơn giản: **tại một thời điểm, chỉ một thread được chạy code Ruby**. Muốn chạy, thread phải giữ GVL.

Giống một phòng có nhiều đầu bếp nhưng chỉ có **một con dao**. Ai cầm dao mới được thái. Có thêm đầu bếp cũng không thái nhanh hơn.

Vậy sao IO lại nhanh hơn? Vì khi một thread **chờ IO** (đọc file, gọi HTTP, query DB, <mark>sleep</mark>...), nó **nhả GVL** ra cho thread khác dùng. Đầu bếp đặt dao xuống trong lúc chờ nồi sôi, người khác cầm lên thái tiếp.
```
Thread A: [chạy Ruby]--[chờ DB.........]--[chạy Ruby]
Thread B:            [chạy Ruby]--[chờ HTTP.........]--[chạy Ruby]
Thread C:                        [chạy Ruby]--[chờ Redis....]
GVL:      ----A-----|----B------|-----C-----|----A----|...
```
Thread nào cũng tốn phần lớn thời gian để chờ, nên dù chỉ một thread chạy Ruby tại một thời điểm, tổng thời gian vẫn giảm rất nhiều.

Còn process thì mỗi process có **GVL riêng**, nên 4 process chạy được trên 4 core thật sự.

#### Tại sao Ruby lại có GVL
Không phải do lười. GVL giúp:
- Bản thân Ruby VM và garbage collector đơn giản hơn, ít bug hơn.
- **C extension** (nokogiri, pg, mysql2...) không cần lo thread safety.
- Code Ruby đơn thread chạy nhanh hơn, vì không phải lock từng object.

Đổi lại là không tận dụng được nhiều core trong một process. JRuby và TruffleRuby **không có** GVL, thread chạy song song thật sự, nhưng cũng vì thế mà code không thread-safe sẽ lỗi nhiều hơn.

#### GVL không bảo vệ code của bạn
Hiểu lầm hay gặp: "có GVL rồi thì không lo race condition". **Sai**. Ruby có thể chuyển thread **giữa hai dòng code bất kỳ** (cụ thể là sau mỗi khoảng thời gian ngắn, mặc định 100ms, hoặc khi gặp IO). GVL chỉ bảo vệ Ruby VM không bị hỏng, không bảo vệ **logic** của chúng ta. Bài tiếp theo sẽ nói kỹ phần này.

#### Ứng dụng web thuộc loại nào
Một request Rails điển hình
```
Tổng: 200ms
├── Query DB          80ms  (IO, nhả GVL)
├── Gọi API bên ngoài 60ms  (IO, nhả GVL)
├── Đọc Redis          5ms  (IO, nhả GVL)
└── Chạy Ruby: render JSON, logic...  55ms  (giữ GVL)
```
Phần lớn thời gian là **chờ IO**, nên thread rất có ích: trong lúc request A chờ DB, request B được xử lý. Đây là lý do Puma dùng thread.

Nhưng phần Ruby không phải bằng 0. Nếu dùng quá nhiều thread, chúng sẽ phải **xếp hàng chờ GVL**, request bị chậm đi dù CPU còn trống. Rails 7.2 đã giảm số thread mặc định của Puma từ 5 xuống **3** vì lý do này.

#### Khi nào dùng gì

| Loại công việc | Ví dụ | Dùng |
|---|---|---|
| **IO-bound**: phần lớn thời gian chờ | Gọi API, query DB, gửi email, tải file | **Thread** |
| **CPU-bound**: phần lớn thời gian tính toán | Resize ảnh, xuất PDF, tính toán lớn, parse file lớn | **Process** (hoặc Ractor, bài 104) |
| Kết hợp | Web server | Nhiều process, mỗi process vài thread |

Ví dụ thực tế: gọi 10 API để tổng hợp dữ liệu, tuần tự mất 10 × 300ms = 3s. Dùng thread
```ruby
require "net/http"

urls = 10.times.map { |i| URI("https://api.example.com/items/#{i}") }

responses = urls.map do |url|
  Thread.new { Net::HTTP.get(url) }
end.map(&:value)
```
Còn khoảng 300ms. Lưu ý nên giới hạn số thread nếu danh sách lớn (dùng thread pool, bài 102), đừng tạo 1000 thread cho 1000 URL.

#### Tóm tắt
- GVL: mỗi process chỉ một thread chạy code Ruby tại một thời điểm.
- Thread **nhả GVL khi chờ IO**, nên thread giúp ích cho công việc IO-bound.
- Công việc CPU-bound cần **process** để dùng nhiều core.
- GVL **không** làm code của chúng ta thread-safe.
