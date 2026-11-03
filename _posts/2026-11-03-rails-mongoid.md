---
layout: post
title:  "069. MongoDB with Rails (Mongoid)."
date:   2026-11-03 00:10:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_069/mongoid-basic.png
---
Nhắc tới MongoDB thì người ta hay nghĩ ngay tới Node.js, nhưng thực ra Ruby làm việc với MongoDB cũng rất ổn. Chính MongoDB Inc. đang maintain gem <mark>mongo</mark> (driver) và <mark>Mongoid</mark> (ODM) cho Ruby.

#### MongoDB khác gì PostgreSQL
| PostgreSQL | MongoDB |
|---|---|
| Database | Database |
| Table | Collection |
| Row | Document (dạng JSON) |
| Column | Field |
| Migration, schema cố định | Không cần migration, mỗi document có thể khác nhau |
| ActiveRecord | Mongoid |

Mongoid được thiết kế để thay thế ActiveRecord, nên cách viết model, validate, query gần như giống hệt. Các bro quen Rails sẽ thấy rất dễ làm quen.

#### Version sử dụng
- Ruby 3.4
- Rails 8
- MongoDB 8
- gem <mark>mongoid</mark> 9

#### Chạy MongoDB
Cách nhanh nhất là dùng Docker
```sh
docker run -d --name mongo -p 27017:27017 mongo:8
```

#### Tạo project
Vì không dùng ActiveRecord nữa, nên tạo project với <mark>--skip-active-record</mark>
```sh
rails new mongo-sample --api --skip-active-record
cd mongo-sample
bundle add mongoid
rails g mongoid:config
```
Lệnh cuối sẽ tạo file <mark>config/mongoid.yml</mark>. Mặc định đã kết nối tới <mark>localhost:27017</mark>, database tên là <mark>mongo_sample_development</mark>, nên chạy local thì không cần sửa gì.

Khi deploy, thường sẽ dùng connection string, ví dụ với MongoDB Atlas
```yaml
# config/mongoid.yml

production:
  clients:
    default:
      uri: <%= ENV["MONGODB_URI"] %>
```

#### Model
Model không kế thừa <mark>ApplicationRecord</mark> nữa, mà <mark>include Mongoid::Document</mark>. Các field được khai báo ngay trong model, không có migration.
```ruby
# app/models/product.rb

class Product
  include Mongoid::Document
  include Mongoid::Timestamps # tự thêm created_at, updated_at

  field :name, type: String
  field :price, type: Float
  field :tags, type: Array, default: []
  field :specs, type: Hash, default: {}

  validates :name, presence: true
end
```
- <mark>field</mark>: khai báo field và kiểu dữ liệu. Các type hay dùng: <mark>String</mark>, <mark>Integer</mark>, <mark>Float</mark>, <mark>BigDecimal</mark>, <mark>Boolean</mark>, <mark>Date</mark>, <mark>Time</mark>, <mark>Array</mark>, <mark>Hash</mark>.
- <mark>Array</mark> và <mark>Hash</mark> được lưu tự nhiên, không cần cấu hình gì như array field hay json field của PostgreSQL ở các bài trước.
- Cần thêm field mới? Chỉ cần thêm một dòng <mark>field</mark>, không cần migration. Các document cũ chưa có field đó thì sẽ trả về <mark>nil</mark> (hoặc giá trị <mark>default</mark>).

Các bro cũng có thể dùng generator như bình thường: <mark>rails g model Product name:string price:float</mark>.

#### CRUD
Mở <mark>rails console</mark> và thử, cú pháp gần như y hệt ActiveRecord.
```ruby
# Create
product = Product.create(
  name: "iPhone 17",
  price: 999,
  tags: ["apple", "sale"],
  specs: { color: "black", storage: "256GB" }
)
product.id
# => BSON::ObjectId('6728a1f2c3e4b5a6d7e8f901')

# Read
Product.find("6728a1f2c3e4b5a6d7e8f901")
Product.find_by(name: "iPhone 17")
Product.where(price: 999).first

# Update
product.update(price: 899)

# Delete
product.destroy
```
Khác biệt dễ thấy nhất là <mark>id</mark>: không phải số tự tăng <mark>1, 2, 3</mark>, mà là một <mark>ObjectId</mark> dạng chuỗi 24 ký tự.

#### Query
```ruby
# price > 500
Product.where(:price.gt => 500)

# price trong khoảng 100 - 500
Product.where(:price.gte => 100, :price.lte => 500)

# tags có chứa "sale"
Product.where(tags: "sale")

# tìm theo field bên trong Hash
Product.where("specs.color" => "black")

# sort, limit, chỉ lấy một số field
Product.order(price: :desc).limit(10).only(:name, :price)
```
- <mark>:price.gt</mark>, <mark>:price.lte</mark>... là cú pháp của Mongoid, sẽ được chuyển thành <mark>$gt</mark>, <mark>$lte</mark> của MongoDB.
- Query vào bên trong <mark>Array</mark>, <mark>Hash</mark> rất tự nhiên, đây là điểm mạnh của MongoDB so với SQL.

#### Controller
Controller viết y như với ActiveRecord.
```ruby
# app/controllers/products_controller.rb

class ProductsController < ApplicationController
  def index
    render json: Product.order(created_at: :desc).limit(20)
  end

  def show
    render json: Product.find(params[:id])
  end

  def create
    product = Product.new(product_params)

    if product.save
      render json: product, status: :created
    else
      render json: { errors: product.errors.full_messages }, status: :unprocessable_entity
    end
  end

  private

  def product_params
    params.require(:product).permit(:name, :price, tags: [], specs: {})
  end
end
```
Lưu ý: không tìm thấy record thì <mark>Product.find</mark> sẽ raise <mark>Mongoid::Errors::DocumentNotFound</mark> chứ không phải <mark>ActiveRecord::RecordNotFound</mark>, nên nếu có <mark>rescue_from</mark> thì nhớ đổi lại nhé các bro.

Bài tiếp theo sẽ về quan hệ giữa các document, index, và khi nào nên dùng MongoDB thay vì PostgreSQL.
