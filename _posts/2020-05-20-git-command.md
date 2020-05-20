---
layout: post
title:  "001.Git cheatsheet."
author: thach
categories: [ Coding ]
image: assets/images/post_001/github-command-cover.png
---

### Cài đặt nhiều ssh account trên cùng máy tính
Tạo cặp key thứ 2 với email và địa chỉ lưu file mới
```md
cd ~/.ssh/
ssh-keygen -t rsa -C "email@work_mail.com" -f "id_rsa_work_user1"
eval "$(ssh-agent -s)"
ssh-add -K ~/.ssh/id_rsa_work_user1
```

Tạo file config
```md
$ cd ~/.ssh/
$ touch config
$ code config
```
Content tương tự như sau
```md
#### Tài khoản cá nhân, config mặc định
Host github.com
HostName github.com
User git
IdentityFile ~/.ssh/id_rsa

#### Tài khoản công việc
Host github.com-work_user1
HostName github.com
User git
IdentityFile ~/.ssh/id_rsa_work_user1
```

Đặt lại account cho repo dưới local
```md
git config user.name "User 1"
git config user.email "user1@workMail.com"
git remote set-url origin git@github.com-work-user1/repo_work.git
```

Nếu đẩy code lên mà bị  "Enter passphrase for key" thì sửa config lại thành
```md
#### Tài khoản cá nhân, config mặc định
Host github.com
HostName github.com
User git
UseKeychain yes
AddKeysToAgent yes
IdentityFile ~/.ssh/id_rsa
```

### Lệnh git thường dùng

git clone `kéo repo về`  
git add . `add tất cả file change`  
git commit -m "commit message" `commit change`  
git checkout -b "ten branch X" `tạo nhanh mới từ nhánh đang đứng`  
git stash" `lưu thay đổi ở nhánh đang đứng, stash làm việc theo stack nên có thể lưu nhiều lần`  
git stash apply" `lấy thay đổi đó ra`  
git tag -l" `hiển thị tất cả tag`  
git tag "tên tag" `đánh tag`  
git push origin tag "tên tag" `đẩy tag đó lên`  
git clean -df `xóa hết file change mới`  
git reset HEAD ~ `uncommit`  
git reset HEAD `unstage cả mớ`  
git reset -- "file path" `unstage file`  
git merge "ten branch X" `merge branch X vào nhánh đang đứng`  
git rm "file path" `xóa file ở trên repo, nhưng giữ lại ở local, kiểu như quên bỏ vào gitignore`  