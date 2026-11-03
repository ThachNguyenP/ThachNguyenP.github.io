---
layout: post
title:  "070. MongoDB with Rails (Relation & Index)."
date:   2026-11-03 00:20:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_070/mongoid-relation.png
---
Tiếp theo bài trước, bài này nói về quan hệ giữa các document, index, và câu hỏi quan trọng nhất: khi nào nên dùng MongoDB.

#### Embedded và Referenced
Trong SQL, quan hệ luôn là 2 table nối với nhau bằng foreign key. MongoDB có 2 cách:
- **Referenced**: 2 collection riêng, nối bằng id. Giống SQL.
- **Embedded**: document con nằm luôn **bên trong** document cha. Đây là cách đặc trưng của MongoDB.

Lấy ví dụ một hệ thống bán hàng: <mark>User</mark> có nhiều <mark>Order</mark>, mỗi <mark>Order</mark> có nhiều <mark>LineItem</mark>.

#### Referenced: User và Order
User và Order đều được truy vấn riêng, số lượng order có thể rất nhiều, nên tách ra 2 collection.
```ruby
# app/models/user.rb

class User
  include Mongoid::Document

  field :name, type: String
  field :email, type: String

  has_many :orders
end
```
```ruby
# app/models/order.rb

class Order
  include Mongoid::Document
  include Mongoid::Timestamps

  field :status, type: String, default: "pending"

  belongs_to :user
  embeds_many :line_items
end
```
Cách dùng giống hệt ActiveRecord: <mark>user.orders</mark>, <mark>order.user</mark>. Collection <mark>orders</mark> sẽ có field <mark>user_id</mark>.

Giống Rails, <mark>belongs_to</mark> mặc định là bắt buộc. Muốn cho phép null thì thêm <mark>optional: true</mark>.

#### Embedded: Order và LineItem
LineItem chỉ có ý nghĩa khi nằm trong một Order, và lúc nào lấy Order cũng cần lấy kèm LineItem. Trường hợp này nên embed.
```ruby
# app/models/line_item.rb

class LineItem
  include Mongoid::Document

  field :product_name, type: String
  field :price, type: Float
  field :quantity, type: Integer

  embedded_in :order
end
```
```ruby
order = user.orders.create
order.line_items.create(product_name: "iPhone 17", price: 999, quantity: 1)
order.line_items.create(product_name: "AirPods", price: 199, quantity: 2)
```
Trong database, order sẽ được lưu như thế này. Không có collection <mark>line_items</mark> riêng.
```json
{
  "_id": "6728b2...",
  "user_id": "6728a1...",
  "status": "pending",
  "line_items": [
    { "_id": "...", "product_name": "iPhone 17", "price": 999, "quantity": 1 },
    { "_id": "...", "product_name": "AirPods", "price": 199, "quantity": 2 }
  ]
}
```
Lợi ích: <mark>Order.find(id)</mark> chỉ cần **1 query** là có đủ cả order lẫn line items, không cần join, không lo N+1.

Đổi lại, không thể query <mark>LineItem</mark> một cách độc lập, kiểu <mark>LineItem.where(...)</mark> sẽ không chạy. Muốn tìm thì phải đi qua Order:
```ruby
Order.where("line_items.product_name" => "AirPods")
```

Cách chọn đơn giản:

| Chọn **Embedded** khi | Chọn **Referenced** khi |
|---|---|
| Con luôn được đọc cùng cha | Con cần được query riêng |
| Số lượng con ít, có giới hạn | Số lượng con lớn, tăng mãi |
| Con không dùng chung cho cha khác | Con được dùng chung (VD: Product) |

Lưu ý là một document MongoDB tối đa 16MB, nên đừng embed những thứ tăng không giới hạn như comment, log.

#### Index
Không có migration, nên index được khai báo ngay trong model.
```ruby
# app/models/user.rb

class User
  include Mongoid::Document

  field :name, type: String
  field :email, type: String

  index({ email: 1 }, { unique: true })

  has_many :orders
end
```
```ruby
# app/models/order.rb

index({ user_id: 1, created_at: -1 })
```
- <mark>1</mark> là tăng dần, <mark>-1</mark> là giảm dần.
- <mark>unique: true</mark>: không cho phép trùng email.

Khai báo xong thì phải chạy lệnh này để tạo index trong database, nhớ thêm vào script deploy nhé các bro
```sh
rails db:mongoid:create_indexes
```

#### Khi nào dùng MongoDB, khi nào dùng PostgreSQL?
Theo kinh nghiệm của tôi:

**Nên dùng MongoDB khi:**
- Dữ liệu không có cấu trúc cố định, mỗi record mỗi khác: catalog sản phẩm nhiều loại thuộc tính, form động, CMS.
- Dữ liệu dạng log, event, tracking, ghi nhiều, ít quan hệ.
- Dữ liệu có dạng cây, lồng nhau, thường được đọc cả cục (như Order ở trên).

**Nên dùng PostgreSQL khi:**
- Nhiều quan hệ phức tạp giữa các bảng, cần join nhiều.
- Cần transaction chặt chẽ: tiền, thanh toán, kho hàng.
- Cần report, thống kê bằng SQL.

Nếu chỉ có **một vài field** linh hoạt, thì PostgreSQL với <mark>jsonb</mark> (bài 039 - Json Field) thường là đủ, không cần thêm hẳn một database mới. Còn với các dự án Rails, đa số các gem đều viết cho ActiveRecord trước, nên trước khi chọn Mongoid, các bro nên kiểm tra các gem mình cần có hỗ trợ Mongoid không (Devise, Pundit, Kaminari với <mark>kaminari-mongoid</mark> thì có).

Vậy là đủ để các bro bắt đầu một dự án Rails với MongoDB rồi.
