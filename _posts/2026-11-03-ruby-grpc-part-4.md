---
layout: post
title:  "068. Making api with gRPC (Streaming)."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_068/grpc-streaming.png
---
Phần cuối trong series gRPC. Nhờ chạy trên HTTP/2, gRPC hỗ trợ **streaming**: gửi hoặc nhận nhiều message trong cùng một lần gọi.

#### 4 kiểu rpc
| Kiểu | Proto | Ví dụ |
|---|---|---|
| Unary | <mark>rpc A (Req) returns (Res)</mark> | Các bài trước |
| Server streaming | <mark>rpc A (Req) returns (stream Res)</mark> | Export dữ liệu lớn, nhận notification |
| Client streaming | <mark>rpc A (stream Req) returns (Res)</mark> | Upload file theo từng phần |
| Bidirectional | <mark>rpc A (stream Req) returns (stream Res)</mark> | Chat |

Trong bài này chúng ta làm **server streaming**, kiểu hay gặp nhất.

#### Bài toán
Ở bài 2, <mark>ListUsers</mark> trả về một mảng users. Nếu bảng users có 1 triệu record, server phải load hết vào memory rồi mới gửi đi. Với streaming, server gửi từng user một, client nhận tới đâu xử lý tới đó.

#### Proto
Thêm một rpc mới vào <mark>user.proto</mark>, để ý chữ <mark>stream</mark>
```protobuf
// proto/user.proto

service UserService {
  rpc GetUser (GetUserRequest) returns (UserReply);
  rpc ListUsers (ListUsersRequest) returns (ListUsersReply);
  rpc StreamUsers (StreamUsersRequest) returns (stream UserReply);
}

message StreamUsersRequest {}
```
Generate lại code
```sh
bundle exec grpc_tools_ruby_protoc -I proto --ruby_out=lib/protos --grpc_out=lib/protos proto/user.proto
```

#### Server
Với server streaming, handler không trả về một message nữa, mà trả về một <mark>Enumerator</mark>. gRPC sẽ lấy từng phần tử và gửi cho client.
```ruby
# app/grpc/user_service_handler.rb

def stream_users(_request, _call)
  Enumerator.new do |yielder|
    User.find_each(batch_size: 500) do |user|
      yielder << to_reply(user)
    end
  end
end
```
- <mark>find_each</mark>: query DB theo từng batch 500 record, không load cả bảng vào memory.
- <mark>yielder << ...</mark>: mỗi lần như vậy là một message được gửi đi.

#### Interceptor
Nếu các bro đã thêm <mark>AuthInterceptor</mark> ở bài trước, cần thêm hàm cho kiểu server streaming, nếu không thì rpc này sẽ không được check token.
```ruby
# app/grpc/auth_interceptor.rb

class AuthInterceptor < GRPC::ServerInterceptor
  def request_response(request: nil, call: nil, method: nil)
    authenticate!(call)
    yield
  end

  def server_streamer(request: nil, call: nil, method: nil)
    authenticate!(call)
    yield
  end

  private

  def authenticate!(call)
    token = call.metadata["authorization"]
    return if token == "Bearer #{ENV.fetch('GRPC_AUTH_TOKEN')}"

    raise GRPC::Unauthenticated, "Invalid token"
  end
end
```

#### Client
Phía client nhận về một <mark>Enumerator</mark>, chỉ cần <mark>each</mark>
```ruby
users = stub.stream_users(
  App::V1::StreamUsersRequest.new,
  metadata: { "authorization" => "Bearer my-secret-token" }
)

users.each do |user|
  puts "#{user.id} - #{user.name}"
end
# 1 - Nolan
# 2 - Messi
# ...
```
Mỗi user được in ra ngay khi server gửi tới, không cần chờ hết danh sách.

#### Tổng kết
Qua 4 bài, chúng ta đã đi qua những gì cơ bản nhất với gRPC trên Ruby:
1. Khái niệm, file <mark>.proto</mark> và hello world.
2. Tích hợp vào Rails, chạy gRPC server riêng.
3. Status code, metadata, deadline và authentication với interceptor.
4. Server streaming.

Khi nào dùng gì? Theo kinh nghiệm của tôi:
- **REST / Grape**: API public, đơn giản, ai cũng gọi được.
- **GraphQL**: FE, Mobile cần lấy dữ liệu linh hoạt, nhiều màn hình khác nhau.
- **gRPC**: các service backend gọi nhau, cần nhanh và có "hợp đồng" rõ ràng giữa các team.
