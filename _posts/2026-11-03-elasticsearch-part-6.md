---
layout: post
title:  "110. Elasticsearch (Autocomplete, Gợi ý & Production)."
date:   2026-11-03 01:58:00 +0700
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_110/elasticsearch-autocomplete.png
---
Bài cuối của series gồm 2 phần: hai tính năng làm ô tìm kiếm "thông minh" hơn (gợi ý khi đang gõ, "có phải bạn muốn tìm"), và những điều cần biết khi đưa Elasticsearch lên production.

#### Autocomplete
Khách gõ "ip", ô tìm kiếm hiện ngay "iPhone 17 Pro", "Ốp lưng iPhone 17 Pro". <mark>match</mark> bình thường không làm được, vì trong index chỉ có từ <mark>iphone</mark>, không có <mark>ip</mark>.

Giải pháp là **edge n-gram**: khi index, mỗi từ được cắt thêm thành các tiền tố. Đây chính là analyzer <mark>vi_autocomplete</mark> đã khai báo ở bài 106
```
GET /products/_analyze
{
  "analyzer": "vi_autocomplete",
  "text": "Điện thoại"
}
```
```
["d", "di", "die", "dien", "đ", "đi", "điệ", "điện",
 "t", "th", "tho", "thoa", "thoai", "t", "th", "tho", "thoạ", "thoại"]
```
Vì đã có sẵn tất cả các tiền tố trong index, tìm theo tiền tố chỉ là tra từ điển bình thường, rất nhanh.

Để ý mapping ở bài 106: field <mark>name.autocomplete</mark> có <mark>"search_analyzer": "vi_text"</mark>. Tức là chỉ cắt n-gram lúc **index**, còn chuỗi khách gõ thì **không** cắt. Nếu cắt cả 2 bên, gõ "iphone" sẽ thành <mark>i</mark>, <mark>ip</mark>, <mark>iph</mark>... và khớp với mọi từ bắt đầu bằng chữ "i".
```
GET /products/_search
{
  "query": {
    "match": {
      "name.autocomplete": { "query": "dien thoai sa", "operator": "and" }
    }
  },
  "_source": ["name"],
  "size": 5
}
```
```
1  Điện thoại Samsung Galaxy S24
```
Gõ không dấu, gõ dở dang từ cuối, vẫn ra đúng.

Trong Rails, autocomplete được gọi liên tục mỗi lần gõ phím, nên cần nhẹ nhất có thể
```ruby
# app/controllers/autocompletes_controller.rb

class AutocompletesController < ApplicationController
  def show
    q = params[:q].to_s.strip
    return render(json: []) if q.length < 2

    response = ProductIndex.client.search(
      index: ProductIndex::ALIAS,
      body: {
        query: {
          function_score: {
            query: { match: { "name.autocomplete": { query: q, operator: "and" } } },
            functions: [{ field_value_factor: { field: "sold_count", modifier: "log1p" } }]
          }
        },
        _source: %w[id name],
        size: 8
      }
    )

    render json: response["hits"]["hits"].map { |hit| hit["_source"] }
  end
end
```
- Ở đây lấy <mark>_source</mark> trực tiếp, không query database, vì chỉ cần tên để hiển thị.
- Phía FE nhớ **debounce** (chờ khách ngừng gõ khoảng 200ms mới gọi), và hủy request cũ khi có request mới.
- Ưu tiên sản phẩm bán chạy bằng <mark>function_score</mark> như bài 109.

Elasticsearch còn có field type <mark>search_as_you_type</mark> và <mark>completion</mark> suggester làm cùng việc này. <mark>completion</mark> nhanh nhất nhưng chỉ khớp từ **đầu chuỗi** (gõ "samsung" không ra "Điện thoại Samsung"), nên với tìm sản phẩm tôi thích edge n-gram hơn.

#### Có phải bạn muốn tìm
Khách gõ "samsng galaxi". Bài 108 đã dùng <mark>fuzziness</mark> để vẫn ra kết quả, nhưng hiển thị thêm câu "Có phải bạn muốn tìm: **samsung galaxy**" sẽ tốt hơn. Dùng **term suggester**
```
GET /products/_search
{
  "size": 0,
  "suggest": {
    "fix": {
      "text": "samsng galaxi",
      "term": { "field": "name" }
    }
  }
}
```
```json
"suggest": {
  "fix": [
    { "text": "samsng", "options": [{ "text": "samsung", "score": 0.83, "freq": 2 }] },
    { "text": "galaxi", "options": [{ "text": "galaxy",  "score": 0.83, "freq": 1 }] }
  ]
}
```
Ghép lại các option đầu tiên thành câu gợi ý. Từ nào đã đúng thì không có option, giữ nguyên
```ruby
def did_you_mean(response)
  suggestion = response["suggest"]["fix"].map do |part|
    part["options"].first&.dig("text") || part["text"]
  end.join(" ")

  suggestion unless suggestion == @q.downcase
end
```
Gợi ý được lấy từ chính các từ có trong dữ liệu sản phẩm, nên luôn là từ "có nghĩa" với shop. Chỉ nên hiện khi kết quả tìm kiếm ít hoặc bằng 0.

