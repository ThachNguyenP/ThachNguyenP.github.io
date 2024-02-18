---
layout: post
title:  "008.Docker cheatsheet."
author: thach
categories: [ Coding, Docker, Cheatsheet]
image: assets/images/post_008/docker-cover.png
---
Một phần không thể thiếu trong lập trình server hiện đại, khi mà mọi thứ cứ đòi phải lên cloud và thiết kế microservices. Nếu thiếu kiến thức về Docker thì cuộc sống của bạn trong project sẽ khá là nhọc nhằn đấy.

#### Một số khái niệm mới
Dockerfile: file chứa tập lệnh dùng để khởi tạo docker image.
Docker Hub: một dịch vụ thứ 3 lưu trữ images từ cộng đồng.
Container: tương đương với máy ả, được run từ image.
Docker compose: file docker-compose.yml được dùng để định nghĩa và run nhiều container.

#### Let's get your hand dirty now

```md
#kiểm tra phiên bản
docker --version

#liệt kê các image
docker images -a

#xóa một image (phải không container nào đang dùng)
docker images rm imageid

#tải về một image (imagename) từ hub.docker.com
docker pull imagename

#liệt kê các container
docker container ls -a

#xóa container
docker container rm containerid

#tạo mới một container
docker run -it imageid

#thoát termial vẫn giữ container đang chạy
CTRL +P, CTRL + Q

#Vào termial container đang chạy
docker container attach containerid

#Chạy container đang dừng
docker container start -i containerid

#Chạy một lệnh trên container đang chạy
docker exec -it containerid command
```
