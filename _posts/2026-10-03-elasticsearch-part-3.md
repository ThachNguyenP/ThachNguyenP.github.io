---
layout: post
title:  "107. Elasticsearch (Đồng bộ dữ liệu từ Rails)."
date:   2026-10-03 01:52:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_107/elasticsearch-sync.png
---
Dữ liệu gốc nằm ở PostgreSQL, Elasticsearch chỉ là bản sao (bài 105). Bài này giải quyết 3 việc: đưa toàn bộ dữ liệu vào lần đầu, giữ cho bản sao luôn cập nhật, và đổi mapping mà không bị downtime.

#### Chọn gem
Có 3 lựa chọn phổ biến:

| Gem | Ưu điểm | Nhược điểm |
|---|---|---|
| <mark>searchkick</mark> | Cực nhanh để bắt đầu, có sẵn tìm không dấu, gợi ý, reindex | Ẩn gần hết query, khó tùy biến sâu |
| <mark>elasticsearch-model</mark> | Tích hợp ActiveRecord | Ít được cập nhật |
| <mark>elasticsearch</mark> | Client chính thức, luôn hỗ trợ version mới nhất | Phải tự viết phần tích hợp |

Trong series này tôi dùng client chính thức, vì phần tích hợp không nhiều, và hiểu rõ query sẽ giúp ích rất nhiều khi cần debug hay tối ưu. Hiểu rồi thì chuyển sang searchkick cũng dễ.
```ruby
# Gemfile

gem "elasticsearch", "~> 9.0"
```
```ruby
# config/initializers/elasticsearch.rb

ELASTICSEARCH = Elasticsearch::Client.new(
  url: ENV.fetch("ELASTICSEARCH_URL", "http://localhost:9200"),
  retry_on_failure: 3,
  request_timeout: 5,
  log: Rails.env.development?
)
```

#### Tạo index và import dữ liệu
Giả sử app có 3 model sau (tạo nhanh để làm theo)
```sh
bin/rails g model Brand name:string
bin/rails g model Category name:string slug:string
bin/rails g model Product name:string description:text brand:references category:references \
  price:bigint stock:integer rating:decimal sold_count:integer
bin/rails db:migrate
```
Tiếp tục <mark>ProductIndex</mark> của bài 106. Index thật được đặt tên kèm thời gian, ví dụ <mark>products_20261103120000</mark>, và code luôn đọc ghi qua **alias** <mark>products</mark>. Lý do sẽ rõ ở phần reindex.
```ruby
# app/search/product_index.rb

class ProductIndex
  # ALIAS, SETTINGS, MAPPINGS như bài 106

  class << self
    def client = ELASTICSEARCH

    def document(product)
      {
        id: product.id,
        name: product.name,
        description: product.description,
        brand: product.brand.name,
        category: product.category.slug,
        price: product.price,
        in_stock: product.stock.positive?,
        rating: product.rating.to_f,
        sold_count: product.sold_count,
        created_at: product.created_at
      }
    end

    def create_index
      name = "#{ALIAS}_#{Time.current.strftime('%Y%m%d%H%M%S')}"
      client.indices.create(index: name, body: { settings: SETTINGS, mappings: MAPPINGS })
      name
    end

    def import(index_name, batch_size: 1000)
      Product.includes(:brand, :category).find_in_batches(batch_size:) do |products|
        body = products.map do |product|
          { index: { _index: index_name, _id: product.id, data: document(product) } }
        end

        response = client.bulk(body:)
        raise "Bulk import lỗi: #{response['items'].first(3)}" if response["errors"]
      end
    end
  end
end
```
Luôn dùng **bulk API** khi đưa nhiều document vào: gửi 1000 document trong một request thay vì 1000 request. Và luôn kiểm tra <mark>response["errors"]</mark>: bulk API trả về HTTP 200 kể cả khi có document bị lỗi (sai mapping chẳng hạn), không kiểm tra là mất dữ liệu mà không hề biết.

#### Reindex không downtime
Mapping không sửa được (bài 106). Mỗi lần thêm field hay đổi analyzer, phải tạo index mới. Nếu xóa index cũ rồi tạo lại, trong lúc import (có thể mất vài phút tới vài giờ), tìm kiếm sẽ trả về thiếu hoặc rỗng.

Giải pháp là **alias**: một cái tên trỏ tới index thật. Tạo index mới bên cạnh, import xong mới chuyển alias sang, rồi xóa index cũ.
```
Trước:   products (alias) ──> products_20261001...
Import:  products (alias) ──> products_20261001...    products_20261103... (đang import)
Sau:     products (alias) ──> products_20261103...
```
```ruby
# app/search/product_index.rb

def reindex!
  new_index = create_index
  import(new_index)

  old_indices = client.indices.exists_alias?(name: ALIAS) ? client.indices.get_alias(name: ALIAS).keys : []

  actions = old_indices.map { |index| { remove: { index:, alias: ALIAS } } }
  actions << { add: { index: new_index, alias: ALIAS } }
  client.indices.update_aliases(body: { actions: })

  old_indices.each { |index| client.indices.delete(index:) }
  new_index
end
```
Gỡ alias cũ và gắn alias mới nằm trong **cùng một request**, Elasticsearch thực hiện nguyên tử, không có khoảnh khắc nào alias trỏ vào hư không.
```ruby
# lib/tasks/search.rake

namespace :search do
  desc "Tạo index mới, import, chuyển alias"
  task reindex: :environment do
    puts "Đã chuyển sang #{ProductIndex.reindex!}"
  end
end
```
Lần đầu cài đặt cũng chỉ cần chạy <mark>bin/rails search:reindex</mark>.

