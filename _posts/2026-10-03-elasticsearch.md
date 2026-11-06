---
layout: post
title:  "105. Elasticsearch (Khái niệm & Cài đặt)."
date:   2026-10-03 01:48:00 +0700
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_105/elasticsearch-intro.png
---
Ô tìm kiếm của shop thường bắt đầu như thế này
```ruby
Product.where("name ILIKE ?", "%#{params[:q]}%")
```
Chạy được một thời gian, rồi khách bắt đầu phàn nàn:
- Gõ "**dien thoai**" (không dấu) thì không ra "Điện thoại".
- Gõ sai chính tả "**samsng**" thì không ra gì.
- Gõ "**điện thoại samsung**" thì không ra "Điện thoại Samsung Galaxy S24" vì 2 từ không đứng liền nhau.
- Kết quả không có thứ tự: sản phẩm khớp ở tên và khớp ở mô tả xếp lẫn lộn.
- 1 triệu sản phẩm, <mark>LIKE '%...%'</mark> không dùng được index, mỗi lần tìm quét cả bảng.

Đó là lúc cần một **search engine**, và phổ biến nhất là **Elasticsearch**. Series này đi qua những trường hợp hay gặp nhất: tìm kiếm full-text, tìm không dấu, lọc, đếm theo nhóm (facet), sắp xếp, gợi ý khi gõ.

Version sử dụng: Elasticsearch 9, Ruby 3.4, Rails 8, gem <mark>elasticsearch</mark> 9.

#### Inverted index
Bí mật của Elasticsearch (và mọi search engine) là **inverted index**, giống phần "mục lục từ khóa" ở cuối sách. Thay vì lưu "document 1 chứa những từ nào", nó lưu "từ này nằm ở những document nào".

Với 3 sản phẩm
```
1: Điện thoại Samsung Galaxy S24
2: Điện thoại iPhone 17 Pro
3: Ốp lưng iPhone 17 Pro
```
Inverted index sẽ là
```
điện    -> 1, 2
thoại   -> 1, 2
samsung -> 1
galaxy  -> 1
iphone  -> 2, 3
pro     -> 2, 3
ốp      -> 3
...
```
Tìm "iphone pro" chỉ cần tra 2 dòng <mark>iphone</mark> và <mark>pro</mark>, lấy giao/hợp, không cần quét từng sản phẩm. Từ đó cũng tính được **độ liên quan** (score): document chứa nhiều từ khóa hơn, từ khóa hiếm hơn, field ngắn hơn thì điểm cao hơn (thuật toán BM25).

Trước khi đưa vào index, chữ được xử lý qua **analyzer**: tách từ, viết thường, bỏ dấu... Đây là chỗ giải quyết bài toán "dien thoai", nội dung chính của bài 106.

#### Các khái niệm
So sánh với database quen thuộc

| Elasticsearch | PostgreSQL | Ghi chú |
|---|---|---|
| Index | Table | Ví dụ index <mark>products</mark> |
| Document | Row | Một JSON object |
| Field | Column | |
| Mapping | Schema | Kiểu dữ liệu và cách phân tích từng field |
| <mark>_id</mark> | Primary key | |

Thêm vài khái niệm về hạ tầng:
- **Node**: một server chạy Elasticsearch. Nhiều node tạo thành **cluster**.
- **Shard**: một index được chia thành nhiều phần nhỏ, nằm rải trên các node, để chứa được nhiều dữ liệu hơn một máy và tìm kiếm song song.
- **Replica**: bản sao của shard nằm trên node khác. Một node chết vẫn còn bản sao, và replica cũng phục vụ được request tìm kiếm.

