---
layout: post
title:  "066. Making api with gRPC (Rails)."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_066/grpc-rails.png
---
Bài trước chúng ta đã có gRPC hello world bằng Ruby thuần. Giờ đưa nó vào Rails để dùng được model, database.

#### Cài đặt
```sh
rails new grpc-sample --api
cd grpc-sample
bundle add grpc
bundle add grpc-tools --group development

rails g model User name:string email:string
rails db:migrate
```
Insert một ít data vào bảng users nhé các bro.

Cây thư mục sẽ như thế này
```sh
grpc-sample
  |––proto
       |––user.proto
  |––lib
       |––protos                     # code generate ra
           |––user_pb.rb
           |––user_services_pb.rb
  |––app
       |––grpc
           |––user_service_handler.rb
  |––bin
       |––grpc_server
```

#### Proto
```protobuf
// proto/user.proto

syntax = "proto3";

package app.v1;

service UserService {
  rpc GetUser (GetUserRequest) returns (UserReply);
  rpc ListUsers (ListUsersRequest) returns (ListUsersReply);
}

message GetUserRequest {
  int64 id = 1;
}

message ListUsersRequest {
  int32 page = 1;
  int32 per_page = 2;
}

message UserReply {
  int64 id = 1;
  string name = 2;
  string email = 3;
}

message ListUsersReply {
  repeated UserReply users = 1;
  int32 total_count = 2;
}
```
- <mark>package app.v1</mark> sẽ thành module <mark>App::V1</mark>, giống như cách chúng ta đánh version ở series Grape.
- <mark>repeated</mark> nghĩa là một mảng.

Generate code
```sh
mkdir -p lib/protos
bundle exec grpc_tools_ruby_protoc -I proto --ruby_out=lib/protos --grpc_out=lib/protos proto/user.proto
```

#### Bỏ qua autoload cho code generate
Từ Rails 7.1, thư mục <mark>lib</mark> được autoload bởi Zeitwerk. File generate ra không theo quy tắc đặt tên của Zeitwerk (<mark>user_pb.rb</mark> không định nghĩa class <mark>UserPb</mark>), nên cần bỏ qua thư mục <mark>protos</mark>.
```ruby
# config/application.rb

config.autoload_lib(ignore: %w[assets tasks protos])
```

#### Handler
Đây là nơi viết logic, tương tự controller trong Rails. Tôi đặt trong <mark>app/grpc</mark>, Rails sẽ tự autoload thư mục này.
```ruby
# app/grpc/user_service_handler.rb

class UserServiceHandler < App::V1::UserService::Service
  def get_user(request, _call)
    user = User.find(request.id)
    to_reply(user)
  end

  def list_users(request, _call)
    page = [request.page, 1].max
    per_page = request.per_page.positive? ? request.per_page : 10
    users = User.order(:id).offset((page - 1) * per_page).limit(per_page)

    App::V1::ListUsersReply.new(
      users: users.map { |user| to_reply(user) },
      total_count: User.count
    )
  end

  private

  def to_reply(user)
    App::V1::UserReply.new(id: user.id, name: user.name, email: user.email)
  end
end
```
Lưu ý: trong protobuf không có <mark>nil</mark> cho kiểu số. Client không gửi <mark>page</mark> thì giá trị sẽ là <mark>0</mark>, nên chúng ta cần tự set giá trị mặc định như trên.

Hàm <mark>to_reply</mark> có vai trò giống <mark>Grape::Entity</mark>: chuyển model sang message để trả về.

#### Chạy gRPC server
gRPC server chạy ở một process riêng, không chạy chung với <mark>rails s</mark>. Tạo file <mark>bin/grpc_server</mark>
```ruby
#!/usr/bin/env ruby
# bin/grpc_server

require_relative "../config/environment"

$LOAD_PATH.unshift(Rails.root.join("lib/protos").to_s)
require "user_services_pb"

port = ENV.fetch("GRPC_PORT", "50051")

server = GRPC::RpcServer.new
server.add_http2_port("0.0.0.0:#{port}", :this_port_is_insecure)
server.handle(UserServiceHandler)

puts "gRPC server running on port #{port}"
server.run_till_terminated_or_interrupted(["INT", "TERM"])
```
- <mark>require_relative "../config/environment"</mark>: load toàn bộ Rails, nên trong handler dùng được model, ActiveRecord như bình thường.

```sh
chmod +x bin/grpc_server
bin/grpc_server
```

#### Test bằng client
Để test nhanh, các bro có thể dùng <mark>rails runner</mark>. Thực tế thì client sẽ là một service khác, chỉ cần copy file <mark>.proto</mark> sang và generate code.
```ruby
# script/grpc_client.rb

$LOAD_PATH.unshift(Rails.root.join("lib/protos").to_s)
require "user_services_pb"

stub = App::V1::UserService::Stub.new("localhost:50051", :this_channel_is_insecure)

user = stub.get_user(App::V1::GetUserRequest.new(id: 1))
puts user.name
# => Nolan

reply = stub.list_users(App::V1::ListUsersRequest.new(page: 1, per_page: 2))
puts reply.total_count
puts reply.users.map(&:name).inspect
# => ["Nolan", "Messi"]

# Message có thể chuyển sang hash
puts user.to_h
# => {id: 1, name: "Nolan", email: "nolan@example.com"}
```
```sh
bin/rails runner script/grpc_client.rb
```

Nếu thích dùng UI thì Postman cũng hỗ trợ gRPC: tạo request kiểu **gRPC**, import file <mark>user.proto</mark>, nhập <mark>localhost:50051</mark> là gọi được.

Thử gọi <mark>get_user</mark> với một id không tồn tại xem, server sẽ trả về một lỗi khá khó hiểu. Bài tiếp theo chúng ta sẽ xử lý lỗi cho đúng cách, và thêm authentication.
