---
layout: post
title:  "106. Elasticsearch (Mapping & Analyzer)."
date:   2026-11-03 01:50:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_106/elasticsearch-mapping.png
---
Bài trước, tìm "dien thoai" không ra "Điện thoại". Để sửa, cần hiểu 2 thứ: **mapping** (field nào kiểu gì) và **analyzer** (chữ được xử lý thế nào trước khi vào index).

#### text và keyword
Đây là 2 kiểu dữ liệu chuỗi, và chọn sai là lỗi phổ biến nhất.

| | <mark>text</mark> | <mark>keyword</mark> |
|---|---|---|
| Có qua analyzer | Có: tách từ, viết thường... | Không, giữ nguyên cả chuỗi |
| <mark>"Điện thoại Samsung"</mark> được lưu là | <mark>điện</mark>, <mark>thoại</mark>, <mark>samsung</mark> | <mark>Điện thoại Samsung</mark> |
| Dùng cho | Tìm kiếm full-text | Lọc chính xác, sắp xếp, đếm (aggregation) |
| Ví dụ | Tên, mô tả sản phẩm | Brand, category, status, SKU, email |

Tìm "samsung" trong field <mark>keyword</mark> sẽ không ra, vì giá trị là cả chuỗi "Samsung" (chữ S hoa). Ngược lại, sắp xếp hay đếm theo field <mark>text</mark> thì không được, vì nó đã bị tách thành nhiều từ.

Các kiểu khác hay dùng: <mark>integer</mark>, <mark>long</mark>, <mark>float</mark>, <mark>scaled_float</mark>, <mark>boolean</mark>, <mark>date</mark>, <mark>geo_point</mark> (tọa độ, để tìm cửa hàng gần nhất), <mark>nested</mark> (mảng object).

#### Đừng dựa vào dynamic mapping
Bài trước, Elasticsearch tự đoán kiểu cho chúng ta. Nó đoán chuỗi là <mark>text</mark> kèm thêm một field con <mark>keyword</mark>, tốn gấp đôi chỗ. Tệ hơn, field đầu tiên nhận giá trị <mark>"123"</mark> sẽ bị đoán là <mark>text</mark>, sau này muốn lọc theo khoảng số thì không được.

Và quan trọng nhất: **mapping của một field đã tạo thì không sửa được**. Muốn đổi phải tạo index mới và đưa lại dữ liệu vào (bài 107 có cách làm không downtime).

Vì vậy, luôn **khai báo mapping trước**, và đặt <mark>"dynamic": "strict"</mark>: gửi lên field lạ thì báo lỗi, thay vì âm thầm tạo field mới.

#### Analyzer
Một analyzer gồm 3 phần, chạy theo thứ tự:
1. **Character filter** (không bắt buộc): xử lý chuỗi gốc, ví dụ bỏ thẻ HTML.
2. **Tokenizer**: tách chuỗi thành các từ (token). <mark>standard</mark> tách theo khoảng trắng và dấu câu.
3. **Token filter**: xử lý từng từ: viết thường, bỏ dấu, tạo từ đồng nghĩa...

Analyzer chạy **2 lần**: khi đưa document vào index, và khi tìm kiếm (với chuỗi người dùng gõ). Hai bên xử lý giống nhau thì mới khớp được với nhau.

#### Tìm không dấu
Token filter <mark>asciifolding</mark> chuyển ký tự có dấu về không dấu: <mark>điện</mark> thành <mark>dien</mark>. Với tùy chọn <mark>preserve_original</mark>, nó giữ cả bản gốc
```
PUT /products_v1
{
  "settings": {
    "analysis": {
      "filter": {
        "vi_folding": { "type": "asciifolding", "preserve_original": true }
      },
      "analyzer": {
        "vi_text": {
          "tokenizer": "standard",
          "filter": ["lowercase", "vi_folding"]
        }
      }
    }
  }
}
```
```
GET /products_v1/_analyze
{
  "analyzer": "vi_text",
  "text": "Điện thoại Samsung Galaxy"
}
```
```
["dien", "điện", "thoai", "thoại", "samsung", "galaxy"]
```
Giờ khách gõ "dien thoai" hay "điện thoại" đều khớp. Tại sao giữ bản gốc? Vì khi khách gõ **có dấu**, ví dụ "bàn", thì sản phẩm "Bàn làm việc" nên xếp trên "Bán lẻ ...". Có bản gốc, "bàn" khớp cả <mark>bàn</mark> lẫn <mark>ban</mark> nên điểm cao hơn "bán" chỉ khớp <mark>ban</mark>.