Lưu ý: trong lúc import, nếu có sản phẩm thay đổi thì thay đổi đó được ghi vào index cũ (qua alias), index mới có thể bị thiếu. Với lượng dữ liệu vừa phải, có thể chạy lại job đồng bộ cho các sản phẩm có <mark>updated_at</mark> sau thời điểm bắt đầu reindex.

#### Giữ dữ liệu luôn cập nhật
Mỗi khi sản phẩm thay đổi, cập nhật lại document. Đặt trong job để:
- Elasticsearch chậm hay chết thì không làm lỗi request lưu sản phẩm.
- Có retry.

```ruby
# app/models/product.rb

class Product < ApplicationRecord
  belongs_to :brand
  belongs_to :category

  after_commit :sync_search_index

  private

  def sync_search_index
    ProductIndexJob.perform_later(id)
  end
end
```
```ruby
# app/jobs/product_index_job.rb

class ProductIndexJob < ApplicationJob
  queue_as :search
  retry_on Elastic::Transport::Transport::Error, wait: :polynomially_longer, attempts: 10

  def perform(product_id)
    product = Product.includes(:brand, :category).find_by(id: product_id)

    if product
      ProductIndex.client.index(
        index: ProductIndex::ALIAS, id: product.id, body: ProductIndex.document(product)
      )
    else
      ProductIndex.client.delete(index: ProductIndex::ALIAS, id: product_id)
    end
  rescue Elastic::Transport::Transport::Errors::NotFound
    # xóa document không tồn tại, bỏ qua
  end
end
```
Một job xử lý cả tạo, sửa và xóa: job **không tin dữ liệu được truyền vào**, mà đọc lại từ database tại thời điểm chạy. Nếu 2 job của cùng một sản phẩm chạy lệch thứ tự, cả 2 đều ghi trạng thái mới nhất, nên kết quả cuối cùng vẫn đúng.

#### Những chỗ callback không bắt được
- <mark>update_all</mark>, <mark>delete_all</mark>, <mark>insert_all</mark>, <mark>upsert_all</mark> không chạy callback. Sau khi gọi, phải tự đẩy job cho các id bị ảnh hưởng.
- Dữ liệu từ model khác: đổi tên brand "Samsung" thành "Samsung Electronics" thì mọi sản phẩm của brand đó phải index lại.

```ruby
# app/models/brand.rb

class Brand < ApplicationRecord
  has_many :products

  after_commit :reindex_products, if: :saved_change_to_name?

  private

  def reindex_products
    products.ids.each { |id| ProductIndexJob.perform_later(id) }
  end
end
```
Với hàng chục nghìn sản phẩm, gom lại thành job bulk theo batch sẽ tốt hơn đẩy từng job.
- Sửa thẳng trong database bằng SQL, hay chạy migration đổi dữ liệu: nhớ chạy reindex.

Dù cẩn thận tới đâu, theo thời gian vẫn có thể lệch. Tôi thường có thêm một job chạy mỗi đêm, so sánh số lượng (<mark>Product.count</mark> với <mark>client.count</mark>) và đồng bộ lại các sản phẩm có <mark>updated_at</mark> trong ngày.

#### Near real-time
Document vừa ghi chưa tìm thấy được ngay, mà sau lần **refresh** tiếp theo (mặc định mỗi giây). Trong production, điều này hoàn toàn ổn. Nhưng trong test, ghi xong tìm ngay sẽ không thấy. Truyền <mark>refresh: true</mark> khi ghi, hoặc gọi refresh trước khi tìm
```ruby
# test/test_helper.rb

def index_products(*products)
  products.each do |product|
    ProductIndex.client.index(index: ProductIndex::ALIAS, id: product.id,
                              body: ProductIndex.document(product))
  end
  ProductIndex.client.indices.refresh(index: ProductIndex::ALIAS)
end
```
Đừng dùng <mark>refresh: true</mark> trong production, mỗi lần refresh là tạo ra một segment mới, rất tốn tài nguyên khi ghi nhiều.

Ngược lại, khi import lượng lớn, có thể tắt refresh của index mới để import nhanh hơn, xong mới bật lại
```ruby
client.indices.put_settings(index: new_index, body: { index: { refresh_interval: "-1" } })
import(new_index)
client.indices.put_settings(index: new_index, body: { index: { refresh_interval: "1s" } })
```

#### Tóm tắt
- Đọc ghi qua **alias**, reindex bằng cách tạo index mới rồi chuyển alias.
- Import bằng **bulk**, luôn kiểm tra <mark>errors</mark>.
- Đồng bộ bằng <mark>after_commit</mark> + job, job đọc lại dữ liệu mới nhất từ database.
- Cẩn thận <mark>update_all</mark> và dữ liệu từ model liên quan.
- Elasticsearch là near real-time, test cần refresh.
