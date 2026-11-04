---
layout: post
title:  "109. Elasticsearch (Filter, Facet & Sort)."
date:   2026-11-03 01:56:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_109/elasticsearch-facet.png
---
Trang danh sách sản phẩm của các sàn TMĐT có cột bên trái: **Thương hiệu** Samsung (12), Apple (8)... **Khoảng giá** Dưới 5 triệu (20)... Con số trong ngoặc thay đổi theo từ khóa và các bộ lọc đang chọn. Làm bằng SQL thì mỗi nhóm một câu <mark>GROUP BY</mark>, chậm và phức tạp. Với Elasticsearch, tất cả nằm trong **một request**, nhờ **aggregation**.

#### Aggregation
Đếm theo thương hiệu, theo khoảng giá, và tính giá trung bình cho các kết quả tìm "điện thoại"
```
GET /products/_search
{
  "size": 0,
  "query": { "match": { "name": "điện thoại" } },
  "aggs": {
    "brands": {
      "terms": { "field": "brand" }
    },
    "price_ranges": {
      "range": {
        "field": "price",
        "ranges": [
          { "key": "Dưới 5 triệu",  "to": 5000000 },
          { "key": "5 - 20 triệu",  "from": 5000000, "to": 20000000 },
          { "key": "Trên 20 triệu", "from": 20000000 }
        ]
      }
    },
    "avg_price": { "avg": { "field": "price" } }
  }
}
```
```json
"aggregations": {
  "brands": {
    "buckets": [
      { "key": "Apple",   "doc_count": 1 },
      { "key": "Samsung", "doc_count": 1 },
      { "key": "Xiaomi",  "doc_count": 1 }
    ]
  },
  "price_ranges": {
    "buckets": [
      { "key": "Dưới 5 triệu",  "to": 5000000.0, "doc_count": 1 },
      { "key": "5 - 20 triệu",  "from": 5000000.0, "to": 20000000.0, "doc_count": 1 },
      { "key": "Trên 20 triệu", "from": 20000000.0, "doc_count": 1 }
    ]
  },
  "avg_price": { "value": 18990000.0 }
}
```
<mark>"size": 0</mark>: chỉ lấy số liệu, không lấy sản phẩm. Aggregation luôn tính trên **toàn bộ** kết quả khớp query, không chỉ trang hiện tại.

Một số aggregation hay dùng:

| Loại | Dùng cho |
|---|---|
| <mark>terms</mark> | Đếm theo giá trị: brand, category, màu sắc. Mặc định trả về 10 nhóm nhiều nhất, đổi bằng <mark>size</mark> |
| <mark>range</mark> | Đếm theo khoảng: giá, đánh giá |
| <mark>date_histogram</mark> | Đếm theo ngày/tuần/tháng: đơn hàng theo ngày, dùng cho báo cáo |
| <mark>avg</mark>, <mark>min</mark>, <mark>max</mark>, <mark>sum</mark>, <mark>stats</mark> | Số liệu: giá thấp nhất, cao nhất để vẽ thanh trượt giá |
| <mark>cardinality</mark> | Đếm số giá trị khác nhau (gần đúng): bao nhiêu khách đã mua |

Aggregation chỉ chạy được trên field <mark>keyword</mark>, số, ngày, boolean. Chạy trên field <mark>text</mark> sẽ báo lỗi, đây là lý do <mark>brand</mark> là <mark>keyword</mark> ở bài 106.

#### post_filter cho facet
Khách tìm "điện thoại" rồi tick chọn **Samsung**. Nếu đưa điều kiện brand vào <mark>filter</mark> như bài 108, aggregation brand cũng bị lọc theo, chỉ còn mỗi "Samsung (1)". Khách không thấy các brand khác để chọn thêm.

<mark>post_filter</mark> giải quyết chuyện này: nó lọc **kết quả trả về** nhưng chạy **sau** aggregation
```
GET /products/_search
{
  "query": { "match": { "name": "điện thoại" } },
  "post_filter": { "term": { "brand": "Samsung" } },
  "aggs": {
    "brands": { "terms": { "field": "brand" } }
  }
}
```
```
hits: 1  Điện thoại Samsung Galaxy S24
brands: Apple (1), Samsung (1), Xiaomi (1)
```
Danh sách chỉ có Samsung, nhưng cột lọc vẫn hiện đủ các brand.

