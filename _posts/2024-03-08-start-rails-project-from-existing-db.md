---
layout: post
title:  "016.Start Rails project from existing db."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_016/pgloader_cover.png
---
Vừa rồi tôi được phân vào một dự án renew một web PHP + MySQL, và khi migrate hệ thống sang Rails, tôi muốn dùng Postgres thay vì dùng Rails với MySQL.

Sau một lúc research, thì tôi tìm thấy Pgloader.
#### Simpe migrate data
Đầu tiên là cài đặt Pgloader, may mắn là chúng ta có thể cài bằng Homebrew trên Mac
```md
brew update && brew install pgloader
```
Giờ để chuyển data và cả copy structure từ DB cũ, đơn giản nhất thì chúng ta có thể dùng lệnh như sau, tất nhiên là cần thay các giá trị <mark>user</mark>, <mark>password</mark>, <mark>host</mark>, <mark>db_name</mark>.
```md
pgloader --debug mysql://mysql_user:mysql_pw@localhost/mysql_db_name postgresql://postgres_user:postgres_pw@localhost/postgres_db_name
```

#### Something you may want to know
Khi mà migrate từ MySQL sang Postgres, các tables sẽ nằm trong một schema không phải <mark>public</mark>. Để có thể chuyển về <mark>public</mark>, chúng ta sẽ đặt trong một file <mark>migration_config.load</mark> như thế này
```txt
LOAD DATABASE
  FROM mysql://mysql_user:mysql_pw@localhost/mysql_db_name
  INTO postgres_user:postgres_pw@localhost/postgres_db_name
ALTER SCHEMA 'mysql_db_name' RENAME TO 'public';
```
Và chạy lệnh migrate như sau
```md
pgloader --debug migration_config.load
```
##### Lỗi tràn bộ nhớ
Khi mà data trong DB quá nhiều, các bạn có thể gặp lỗi <mark>Heap exhausted during load data into ...</mark>

Để sửa lỗi này thì thêm option <mark>prefetch rows</mark> trong file <mark>migration_config</mark>
```txt
LOAD DATABASE
  FROM mysql://mysql_user:mysql_pw@localhost/mysql_db_name
  INTO postgres_user:postgres_pw@localhost/postgres_db_name
  WITH prefetch rows = 10000
ALTER SCHEMA 'mysql_db_name' RENAME TO 'public';
```

#### Lỗi authen của MySQL user
Khi dùng MySQL 8, có thể các bạn sẽ gặp lỗi <mark>MYSQL-UNSUPPORTED-AUTHENTICATION was signalled</mark>

Theo các bài hướng dẫn thì các bạn edit file <mark>my.cnf</mark>, thêm vào trong cụm<mark>[mysql]</mark>
```txt
default-authentication-plugin=mysql_native_password
```
Restart Mysql và sau đó sửa lại quyền cho user
```md
mysql -u root -p
# enter your mysql_pw
ALTER USER 'mysql_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'mysql_pw';
# hoặc đơn giản là tạo thêm một user khác
CREATE USER 'new_user'@'localhost' IDENTIFIED WITH mysql_native_password BY 'password';
```

#### Tạo migration cho DB
Sau khi đã migration DB hoàn tất, vì chúng ta không có file migrate để tạo cấu trúc data như hiện tại, chúng ta nên tạo một cái. May mắn là Rails có hỗ trợ sẵn chúng ta.

```md
rake db:schema:dump
```
Copy phần create_table và những index trong đó. Sau đó tạo một file migrate, paste vào phần change và chạy migrate
```md
rails g migration InititalDatabase
```
```Ruby
class InitialDataStructure < ActiveRecord::Migration[7.0]
  def change
    #copy schema content here (create_table, add_foreign_key, create_enum)
  end
end

```

```md
rails db:migrate
```
Và xong, giờ chúng ta có thể sử dụng như một DB postgres bình thường
