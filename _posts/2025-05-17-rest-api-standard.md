---
layout: post
title:  "029.REST api design."
author: thach
categories: [ Coding, Web]
image: assets/images/post_029/rest_api.png
---
Hôm nay note lại một số chuẩn mực khi thiết kế REST API để tham khảo sau này.

#### Rule #1: DO use plural nouns for collections
Không có lý do kỹ thuật nào cho quy ước này, nhưng danh từ số nhiều được các lập trình viên sử dụng rộng rãi tới bây giờ. Việc cố ý đi ngược quy tắc rất có khả năng sẽ làm cho đồng đội của bạn thấy cấn cấn.

```sh
# GOOD
GET /products              # get all the products
GET /products/{product_id} # get one product

# BAD
GET /product/{product_id}
```
#### Rule #2: DON'T add unnecessary path segments
Một lỗi phổ biến dường như là cố gắng xây dựng những url lồng nhau kiểu này.

```sh
# GOOD
GET /categories/{category_id}
GET /categories/{product_id}

# BAD
GET /shops/{shop_id}/categories/{category_id}
GET /shops/{shop_id}/categories/{category_id}/products
GET /shops/{shop_id}/categories/{category_id}/products/{product_id}
```

category_id là duy nhất trong database, không có lý do gì để truyền thêm shop_id vào URL. Ngoài việc thừa thãi, nó chắc chắn gây ra vấn đề khi có những yêu cầu thay đổi, như là category thuộc nhiều shop.

Nhưng với một số trường hợp, như là bạn cần create, update, delete một user ra khỏi một team/group, với một mối quan hệ nhiều-nhiều, thì url lồng với cả team_id và user_id là cần thiết.

```sh
GET /teams/{team_id}/users/{users_id}
```

#### Rule #3: DON'T add .json or other extensions to the url
Từ khoảng đầu năm 2000, vẫn còn những lập trình viên sử dụng các extension như .json, .xml, .html. Nhưng ở hiện tại, JSON đã gần như trở thành mặc định.

Ngoài ra, nếu phía client muốn xác định định được dữ liệu trả về là JSON hay XML, thì có thể sử dụng HTTP header (Accept: application/json)


#### Rule #4: DON'T return arrays as top level responses
Lớp ngoài cùng của một response luôn luôn nên là một object.

```sh
# GOOD
GET /things returns:
{ "data": [{ ...thing1...}, { ...thing2...}] }

# BAD
GET /things returns:
[{ ...thing1...}, { ...thing2...}]
```

Nếu như mà bạn cần trả về một list các object, thì hãy đặt nó trong một field data, cùng với các field khác như total_count, page, has_more, ...

#### Rule #5: DON'T return map structures
I often see map structures used for collections in JSON responses. Return an array of objects instead.

```sh
# BAD
GET /things returns:
{
    "KEY1": { "id": "KEY1", "foo": "bar" },
    "KEY2": { "id": "KEY2", "foo": "baz" },
    "KEY3": { "id": "KEY3", "foo": "bat" }
}

# GOOD (also note application of Rule #4)
GET /things returns:
{
    "data": [
        { "id": "KEY1", "foo": "bar" },
        { "id": "KEY2", "foo": "baz" },
        { "id": "KEY3", "foo": "bat" }
    ]
}
```

Để ý các điều sau:
- Các key KEY1, KEY2, KEY3 là không cần thiết, vì bên trong value đã có những giá trị id.
- Cấu trúc của response của các bạn là không cố định, vì các key có thể thay đổi.
- Việc thay đổi các key sẽ trở nên phức tạp, và không dự đoán trước được

Thay vì dùng những structure phức tạp, hãy dàn phẳng response của các bạn ra. Việc thêm 2,3 field sẽ đơn giản hơn việc lồng 2,3 lớp ở respone

```sh
# BAD
{
    "paths": {
        "/speakers": {
            "post": { ...information about the endpoint...}
        }
    }
}

# BAD
{
    "paths": {
        "/speakers": {
            "requests": {
                "createSpeaker": {
                    "method": "post",
                    ...rest of the endpoint info...
                }
            }
        }
    }
}
# GOOD
{
    "requests": [
        {
            name: "createSpeaker",    // adding this field is nonbreaking
            path: "/speakers",
            method: "post",
            ...etc...
        }
    ]
}
```

Nói chung là cũng không ai bắt bẻ bạn phải làm thật phẳng response của mình. Hãy coi như đó là một lời khuyên để tham khảo lúc thiết kế, và tự mình cân bằng giữa sự phức tạp và đơn giản.


#### Rule #6: DO prefix your identifiers
Stripe có một cách làm rất ảo, đó là thêm prefix vào trước các id của họ. Ví dụ: <mark>in_1MVpWEJVZPfyS2HyRgVDkwiZ</mark>, trong đó, tiền tố **in_** được hiểu là id của **invoice**. Điều này giúp các bạn đáng kể việc hiểu ra đó là id của đối tượng nào.

Mặc dù việc sử dụng id số mang lại hiệu quả hơn về mặt performance, nhưng nó cũng làm cho việc đọc code của bạn trở nên khó hiểu hơn. Nhưng nếu các bạn xác định mình sử dụng uuid, hoặc là friendly id, thì có thể áp dụng thủ thuật này.

#### Rule #10: DO use a structured error format
Khi làm việc với Rest, response lỗi của bạn nên được thiết kế theo một format thống nhất, hơn là giao hết mọi việc cho mã lỗi (404, 500, 403, ...).

```sh
{
  "message": "Record Not Found",
  "resource": "User",
  "code": 404,
  "status": false
}
```

Việc này giúp cho phía client có thể chủ động thiết kế các thông báo lỗi.

#### Rule #11: DO provide idempotence mechanisms
Idempotence có nghĩa là nếu bạn thực hiện một hành động nhiều lần, thì kết quả của nó sẽ không thay đổi. Việc này dựa trên thực tế là đôi lúc mạng internet không ổn định, khiến cho các request bị mất, hoặc bị trùng lặp.

```sh
# GET doesn't change anything on the server
GET /orders/ORD123

# If you call PUT on the same order more than once, the zip stays the same
PUT /orders/ORD123/address
{"zip": "91202"}

# If you call DELETE multiple times, the order stays deleted
DELETE /orders/ORD123
```

Với hành động <mark>create</mark>, thường đi với method POST thì cần một chút thủ thuật, đơn giản là để chúng ta để client side tạo id của object. ID này sẽ là unique, và chúng ta sẽ sử dụng nó để xác định xem object đó đã tồn tại trong database hay chưa.

```sh
# Every time you call this, we create a new order
POST /orders
{"id": "mything1", "product": "frisbee", "address": {...etc...}}
```

#### Rule #12: DO use ISO8601 strings for timestamps
Giữa <mark>2023-12-21T11:17:12.34Z</mark> và <mark>1703157432340</mark> thì theo tôi, cái đầu tiên sẽ dễ đọc hơn. Khi triển khai dự án, hãy cố gắng thống nhất với FE sử dụng một format thống nhất cho ngày giờ, khuyến khích các bạn sử dụng ISO8601.


