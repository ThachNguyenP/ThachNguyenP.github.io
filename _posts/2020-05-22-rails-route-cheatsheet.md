---
layout: post
title:  "003.Rails routing cheatsheet, everything you need to know."
author: thach
categories: [ Coding, Ruby, Cheatsheet]
image: assets/images/post_003/rails-route-cover.jpg
---
Route, việc nhẹ nhàng, đơn giản nhất khi làm dự án rails. Vậy thì hôm nay thử deep dive vào xem nó có gì nào.

#### Keyword và sample
root
```ruby
namespace :admin do
  root to: "admin#index"
end
#hoặc thé này
root to: "home#index"
```
namespace
```ruby
namespace :admin do
  resources :users
end
#nested cả path lẫn module hóa controler
#admin_users GET    /admin/users(.:format)     admin/users#index
```
scope
```ruby
scope :admin do
  resources :users
end
#nested mỗi path mà thôi
#users GET    /admin/users(.:format)     users#index
```
member
```ruby
resources :photos do
  member do
    get 'preview'
  end
end
#nested path mà thôi, không module hóa controller, dùng khi cần thêm action ngoài mặc định
#preview_photo GET       /photos/:id/preview(.:format)     photos#preview
```
collection
```ruby
resources :photos do
  member do
    get 'preview'
  end
end
#giống thằng member, có điều chỉ là tạo prefix, không nested, không có params :id
#preview_photo GET       /photos/preview(.:format)     photos#preview
```
as hoặc path
```ruby
scope module: 'admin', path: 'fu', as: 'cool' do
  resources :users
end
#đổi cái rails path hoặc url
#cool_users GET    /fu/users(.:format)     admin/users#index
```
tạo subdomain
```ruby
constraints subdomain: 'app' do
  get '/games/:id', to: 'games#show'
  get '/games/list', to: 'games#list'
  post '/games/start', to: 'games#start'
end
#ời mà còn config tè le nữa mới đủ
```
redirect
```ruby
get '/stories', to: redirect('/articles')
#chơi trò đá qua cho thằng route khác
```
path_names
```ruby
resources :photos, path_names: { new: 'make', edit: 'change' }
#đổi tên mấy cái action mặc định trên url
```
only
```ruby
resources :photos, only: [:index, :show]
#filter bớt mấy cái action
```
param
```ruby
resources :videos, param: :identifier
#đổi tên mới cho cái params :id
```
constraints
```ruby
constraints(Iphone) do
  resources :products
end

class Iphone
  def self.matches?(request)
    request.env["HTTP_USER_AGENT"] =~ /iPhone/
  end
end
#khá nhiều chức năng, vd như thằng này check xem người dùng có phải dùng iphone hay không
```
concern
```ruby
concern :commentable do
    resources :comments
end
resource :page, concerns: :commentable
#thằng này ít xài lắm, chủ yếu chống duplicate code, đoạn trên tương đương
# resource :page do
#     resource :comments
# end
```
Cuối cùng là khi cái file route nó dài quá thì có thể chia nhỏ ra nhiều file giống vầy
```ruby
# config/routes.rb
YourAppName::Application.routes.draw do
  require_relative 'routes/admin_routes'
  require_relative 'routes/sidekiq_routes'
  require_relative 'routes/api_routes'
  require_relative 'routes/your_app_routes'
end
```
```ruby
# config/routes/api_routes.rb
YourAppName::Application.routes.draw do
  namespace :api do
    # ...
  end
end
```
Hy vọng bài viết có thể giúp ích phần nào cho các bạn khi làm việc với rails routing.
