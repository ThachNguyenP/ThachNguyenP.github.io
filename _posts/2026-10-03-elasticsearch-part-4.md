---
layout: post
title:  "108. Elasticsearch (Full-text search)."
date:   2026-10-03 01:54:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_108/elasticsearch-full-text.png
---
Dữ liệu đã vào index, giờ là lúc tìm kiếm. Các ví dụ dùng 6 sản phẩm sau

| id | name | brand | category | price |
|---|---|---|---|---|
| 1 | Điện thoại Samsung Galaxy S24 | Samsung | dien-thoai | 18.990.000 |
| 2 | Điện thoại iPhone 17 Pro | Apple | dien-thoai | 32.990.000 |
| 3 | Ốp lưng iPhone 17 Pro silicon | Apple | phu-kien | 590.000 |
| 4 | Tai nghe Sony WH-1000XM6 (hết hàng) | Sony | tai-nghe | 8.490.000 |
| 5 | Điện thoại Xiaomi Redmi Note 14 | Xiaomi | dien-thoai | 4.990.000 |
| 6 | Sạc nhanh Samsung 45W | Samsung | phu-kien | 690.000 |

Mô tả của sản phẩm 6 là "Củ sạc nhanh cho điện thoại Samsung Galaxy".

#### match
Query cơ bản nhất cho full-text. Chuỗi tìm kiếm đi qua analyzer, tách thành từng từ, rồi tìm document chứa **ít nhất một** từ.
```
GET /products/_search
{
  "query": {
    "match": { "name": "dien thoai samsung" }
  }
}
```
```
1  2.69  Điện thoại Samsung Galaxy S24
2  1.54  Điện thoại iPhone 17 Pro
5  1.45  Điện thoại Xiaomi Redmi Note 14
6  1.23  Sạc nhanh Samsung 45W
```
Gõ không dấu vẫn ra (nhờ analyzer bài 106), và sản phẩm khớp đủ 3 từ xếp đầu tiên. Số bên cạnh là <mark>_score</mark>, độ liên quan.

#### multi_match và boost
Tìm trên nhiều field cùng lúc, và cho field quan trọng hơn **trọng số cao hơn**: khớp ở tên quan trọng gấp 3 lần khớp ở mô tả.
```
GET /products/_search
{
  "query": {
    "multi_match": {
      "query": "điện thoại samsung",
      "fields": ["name^3", "description"]
    }
  }
}
```
```
1  9.59  Điện thoại Samsung Galaxy S24
2  6.15  Điện thoại iPhone 17 Pro
5  5.88  Điện thoại Xiaomi Redmi Note 14
6  4.76  Sạc nhanh Samsung 45W
3  3.05  Ốp lưng iPhone 17 Pro silicon
```
Ốp lưng iPhone lọt vào vì mô tả có chữ "điện thoại". Với ô tìm kiếm của shop, thường thì khách muốn **khớp hết các từ**
```json
"multi_match": {
  "query": "điện thoại samsung",
  "fields": ["name^3", "description"],
  "operator": "and"
}
```
```
1  9.59  Điện thoại Samsung Galaxy S24
6  4.76  Sạc nhanh Samsung 45W
```
Sản phẩm 6 vẫn ra vì mô tả của nó có đủ cả 3 từ. Điều này hợp lý: khách tìm điện thoại Samsung thì gợi ý thêm củ sạc Samsung cũng không tệ, và nó xếp sau.

<mark>and</mark> có nhược điểm: gõ thừa một từ không có trong sản phẩm là ra 0 kết quả. Cách ở giữa là <mark>"minimum_should_match": "75%"</mark>: phải khớp ít nhất 3/4 số từ.

#### Sai chính tả
Thêm <mark>fuzziness</mark>, Elasticsearch chấp nhận từ sai vài ký tự
```json
"multi_match": {
  "query": "samsng galaxi",
  "fields": ["name^3", "description"],
  "fuzziness": "AUTO"
}
```
```
1  7.16  Điện thoại Samsung Galaxy S24
6  3.08  Sạc nhanh Samsung 45W
```
<mark>AUTO</mark> nghĩa là: từ 1 - 2 ký tự phải đúng hoàn toàn, 3 - 5 ký tự được sai 1, từ 6 ký tự trở lên được sai 2. Đây là lựa chọn hợp lý, đặt số cố định lớn quá sẽ ra rất nhiều kết quả rác.

#### bool query
Thực tế, ô tìm kiếm luôn đi kèm điều kiện: đúng danh mục, trong khoảng giá, còn hàng... <mark>bool</mark> kết hợp nhiều query lại với nhau

| Mệnh đề | Ý nghĩa | Ảnh hưởng điểm |
|---|---|---|
| <mark>must</mark> | Phải khớp | Có |
| <mark>filter</mark> | Phải khớp | **Không**, và được cache |
| <mark>should</mark> | Khớp thì cộng điểm | Có |
| <mark>must_not</mark> | Không được khớp | Không |

```
GET /products/_search
{
  "query": {
    "bool": {
      "must": [
        { "multi_match": { "query": "điện thoại", "fields": ["name^3", "description"] } }
      ],
      "filter": [
        { "term":  { "category": "dien-thoai" } },
        { "range": { "price": { "gte": 5000000, "lte": 40000000 } } },
        { "term":  { "in_stock": true } }
      ]
    }
  }
}
```
```
1  6.15  Điện thoại Samsung Galaxy S24
2  6.15  Điện thoại iPhone 17 Pro
```
Quy tắc: **thứ khách gõ vào ô tìm kiếm** để ở <mark>must</mark>, **mọi điều kiện lọc** (checkbox, khoảng giá, danh mục) để ở <mark>filter</mark>. Filter không tính điểm nên nhanh hơn, và được cache lại cho lần sau.

