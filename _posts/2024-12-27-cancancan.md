---
layout: post
title:  "021.Phân quyền Rails với Cancancan."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_021/cancancan.jpg
---
Là một trong những gem được dùng phổ biến nhất với Rails, cũng thường được dùng để phỏng vấn hoặc các làm project cho các bạn intern. Bài viết tham khảo từ [Medium](https://medium.com/@learnwithalfred/rails-7-authorization-with-cancancan-gem-f3a29c01b3bd) và [Greena13 blog](https://greena13.github.io/blog/2019/07/12/cancancan-cheatsheet/).

#### 1. Setup bài toán đơn giản
Bài toán như sau, chúng ta có 3 loại user là <mark>student</mark>, <mark>teacher</mark> và <mark>admin</mark>.
- Admin có đầy đủ các quyền
- Teacher có thể tạo các lessons, và có toàn quyền với các lessons
- Student có thể xem các lessons

```ruby
# add role cho bảng users
class AddRoleToUser < ActiveRecord::Migration[7.0]
  def change
    add_column :users, :role, :integer, default: 0
  end
end
```
```ruby
# add role vào model
class User < ApplicationRecord
  # previous code ....
  # ...........

  enum role: %i[student teacher admin]
  after_initialize :set_default_role, if: :new_record?
  # set default role to user if not set
  def set_default_role
    self.role ||= :student
  end
end
```

#### 2. Set quyền cho user
Bắt đầu set up Cancancan bằng cách add gem vào Gemfile và tạo file **ability**.
```ruby
gem 'cancancan'
```
```sh
rails g cancan:ability
```
Khai báo quyền trong <mark>ability.rb</mark> như sau.
```ruby
# app/models/ability.rb

class Ability
  include CanCan::Ability

  def initialize(user)
    can :manage, :all if user.admin?
    can :read, Lesson if user.student?
    can [:create, :read], Lesson if user.teacher?
    can [:update, :destroy], Lesson, user_id: user.id
    cannot :create, Student if user.teacher?
  end
end
```
```ruby
# app/controllers/posts_controller.rb
class LessonsController < ApplicationController
  before_action :authenticate_user!

  def new
    @lessons = Lesson.new
    authorize! :create, @lessons
    render :new
  end
end
```
Ở đây, các bạn sẽ tự hỏi là đoạn code trên đã gọi hàm **authorize!** với user nào? Thì nguyên nhân là **Cancancan** mặc định được dùng với **current_user**, nên nếu các bạn dùng **devise** thì sẽ không cần làm gì thêm.

Trường hợp các bạn dùng một tên biến khác, như là **logged_user** thì các bạn có thể sửa lại mặc định trong **application_controller.rb** như sau.

```ruby
# app/controllers/application_controller.rb
class ApplicationController < ActionController::Base
  alias_method :current_user, :logged_user # Dùng alias

  # Hoặc cũng có thể override lại hàm current_ability
  def current_ability
    @current_ability ||= Ability.new(logged_user)
  end
end
```

#### 3. Customize error message
![Cancancan default error](/assets/images/post_021/cancancan_error.png "Cancancan Error")

Error mặc định của **Cancancan** sẽ như thế này, các bạn hoàn toàn có thể custom lại theo ý mình.

```ruby
rescue_from CanCan::AccessDenied do |exception|
  exception.default_message = "You are not authorized to perform this task"
  respond_to do |format|
    format.json { head :forbidden }
    format.html { redirect_to root_path, alert: exception.message }
  end
end
```

#### 4. Kiểm tra quyền của user
**Cancancan** hỗ trợ kiểm tra quyền của user với hàm <mark>can?</mark> và <mark>cannot?</mark>

```ruby
<% if can? :create, Student %>
  <%= link_to 'New student', new_student_path %>
<% end %>
```

#### 5. Condition
Có thể dùng **hash** hoặc **block** để thêm điều kiện cho đối tượng được phân quyền như sau

```ruby
# dùng hash
can :view, Lesson, category: { type: :free }

# recommend sử dụng block chỉ khi không dùng được hash
can :view, Lesson do |lesson|
  lesson.published_at > user.membership.created_at
end
```

#### 6. Fetching Records
**Cancancan** cung cấp hàm <mark>accessible_by</mark> để chỉ lấy ra các tài nguyên mà user có quyền truy cập.
```ruby
@lessons = Lesson.accessible_by(current_ability)
@lessons = Lesson.accessible_by(current_ability, :read)
```
