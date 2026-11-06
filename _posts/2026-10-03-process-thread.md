---
layout: post
title:  "100. Process & Thread (Khái niệm)."
date:   2026-10-03 01:38:00 +0700
author: thach
categories: [Coding]
tags: [Ruby]
image: assets/images/post_100/process-thread.png
---
Cấu hình Puma có <mark>workers</mark> và <mark>threads</mark>, Sidekiq có <mark>concurrency</mark>, database.yml có <mark>pool</mark>. Để chỉnh mấy con số này cho đúng, thay vì copy từ đâu đó, cần hiểu **process** và **thread** là gì. Series này đi từ khái niệm cơ bản tới cách chúng chạy trong Rails.

Version sử dụng: Ruby 3.4, Rails 8.

#### Process
Mỗi lần chạy một chương trình, hệ điều hành tạo ra một **process**. Process có:
- **Vùng nhớ riêng**: biến, object, heap, stack. Process khác **không đọc được**.
- Tài nguyên riêng: file đang mở, socket, biến môi trường.
- Một mã số gọi là **PID**.

Mở 2 terminal cùng chạy <mark>irb</mark>, đó là 2 process khác nhau. Gán <mark>x = 1</mark> ở terminal này thì terminal kia không hề biết.
```ruby
puts Process.pid   # => 51234
```

#### Tạo process bằng fork
Trên Linux/macOS, cách tạo process con là <mark>fork</mark>: copy nguyên process hiện tại thành một process mới. (Windows không có <mark>fork</mark>, hãy chạy các ví dụ trong WSL.)
```ruby
# fork.rb

data = [1, 2, 3]

pid = fork do
  # đây là process con
  data << 4
  puts "con  #{Process.pid}: #{data.inspect}"
end

Process.wait(pid) # chờ process con chạy xong
puts "cha  #{Process.pid}: #{data.inspect}"
```
```
con  51301: [1, 2, 3, 4]
cha  51300: [1, 2, 3]
```
Process con sửa <mark>data</mark> nhưng process cha không bị ảnh hưởng, vì mỗi bên có bản copy riêng.

Copy cả vùng nhớ nghe có vẻ tốn kém, nhưng hệ điều hành dùng kỹ thuật **copy-on-write**: ban đầu 2 process dùng chung vùng nhớ vật lý, chỉ khi một bên **ghi** vào trang nhớ nào thì trang đó mới được copy. Đây là lý do Puma <mark>preload_app!</mark> giúp tiết kiệm RAM (bài 103).

Muốn các process nói chuyện với nhau thì phải qua kênh riêng (IPC): pipe, socket, file, Redis, database...
```ruby
reader, writer = IO.pipe

fork do
  reader.close
  writer.puts "kết quả từ con: #{(1..10).sum}"
end

writer.close
puts reader.gets # => kết quả từ con: 55
Process.wait
```

#### Thread
**Thread** là một luồng thực thi **bên trong** process. Một process có thể có nhiều thread, và các thread **dùng chung vùng nhớ** của process.
```ruby
# thread.rb

data = [1, 2, 3]

thread = Thread.new do
  data << 4
end
thread.join # chờ thread chạy xong

p data # => [1, 2, 3, 4]
```
Lần này process chính thấy được thay đổi, vì không có copy nào cả.

Vài thao tác cơ bản
```ruby
t = Thread.new { 1 + 1 }
t.value     # => 2, chờ thread xong và lấy kết quả

t = Thread.new { raise "lỗi" }
t.join      # => RuntimeError: lỗi, exception được raise lại khi join

Thread.current     # thread đang chạy
Thread.main        # thread chính của process
Thread.list.size   # số thread đang có
```
Lưu ý: chương trình kết thúc khi **main thread** kết thúc, các thread khác bị dừng luôn dù chưa chạy xong. Vì vậy luôn nhớ <mark>join</mark>.

#### So sánh

| | Process | Thread |
|---|---|---|
| Vùng nhớ | Riêng | Chung trong process |
| Chi phí tạo | Nặng (vài ms, tốn RAM) | Nhẹ (vài chục µs) |
| Giao tiếp | Phải qua pipe, socket, DB... | Đọc/ghi chung biến, rất dễ |
| Một bên crash | Bên khác không sao | Có thể kéo sập cả process |
| Lỗi hay gặp | Tốn RAM | **Race condition** (bài 102) |
| Chạy song song nhiều CPU trong Ruby | Có | **Không** với code Ruby (bài 101) |

Dùng chung bộ nhớ vừa là điểm mạnh, vừa là điểm yếu lớn nhất của thread: dễ chia sẻ dữ liệu, nhưng cũng dễ ghi đè lên nhau.

#### Concurrency và Parallelism
Hai khái niệm hay bị dùng lẫn lộn:
- **Concurrency** (đồng thời): nhiều việc **cùng đang diễn ra**, có thể xen kẽ nhau trên **một** CPU. Giống một đầu bếp vừa nấu canh vừa chiên cá: đặt nồi canh lên bếp, trong lúc chờ sôi thì quay sang chiên cá.
- **Parallelism** (song song): nhiều việc **chạy cùng một lúc** trên **nhiều** CPU. Giống 2 đầu bếp, mỗi người làm một món.

Hệ điều hành chuyển qua lại giữa các thread rất nhanh (gọi là **context switch**), nên dù chỉ có 1 CPU, chúng ta vẫn thấy như nhiều việc chạy cùng lúc.

Với Ruby (CRuby, bản chuẩn), **thread cho concurrency, process cho parallelism**. Tại sao lại như vậy? Câu trả lời nằm ở **GVL**, nội dung của bài tiếp theo.

#### Nội dung series

| Bài | Nội dung |
|---|---|
| 100 | Khái niệm process, thread |
| 101 | GVL, khi nào thread giúp chạy nhanh hơn |
| 102 | Thread safety: race condition, Mutex, Queue |
| 103 | Process & Thread trong Puma, Sidekiq, Solid Queue |
| 104 | Fiber & Ractor |