Lưu ý <mark>term</mark> dùng cho field <mark>keyword</mark>, tìm **chính xác**. Dùng <mark>term</mark> trên field <mark>text</mark> là lỗi kinh điển: <mark>{"term": {"name": "Samsung"}}</mark> không ra gì, vì trong index chỉ có <mark>samsung</mark> viết thường.

<mark>should</mark> dùng để **ưu tiên** mà không loại bỏ. Ví dụ: tên chứa nguyên cụm từ khách gõ thì xếp trên
```json
"should": [
  { "match_phrase": { "name": { "query": "điện thoại samsung", "boost": 2 } } }
]
```

#### Highlight
Tô đậm từ khóa trong kết quả, giống Google
```
GET /products/_search
{
  "query": { "match": { "description": "pin" } },
  "highlight": {
    "fields": { "description": {} }
  }
}
```
```json
"highlight": {
  "description": ["Giá rẻ, <em>pin</em> 5500mAh, sạc nhanh"]
}
```
Nhớ escape HTML trước khi hiển thị nếu dữ liệu do người dùng nhập, hoặc dùng <mark>pre_tags</mark>/<mark>post_tags</mark> và chỉ cho phép đúng thẻ đó.

#### Viết trong Rails
Gom logic tìm kiếm vào một class
```ruby
# app/search/product_search.rb

class ProductSearch
  PER_PAGE = 24

  def initialize(params)
    @q = params[:q].to_s.strip
    @category = params[:category].presence
    @min_price = params[:min_price].presence&.to_i
    @max_price = params[:max_price].presence&.to_i
    @page = [params[:page].to_i, 1].max
  end

  def results
    response = ProductIndex.client.search(index: ProductIndex::ALIAS, body:)
    ids = response["hits"]["hits"].map { |hit| hit["_id"].to_i }

    Result.new(
      products: Product.where(id: ids).in_order_of(:id, ids),
      total: response["hits"]["total"]["value"],
      page: @page
    )
  end

  private

  def body
    {
      query: { bool: { must: must, filter: filters } },
      from: (@page - 1) * PER_PAGE,
      size: PER_PAGE,
      _source: false # chỉ cần id
    }
  end

  def must
    return [{ match_all: {} }] if @q.blank?

    [{
      multi_match: {
        query: @q,
        fields: %w[name^3 description],
        fuzziness: "AUTO",
        minimum_should_match: "75%"
      }
    }]
  end

  def filters
    filters = []
    filters << { term: { category: @category } } if @category
    filters << { range: { price: { gte: @min_price, lte: @max_price }.compact } } if @min_price || @max_price
    filters
  end

  Result = Data.define(:products, :total, :page) do
    def total_pages = (total.to_f / PER_PAGE).ceil
  end
end
```
```ruby
# app/controllers/products_controller.rb

def index
  @result = ProductSearch.new(params).results
end
```
Vài điểm đáng chú ý:
- <mark>_source: false</mark>: Elasticsearch chỉ trả về id, response nhỏ và nhanh hơn. Dữ liệu hiển thị (giá, tồn kho) lấy từ database nên luôn mới nhất.
- <mark>in_order_of(:id, ids)</mark> (Rails 7+): giữ đúng thứ tự xếp hạng của Elasticsearch. <mark>where(id: ids)</mark> một mình sẽ trả về theo thứ tự bất kỳ.
- Nếu một sản phẩm vừa bị xóa mà index chưa cập nhật, <mark>where</mark> tự bỏ qua, không raise lỗi như <mark>find</mark>.
- Mọi giá trị từ người dùng được đưa vào dưới dạng **dữ liệu** trong JSON, không ghép chuỗi, nên không có chuyện injection như SQL.

#### Phân trang
<mark>from</mark>/<mark>size</mark> có giới hạn: <mark>from + size</mark> không được vượt quá **10.000**. Lý do: muốn lấy kết quả thứ 10.000, mỗi shard phải sắp xếp 10.000 kết quả đầu rồi gửi về để gộp lại, rất tốn.

Với giao diện người dùng thì đây không phải vấn đề, không ai lật tới trang 400. Chỉ cần giới hạn số trang tối đa. Nếu cần duyệt **toàn bộ** kết quả (xuất file, infinite scroll), dùng <mark>search_after</mark>, sẽ nói ở bài 109.

#### Tóm tắt
- <mark>match</mark>/<mark>multi_match</mark> cho ô tìm kiếm, boost field quan trọng với <mark>^</mark>.
- <mark>operator</mark> hoặc <mark>minimum_should_match</mark> để kiểm soát số từ phải khớp. <mark>fuzziness: AUTO</mark> cho lỗi chính tả.
- <mark>bool</mark>: từ khóa ở <mark>must</mark>, điều kiện lọc ở <mark>filter</mark>, ưu tiên ở <mark>should</mark>.
- <mark>term</mark> chỉ dùng cho <mark>keyword</mark>, số, boolean.
- Lấy id từ Elasticsearch, lấy dữ liệu từ database.
