---
layout: post
title:  "009.Tạo layout bằng css."
author: thach
categories: [ Coding, Css, Front End]
image: assets/images/post_009/layout_css.png
---
Hướng dẫn tạo layout bằng Css với Bootstrap, Material UI, Taiwind.

#### Hiểu về inline và block
Các thẻ HTML inline mặc định sẽ xếp liền kề nhau trên một hàng. Các phần tử này ở mặc định không thể set height và width được. Margin và Padding cũng không thể set cho top và bottom
```html
<b>, <a>, <strong>, <img>, <input>, <em>, <span> ...
```
Ngược lại, thẻ HTML loại block sẽ có chiều rộng chiếm hết chiều rộng của phần tử cha, và đẩy phần tử tiếp theo xuống dòng kế tiếp. Các phần tử này thì có thể set height và width,
```html
<h1>, <form>, <li>, <ol>, <ul>, <p>, <pre>, <table>, <div> ...
```
Theo nguyên tắc thì thẻ block chứa được thẻ inline, còn thẻ inline không chứa block. Nhưng có ngoại lệ là thẻ `<a>`

=============================================

Có thể dùng các thuộc tính css sau để thay đổi mặc định
```css
display: inline;
display: block;
display: inline-block; /*block nhưng có thể xếp chung trên một dòng*/
```

#### Flex và Grid
Cả hai đều là những phương thức để dàn trang css, điều khác biệt cơ bản là flex đi theo một chiều, nghĩa là những phần tử con sẽ được sắp xếp cái trước nối tiếp cái sau, khi chạm giới hạn thì sẽ đẩy nhau tạo thành một hàng mới.
Còn Grid thì ngay từ đầu, phần tử cha đã chia sẵn ra thành dạng lưới tọa độ, các phần tử con sẽ được đặt vào các vị trí trên lưới đó, thế nên khác với phần tử con của flex, chỉ cần xác định được vị trí trước sau trong chuỗi phần tử con, phần tử con grid cần được xác định vị trí cả chiều ngang và dọc của mình.

![Css Flex box explain](/assets/images/post_009/css_flexbox.png "Flexbox")

Những thuộc tính hay sử dụng nhất của Flex là

```css
/*set flex cho container (phần tử cha)*/
display: flex;
/*set đẩy xuống khi full hàng (phần tử cha)*/
flex-wrap: wrap;
/*chỉnh hướng của item trong đi theo hàng hay cột*/
flex-direction: row/row-reverse/column/column-reverse
/* gộp flex-wrap và flex-direction*/
flex-flow: column wrap
/*dàn vị trí cho nhiều phần tử trên một cột*/
justify-items: flex-start/flex-end/center/stretch/baseline;
/*dàn vị trí cho nhiều phần tử trên một hàng*/
align-items: flex-start/flex-end/center/stretch/baseline;
/*dàn vị trí cho nhiều hàng*/
justify-content: flex-start/flex-end/center/space-between/space-around/strech;
/*dàn vị trí cho nhiều hàng*/
align-content: flex-start/flex-end/center/space-between/space-around/strech;
```

![Css Grid explain](/assets/images/post_009/css_grid.jpeg "Css Grid")
Grid thì hay hơn, nhưng cũng khó xài hơn. Bạn chia chia container (parent) theo độ dài thích hợp, cả chiều ngang và chiều dọc. Sau đó quyết định phần tử con sẽ chiếm bao nhiêu khối.
Phần tử cha sẽ có những thuộc tính sau:
```css
/*ví dụ chia thành 5 cột bằng nhau*/
grid-template-columns: 20% 20% 20% 20% 20%;
/*ví dụ chia thành 5 hàng bằng nhau*/
grid-template-rows: repeat(5, 20% 20% 20% 20% 20%);
grid-template-rows: repeat(5, 1fr);
/* gộp cả 2 thằng column và row*/
grid-template: 20% 20% 20% 20% 20%/ repeat(5, 1fr);
/*chỉnh khoảng cách giữa các row hoặc column */
column-gap: 50px;
row-gap: 50px;
/*chỉnh vị trí của các phần tử bên trong children, mặc định sẽ là stretch */
justify-items: start/end/center/baseline/stretch;
align-items: start/end/center/baseline/stretch;
/* gộp cả 2 thằng trên ta dùng place*/
place-items: start/end;
/* trường hợp div cha có height và weight, khác với tổng của phần tử con, dàn vị trí của phần tử con so với phần tử cha*/
justify-contents: start/end/center/stretch/space-around/space-between/space-evenly;
align-contents: start/end/center/stretch/space-around/space-between/space-evenly;
/*tương tự, cũng có thể gộp 2 thằng lại*/
place-content: space-between/stretch;
```
Phần tử con sẽ có những thuộc tính sau:
```css
/* lấy từ cột đầu tiên bên trái*/
grid-column-start: 1;
/* kết thúc từ cột thứ 2 từ bên trái*/
grid-column-end: 2;
grid-column-end: span 1;
/* lấy từ hàng đầu tiên từ trên xuống*/
grid-row-start: 1;
/* kết thúc từ hàng đầu thứ 3 từ trên xuống*/
grid-row-end: 3;
grid-column-end: span 2;
/* gộp cả 2 thằng start và end*/
grid-column: 1/2;
grid-row: 1/span 2;
/* gộp cả 2 thằng column và row, thứ tự là row-start, column-start, row-end, column-end*/
grid-area: 1/1/3/2;
grid-area: 1/1/span 2/span 1
/*canh vị trí cho một phần tử con*/
jusify-self: center;
align-self: end;
```
