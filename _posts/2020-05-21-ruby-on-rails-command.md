---
layout: post
title:  "002.RubyOnRails cheatsheet."
author: thach
categories: [ Coding, Ruby, Cheatsheet]
image: assets/images/post_002/rails-cover.png
---
Một số lệnh Ruby on Rails cơ bản, đi kèm Postgresql, nếu đã mất công google, thì hãy tìm ở đây.
#### Lệnh Rails
Tạo project Rails api với version 5.2.0 tên là super-awesome-api, dùng DB postgres
```md
rails _5.2.0_ new super-awesome-api --api --database=postgresql
```
Show log trên production
```md
rails console -e production
```
Tạo module Highscore
```md
rails generate scaffold HighScore game:string score:integer
```
Một số câu tương tác DB (tạo DB, xóa DB, chạy migrate, thêm seed db, rollback lùi 2 bước, check trạng thái file migrate nào, chạy duy nhất một file migrate, rollback 3 bước rồi migrate lại 3 bước)
```md
rails db:create
rails db:drop
rails db:migrate
rails db:seed
rails db:rollback STEP=2
rails db:migrate:status
rails db:migrate:up VERSION=20080906120000
rails db:migrate:redo STEP=3
```
Một số câu migration tạo bảng, thêm cột, thêm khóa ngoại, xóa cột, đổi tên bảng, xóa bảng
```md
rails generate migration CreateProducts name:string part_number:string
rails generate migration AddDetailsToProducts part_number:string:index price:decimal
rails generate migration AddUserRefToProducts user:references
rails generate migration RemovePartNumberFromProducts part_number:string
rails generate migration RenameOldTableToNewTable
rails generate migration DropMerchantsTable
```
#### Lệnh Postgres
Chả biết vì lí do gì, từ lúc đi code Ruby, hễ cứ có requirement dùng DB SQL thì lại chọn ngay Postgres. Sớm thôi, mình sẽ viết một bài so sánh các hệ quản trị cơ sở dữ liệu, cả SQL lẫn NoSQL.  
Để xem thêm chi tiết về postgres, các bạn có thể xem thêm ở [đây](https://www.guru99.com/postgresql-tutorial.html)  
Install postgres on MacOs
```md
brew update
brew install postgresql
brew services start postgresql
```
Access postgres shell
```md
psql postgres
#hoặc nếu sử dụng linux
sudo -u postgres psql
```
Những câu lệnh với user(role)
```md
create database mydb;
create user xxx with encrypted password 'xxx';
grant all privileges on database xxx to xxx;
#trao quyền super user cho user vừa tạo
ALTER USER xxx WITH SUPERUSER;
alter user xxx with encrypted password 'xxx';
ALTER USER xxx WITH OPTION1 OPTION2 OPTION3;
ALTER USER mytest WITH NOSUPERUSER;
ALTER USER mytest WITH SUPERUSER;
drop database IF EXISTS xxx;
drop user IF EXISTS xxx;
```
Những lệnh làm việc với DB
```md
\du
\dt
\l
\q
\c dbname usernam
\timing
\s
\g
\copy (select * from users limit 5) to 'tmp/a.csv' csv header
\pset null str
\pset linestyle unicode
\pset border 2

```
Và không kém phần quan trọng là lệnh backup/restore
```md
pg_dump -U username -W password-h 198.51.100.0 -p 5432 dbname > dbname.bak
psql dbname < dbname.bak
```
Tham khảo thêm cách auto backup ở [đây](https://www.linode.com/docs/databases/postgresql/how-to-back-up-your-postgresql-database/)