Khi có nhiều nhóm lọc (brand và khoảng giá), quy tắc chuẩn là: số đếm của mỗi nhóm bị ảnh hưởng bởi **các nhóm khác**, nhưng không bởi **chính nó**. Làm được bằng cách bọc từng aggregation trong một <mark>filter</mark> aggregation, sẽ thấy trong code bên dưới.

#### Sắp xếp
Mặc định sắp xếp theo <mark>_score</mark>. Sắp xếp theo giá
```
GET /products/_search
{
  "query": { "term": { "category": "dien-thoai" } },
  "sort": [
    { "price": "asc" },
    { "id": "asc" }
  ]
}
```
Luôn thêm một tiêu chí phụ **duy nhất** (<mark>id</mark>) ở cuối. Nếu 2 sản phẩm cùng giá, thứ tự giữa chúng không cố định, sang trang 2 có thể gặp lại sản phẩm đã thấy ở trang 1. Elasticsearch 9 không cho sắp xếp theo <mark>_id</mark> (báo lỗi <mark>Fielddata access on the _id field is disallowed</mark>), đó là lý do mapping ở bài 106 có thêm field <mark>id</mark>.

Sắp xếp theo tên thì dùng <mark>name.raw</mark> (keyword), không dùng <mark>name</mark> (text).

#### search_after
Như bài 108, <mark>from</mark> không vượt quá 10.000. Để duyệt sâu hơn (infinite scroll, xuất toàn bộ), dùng <mark>search_after</mark>: thay vì "bỏ qua N kết quả", nói "lấy tiếp sau kết quả này". Mỗi hit trả về có mảng <mark>sort</mark>
```
5  Điện thoại Xiaomi Redmi Note 14   sort: [4990000, 5]
1  Điện thoại Samsung Galaxy S24     sort: [18990000, 1]
```
Lấy trang tiếp theo bằng giá trị <mark>sort</mark> của kết quả cuối cùng
```
GET /products/_search
{
  "query": { "term": { "category": "dien-thoai" } },
  "sort": [{ "price": "asc" }, { "id": "asc" }],
  "size": 2,
  "search_after": [18990000, 1]
}
```
```
2  Điện thoại iPhone 17 Pro          sort: [32990000, 2]
```
Đây cũng là cách làm cursor pagination cho API. Nếu dữ liệu thay đổi trong lúc duyệt mà cần kết quả nhất quán (ví dụ xuất báo cáo), kết hợp thêm **point in time** (<mark>POST /products/_pit?keep_alive=1m</mark>) để cố định dữ liệu tại một thời điểm.

#### Xếp hạng theo độ phổ biến
Hai điện thoại cùng khớp từ khóa, cái bán được 7.000 chiếc nên xếp trên cái bán 1.200 chiếc. Sản phẩm hết hàng nên xếp xuống dưới, nhưng không ẩn đi. <mark>function_score</mark> cho phép điều chỉnh điểm
```
GET /products/_search
{
  "query": {
    "function_score": {
      "query": { "match": { "name": "điện thoại" } },
      "functions": [
        {
          "field_value_factor": { "field": "sold_count", "modifier": "log1p" }
        },
        {
          "filter": { "term": { "in_stock": false } },
          "weight": 0.1
        }
      ],
      "boost_mode": "multiply"
    }
  }
}
```
```
5  7.54  Điện thoại Xiaomi Redmi Note 14   (bán 7.000)
2  7.13  Điện thoại iPhone 17 Pro          (bán 3.000)
1  6.31  Điện thoại Samsung Galaxy S24     (bán 1.200)
```
<mark>log1p</mark> (log(1 + x)) rất quan trọng: không có nó, sản phẩm bán 100.000 chiếc sẽ có điểm gấp 100 lần sản phẩm bán 1.000 chiếc, độ liên quan với từ khóa trở nên vô nghĩa. Với log, chênh lệch được nén lại, độ phổ biến chỉ là yếu tố phụ.