#### Production: shard và replica
- **Shard**: mỗi shard nên từ **10 - 50GB**. Một shop vài trăm nghìn sản phẩm chỉ khoảng vài GB, **1 shard** là đủ và nhanh nhất. Nhiều shard nhỏ là lỗi phổ biến: mỗi shard tốn RAM, mỗi query phải hỏi tất cả shard rồi gộp lại. Số shard không đổi được sau khi tạo index (lại phải reindex), nhưng nhờ alias ở bài 107 nên việc này không khó.
- **Replica**: ít nhất **1** trong production, để một node chết không mất dữ liệu và vẫn tìm kiếm được. Muốn vậy cluster cần ít nhất 2 node, tốt nhất là 3.
- **RAM**: Elasticsearch dùng heap của JVM, đặt khoảng **một nửa RAM** của máy và không quá ~30GB. Nửa còn lại để hệ điều hành cache file index, phần này quan trọng không kém.

Nếu không muốn tự vận hành, dùng dịch vụ có sẵn: Elastic Cloud hoặc Amazon OpenSearch Service (OpenSearch là bản tách ra từ Elasticsearch 7.10, query cơ bản giống nhau nhưng client và tính năng mới đã khác nhau nhiều).

#### Production: bảo mật
Ở local chúng ta tắt security cho tiện, production thì **bắt buộc bật**. Đã có rất nhiều vụ lộ dữ liệu vì Elasticsearch mở ra internet không có mật khẩu.
- **Không bao giờ** cho FE/mobile gọi thẳng Elasticsearch. Mọi request đi qua Rails, Rails quyết định được query gì.
- Elasticsearch chỉ nằm trong mạng nội bộ, không public port 9200.
- Bật xác thực và TLS, Rails kết nối bằng **API key** chỉ có quyền trên index cần dùng

```ruby
# config/initializers/elasticsearch.rb

ELASTICSEARCH = Elasticsearch::Client.new(
  url: ENV.fetch("ELASTICSEARCH_URL"),       # https://...
  api_key: ENV.fetch("ELASTICSEARCH_API_KEY"),
  retry_on_failure: 3,
  request_timeout: 5
)
```
- Giới hạn độ dài từ khóa (ví dụ 100 ký tự), số facet được chọn, số trang tối đa, để không ai gửi những query khổng lồ làm chậm cả cluster. Kết hợp với <mark>rate_limit</mark> (series Bot & Abuse).

#### Production: khi Elasticsearch gặp sự cố
Elasticsearch chết thì không nên làm chết cả trang web. Bắt lỗi và có phương án dự phòng
```ruby
def results
  search_elasticsearch
rescue Elastic::Transport::Transport::Error => e # gồm cả lỗi không kết nối được
  Rails.error.report(e)
  fallback_to_database # ví dụ ILIKE đơn giản, giới hạn số kết quả
end
```
Kết quả kém hơn một chút vẫn tốt hơn trang lỗi 500. Theo dõi thêm thời gian phản hồi của search và số job <mark>ProductIndexJob</mark> bị lỗi (series Observability, bài 071 - 074).

#### Những lỗi hay gặp
- Dùng dynamic mapping, field bị đoán sai kiểu. Luôn khai báo mapping, <mark>dynamic: strict</mark>.
- Dùng <mark>term</mark> trên field <mark>text</mark>, hoặc aggregation trên field <mark>text</mark>.
- Đọc ghi thẳng vào tên index thật thay vì alias, tới lúc cần đổi mapping thì phải downtime.
- Không kiểm tra <mark>errors</mark> của bulk API.
- Quên đồng bộ khi dùng <mark>update_all</mark> hay khi model liên quan thay đổi.
- Coi Elasticsearch là database chính.
- Quá nhiều shard cho lượng dữ liệu nhỏ.
- <mark>refresh: true</mark> ở mỗi lần ghi trong production.

#### Tổng kết series

| Bài | Nội dung | Một câu |
|---|---|---|
| 105 | Khái niệm & Cài đặt | Inverted index, Elasticsearch là bản sao để tìm kiếm |
| 106 | Mapping & Analyzer | <mark>text</mark>/<mark>keyword</mark>, <mark>asciifolding</mark> để tìm không dấu |
| 107 | Đồng bộ từ Rails | Alias, bulk, <mark>after_commit</mark> + job |
| 108 | Full-text search | <mark>multi_match</mark>, <mark>bool</mark>, fuzzy, highlight |
| 109 | Filter, Facet & Sort | Aggregation, <mark>post_filter</mark>, <mark>search_after</mark>, <mark>function_score</mark> |
| 110 | Autocomplete, Gợi ý & Production | Edge n-gram, term suggester, shard, bảo mật |

Ngoài tìm kiếm sản phẩm, Elasticsearch còn rất phổ biến cho **lưu trữ và tìm kiếm log** (bộ ELK: Elasticsearch, Logstash, Kibana), và gần đây là **vector search** (field <mark>dense_vector</mark>) để tìm kiếm theo ngữ nghĩa kết hợp với AI. Những chủ đề này hẹn ở một series khác.