#### Cài đặt
Dùng Docker cho môi trường development. Kibana là giao diện web để xem dữ liệu và chạy thử query, rất tiện khi học.
```yaml
# docker-compose.yml

services:
  elasticsearch:
    image: docker.elastic.co/elasticsearch/elasticsearch:9.0.0
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false # chỉ dùng ở local
      - ES_JAVA_OPTS=-Xms1g -Xmx1g
    ports:
      - "9200:9200"
    volumes:
      - es_data:/usr/share/elasticsearch/data

  kibana:
    image: docker.elastic.co/kibana/kibana:9.0.0
    environment:
      - ELASTICSEARCH_HOSTS=http://elasticsearch:9200
    ports:
      - "5601:5601"
    depends_on:
      - elasticsearch

volumes:
  es_data:
```
```sh
docker compose up -d
curl localhost:9200
```
```json
{
  "name" : "a1b2c3",
  "cluster_name" : "docker-cluster",
  "version" : {
    "number" : "9.0.0",
    ...
  },
  "tagline" : "You Know, for Search"
}
```
Mở <mark>http://localhost:5601</mark>, vào **Dev Tools**, đây là nơi chạy thử các query trong series.

#### Thử vài lệnh
Elasticsearch giao tiếp hoàn toàn bằng REST API + JSON. Thêm một document
```
PUT /products_demo/_doc/1
{
  "name": "Điện thoại Samsung Galaxy S24",
  "price": 18990000
}
```
Chưa tạo index, chưa khai báo mapping, Elasticsearch vẫn tự tạo hết (**dynamic mapping**). Rất tiện để thử, nhưng ở bài 106 chúng ta sẽ thấy không nên dựa vào nó.

Lấy lại theo id
```
GET /products_demo/_doc/1
```
Tìm kiếm
```
GET /products_demo/_search
{
  "query": {
    "match": { "name": "samsung" }
  }
}
```
```json
{
  "hits": {
    "total": { "value": 1, "relation": "eq" },
    "hits": [
      {
        "_id": "1",
        "_score": 0.2876821,
        "_source": { "name": "Điện thoại Samsung Galaxy S24", "price": 18990000 }
      }
    ]
  }
}
```
Thử tìm <mark>"dien thoai"</mark> sẽ không ra kết quả nào. Lý do nằm ở analyzer mặc định
```
GET /_analyze
{
  "analyzer": "standard",
  "text": "Điện thoại Samsung Galaxy S24, 256GB!"
}
```
```
["điện", "thoại", "samsung", "galaxy", "s24", "256gb"]
```
Nó đã tách từ, bỏ dấu câu, viết thường, nhưng vẫn giữ dấu tiếng Việt. Bài sau sẽ sửa chuyện này.

#### Elasticsearch không phải database chính
Một nguyên tắc quan trọng: **PostgreSQL/MySQL vẫn là nơi lưu dữ liệu gốc**, Elasticsearch chỉ là **bản sao** được tối ưu cho việc tìm kiếm.
- Elasticsearch không có transaction, không có foreign key.
- Dữ liệu mới ghi vào cần khoảng **1 giây** mới tìm thấy được (near real-time).
- Index hỏng hay cần đổi cấu trúc thì xóa đi, **đồng bộ lại** từ database.

Flow chuẩn: tìm kiếm trên Elasticsearch để lấy danh sách id, rồi lấy dữ liệu đầy đủ (giá mới nhất, tồn kho) từ database. Bài 107 sẽ đi vào chi tiết.

#### Khi nào không cần Elasticsearch
Elasticsearch là thêm một hệ thống phải vận hành, tốn RAM (tối thiểu vài GB), phải đồng bộ dữ liệu. Nếu:
- Dữ liệu ít (vài chục nghìn record).
- Chỉ cần tìm theo tên đơn giản.

thì full-text search của PostgreSQL (bài 019, gem <mark>pg_search</mark>) kết hợp extension <mark>unaccent</mark> là đủ. Elasticsearch đáng dùng khi dữ liệu lớn, cần tìm kiếm thông minh (sai chính tả, gợi ý, xếp hạng), hoặc cần lọc và đếm theo nhiều tiêu chí cùng lúc như trang danh sách sản phẩm.

#### Nội dung series

| Bài | Nội dung |
|---|---|
| 105 | Khái niệm & Cài đặt |
| 106 | Mapping & Analyzer (tìm không dấu) |
| 107 | Đồng bộ dữ liệu từ Rails |
| 108 | Full-text search |
| 109 | Filter, Facet & Sort |
| 110 | Autocomplete, Gợi ý & Production |