Chỉnh điểm là việc cần thử nghiệm nhiều, nên đặt các hệ số vào config để dễ thay đổi, và đo kết quả bằng tỷ lệ khách click vào kết quả tìm kiếm.

#### Ghép vào ProductSearch
Mở rộng class ở bài 108, thêm lọc theo brand, sắp xếp và facet
```ruby
# app/search/product_search.rb

class ProductSearch
  SORTS = {
    "relevance"  => [{ _score: "desc" }, { id: "asc" }],
    "price_asc"  => [{ price: "asc" }, { id: "asc" }],
    "price_desc" => [{ price: "desc" }, { id: "asc" }],
    "newest"     => [{ created_at: "desc" }, { id: "asc" }]
  }.freeze

  PRICE_RANGES = [
    { key: "under_5m", to: 5_000_000 },
    { key: "5m_20m", from: 5_000_000, to: 20_000_000 },
    { key: "over_20m", from: 20_000_000 }
  ].freeze

  def initialize(params)
    # ... như bài 108
    @brands = Array(params[:brands]).compact_blank
    @sort = SORTS.key?(params[:sort]) ? params[:sort] : "relevance"
  end

  private

  def body
    {
      query: scored_query,
      post_filter: { bool: { filter: facet_filters.values.flatten } },
      aggs: aggregations,
      sort: SORTS[@sort],
      from: (@page - 1) * PER_PAGE,
      size: PER_PAGE,
      _source: false
    }
  end

  # từ khóa + các bộ lọc không phải facet (category)
  def scored_query
    {
      function_score: {
        query: { bool: { must:, filter: filters } },
        functions: [
          { field_value_factor: { field: "sold_count", modifier: "log1p" } },
          { filter: { term: { in_stock: false } }, weight: 0.1 }
        ],
        boost_mode: "multiply"
      }
    }
  end

  # chỉ còn category, khoảng giá đã chuyển sang facet_filters
  def filters
    @category ? [{ term: { category: @category } }] : []
  end

  # các bộ lọc có facet, áp dụng qua post_filter
  def facet_filters
    {
      brand: @brands.any? ? [{ terms: { brand: @brands } }] : [],
      price: @min_price || @max_price ? [{ range: { price: { gte: @min_price, lte: @max_price }.compact } }] : []
    }
  end

  # mỗi facet bị lọc bởi các facet khác, trừ chính nó
  def aggregations
    {
      brands: {
        filter: { bool: { filter: facet_filters.except(:brand).values.flatten } },
        aggs: { values: { terms: { field: "brand", size: 30 } } }
      },
      prices: {
        filter: { bool: { filter: facet_filters.except(:price).values.flatten } },
        aggs: { values: { range: { field: "price", ranges: PRICE_RANGES } } }
      }
    }
  end
end
```
Đọc kết quả facet từ response
```ruby
response["aggregations"]["brands"]["values"]["buckets"]
# => [{"key"=>"Apple", "doc_count"=>1}, {"key"=>"Samsung", "doc_count"=>1}, ...]
```
Một vài chú ý:
- <mark>@sort</mark> chỉ nhận giá trị trong <mark>SORTS</mark>, không bao giờ đưa thẳng tên field từ params vào query.
- <mark>terms</mark> (số nhiều) nhận một mảng giá trị, tương đương <mark>IN</mark> trong SQL: chọn Samsung **hoặc** Apple.
- Category là bộ lọc "điều hướng" (đang ở trang danh mục điện thoại), không có facet nên để trong <mark>filter</mark> bình thường.

#### Tóm tắt
- **Aggregation** để đếm, thống kê, chạy cùng request tìm kiếm.
- **post_filter** để lọc kết quả mà không làm ảnh hưởng facet. Mỗi facet bị lọc bởi các facet khác.
- Sắp xếp luôn có tiêu chí phụ duy nhất. Duyệt sâu dùng **search_after**.
- **function_score** để đưa độ phổ biến, tồn kho vào xếp hạng, nhớ dùng <mark>log1p</mark>.