Lưu ý: tiếng Việt có nhiều từ ghép ("điện thoại", "máy tính"), mà tokenizer <mark>standard</mark> tách theo khoảng trắng nên "điện thoại" thành 2 từ riêng. Trong thực tế với tìm kiếm sản phẩm, điều này gần như không thành vấn đề, vì query <mark>match_phrase</mark> hoặc tăng điểm cho cụm từ ở bài 108 sẽ xử lý. Nếu cần tách từ tiếng Việt chuẩn hơn, có thể tìm hiểu plugin <mark>elasticsearch-analysis-vietnamese</mark>, nhưng nó phải cài vào Elasticsearch và kén version, tôi thường không dùng.

#### Multi-fields
Một field có thể được index theo **nhiều cách cùng lúc**. Tên sản phẩm cần: tìm full-text, sắp xếp theo ABC, và autocomplete (bài 110)
```json
"name": {
  "type": "text",
  "analyzer": "vi_text",
  "fields": {
    "raw": { "type": "keyword" },
    "autocomplete": {
      "type": "text",
      "analyzer": "vi_autocomplete",
      "search_analyzer": "vi_text"
    }
  }
}
```
Gửi lên một giá trị <mark>name</mark>, Elasticsearch tạo ra 3 field: <mark>name</mark>, <mark>name.raw</mark>, <mark>name.autocomplete</mark>.

#### Mapping hoàn chỉnh
Đặt vào code Ruby để dùng ở bài sau. Lưu ý field <mark>id</mark>: Elasticsearch 9 không cho sắp xếp theo <mark>_id</mark>, nên lưu thêm id dạng số để làm tiêu chí phụ khi sắp xếp (bài 109).
```ruby
# app/search/product_index.rb

class ProductIndex
  ALIAS = "products"

  SETTINGS = {
    number_of_shards: 1,
    number_of_replicas: Rails.env.production? ? 1 : 0,
    analysis: {
      filter: {
        vi_folding: { type: "asciifolding", preserve_original: true },
        autocomplete_filter: { type: "edge_ngram", min_gram: 1, max_gram: 20 }
      },
      analyzer: {
        vi_text: {
          tokenizer: "standard",
          filter: %w[lowercase vi_folding]
        },
        vi_autocomplete: {
          tokenizer: "standard",
          filter: %w[lowercase vi_folding autocomplete_filter]
        }
      }
    }
  }.freeze

  MAPPINGS = {
    dynamic: "strict",
    properties: {
      id:          { type: "long" },
      name:        {
        type: "text", analyzer: "vi_text",
        fields: {
          raw: { type: "keyword" },
          autocomplete: { type: "text", analyzer: "vi_autocomplete", search_analyzer: "vi_text" }
        }
      },
      description: { type: "text", analyzer: "vi_text" },
      brand:       { type: "keyword" },
      category:    { type: "keyword" },
      price:       { type: "long" },
      in_stock:    { type: "boolean" },
      rating:      { type: "float" },
      sold_count:  { type: "integer" },
      created_at:  { type: "date" }
    }
  }.freeze
end
```
Một vài lựa chọn đáng chú ý:
- <mark>brand</mark>, <mark>category</mark> là <mark>keyword</mark>: chỉ dùng để lọc và đếm.
- <mark>price</mark> là <mark>long</mark>: tiền VND không có số lẻ, và đừng bao giờ dùng <mark>float</mark> cho tiền.
- Không đưa vào những field không dùng để tìm/lọc/sắp xếp (ví dụ <mark>image_url</mark>, <mark>updated_by</mark>). Dữ liệu hiển thị sẽ lấy từ database.

#### Tóm tắt
- <mark>text</mark> để tìm kiếm, <mark>keyword</mark> để lọc, sắp xếp, đếm.
- Luôn khai báo mapping, <mark>dynamic: strict</mark>. Mapping không sửa được, muốn đổi phải tạo index mới.
- <mark>asciifolding</mark> với <mark>preserve_original</mark> để tìm được cả có dấu và không dấu.
- Dùng multi-fields khi một field cần nhiều cách tìm.
- Dùng <mark>_analyze</mark> để kiểm tra analyzer trước khi dùng.

Bài tiếp theo sẽ dùng mapping này để tạo index và đồng bộ dữ liệu từ Rails.
