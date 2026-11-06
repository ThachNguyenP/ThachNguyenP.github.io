---
layout: post
title:  "067. Making api with gRPC (Error & Authentication)."
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_067/grpc-error-auth.png
---
Tiếp tục với project Rails ở bài trước, bài này về 2 thứ không thể thiếu: trả lỗi và authentication.

#### Status code
REST dùng HTTP status code (404, 401...). gRPC có bộ status code riêng, những cái hay dùng:

| gRPC status | Ruby class | Tương đương HTTP |
|---|---|---|
| OK | | 200 |
| INVALID_ARGUMENT | <mark>GRPC::InvalidArgument</mark> | 400 |
| UNAUTHENTICATED | <mark>GRPC::Unauthenticated</mark> | 401 |
| PERMISSION_DENIED | <mark>GRPC::PermissionDenied</mark> | 403 |
| NOT_FOUND | <mark>GRPC::NotFound</mark> | 404 |
| INTERNAL | <mark>GRPC::Internal</mark> | 500 |
| DEADLINE_EXCEEDED | <mark>GRPC::DeadlineExceeded</mark> | 504 |

Tất cả đều kế thừa <mark>GRPC::BadStatus</mark>.

#### Trả lỗi ở server
Chỉ cần <mark>raise</mark> đúng class lỗi ở handler.
```ruby
# app/grpc/user_service_handler.rb

def get_user(request, _call)
  user = User.find_by(id: request.id)
  raise GRPC::NotFound, "User #{request.id} not found" unless user

  to_reply(user)
end
```
Nếu raise một exception bình thường (ví dụ <mark>ActiveRecord::RecordNotFound</mark>), client chỉ nhận được lỗi <mark>UNKNOWN</mark>, rất khó debug. Vì vậy luôn chuyển về <mark>GRPC::BadStatus</mark> nhé các bro.

#### Bắt lỗi ở client
Phía client, lỗi sẽ được raise lại thành exception tương ứng.
```ruby
begin
  stub.get_user(App::V1::GetUserRequest.new(id: 999))
rescue GRPC::NotFound => e
  puts e.code     # => 5
  puts e.details  # => User 999 not found
rescue GRPC::BadStatus => e
  puts "Other error: #{e.message}"
end
```

#### Deadline
Khi gọi một service khác, luôn nên đặt **deadline** (timeout). Nếu server xử lý quá lâu, client sẽ nhận <mark>GRPC::DeadlineExceeded</mark> thay vì phải chờ mãi.
```ruby
stub.get_user(request, deadline: Time.now + 2) # tối đa 2 giây
```

#### Metadata
Muốn gửi thêm thông tin ngoài message, ví dụ token, thì dùng **metadata**. Có thể hiểu metadata giống HTTP header.

Client gửi metadata
```ruby
stub.get_user(
  App::V1::GetUserRequest.new(id: 1),
  metadata: { "authorization" => "Bearer my-secret-token" }
)
```
Key của metadata phải viết thường.

Server đọc metadata qua tham số thứ 2 của hàm, chính là <mark>_call</mark> mà nãy giờ chúng ta bỏ qua
```ruby
def get_user(request, call)
  token = call.metadata["authorization"]
  # ...
end
```

#### Authentication với Interceptor
Check token ở từng hàm thì bị lặp code. gRPC có <mark>Interceptor</mark>, hoạt động giống <mark>before_action</mark> trong Rails controller, chạy trước tất cả các rpc.
```ruby
# app/grpc/auth_interceptor.rb

class AuthInterceptor < GRPC::ServerInterceptor
  def request_response(request: nil, call: nil, method: nil)
    token = call.metadata["authorization"]
    unless token == "Bearer #{ENV.fetch('GRPC_AUTH_TOKEN')}"
      raise GRPC::Unauthenticated, "Invalid token"
    end

    yield
  end
end
```
- <mark>request_response</mark>: áp dụng cho các rpc dạng 1 request, 1 response (unary) như chúng ta đang dùng.
- <mark>yield</mark>: cho request đi tiếp vào handler.

Khai báo interceptor khi tạo server
```ruby
# bin/grpc_server

server = GRPC::RpcServer.new(interceptors: [AuthInterceptor.new])
```

Giờ gọi không có token
```ruby
begin
  stub.get_user(App::V1::GetUserRequest.new(id: 1))
rescue GRPC::Unauthenticated => e
  puts e.details # => Invalid token
end
```

Ví dụ trên dùng một token cố định, phù hợp cho các service nội bộ gọi nhau. Nếu cần xác thực user thì có thể decode JWT trong interceptor, cách làm cũng tương tự.

Bài cuối sẽ về một tính năng mà REST không có: **streaming**.
