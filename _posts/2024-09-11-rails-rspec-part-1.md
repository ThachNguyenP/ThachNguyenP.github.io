---
layout: post
title:  "017.Unit test cho Rails (Install)."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_017/rspec_cover.jpg
---
Chăm chỉ viết unit test để được gì, để tối về có thể an tâm ngủ ngon giấc.

#### Setup
Thêm vào một số gem sau
```ruby
gem 'factory_bot_rails'
gem 'faker',
gem 'rspec-rails'
gem 'shoulda-matchers'
gem 'simplecov'
gem 'simplecov-json'
gem 'simplecov-rcov'
```
Chạy lệnh **bundle install** và **rails generate rspec:install**

```sh
# Download and install
bundle install

# Generate boilerplate configuration files
# (check the comments in each generated file for more information)
rails generate rspec:install
#      create  .rspec
#      create  spec
#      create  spec/spec_helper.rb
#      create  spec/rails_helper.rb
```

#### Config Should-matchers và Simplecov
Thêm vào cuối file <mark>rails_helper.rb</mark>
```ruby
Shoulda::Matchers.configure do |config|
  config.integrate do |with|
    with.test_framework :rspec
    with.library :rails
  end
end
```
Thêm vào file <mark>spec_helper.rb</mark>
```ruby
require 'simplecov'
require 'simplecov-json'
require 'simplecov-rcov'

# .....
# .....

SimpleCov.formatters = [
  SimpleCov::Formatter::HTMLFormatter,
  SimpleCov::Formatter::JSONFormatter,
  SimpleCov::Formatter::RcovFormatter
]
SimpleCov.start do
  coverage_dir 'tmp/coverage'
end
```
Chạy thử lệnh **bundle exec rspec**, bạn sẽ thấy kết quả tương tự như sau
```txt
Finished in 0.00016 seconds (files took 0.16284 seconds to load)
0 examples, 0 failures

Coverage report generated for RSpec to /Users/nolan/work/practice/rails-unit-test-sample/tmp/coverage. 0 / 0 LOC (100.0%) covered.
Coverage report generated for RSpec to /Users/nolan/work/practice/rails-unit-test-sample/tmp/coverage/coverage.json. 0 / 0 LOC (100.0%) covered.
Coverage report Rcov style generated for RSpec to /Users/nolan/work/practice/rails-unit-test-sample/tmp/coverage/rcov
```
**Simplecov** giờ đã tạo mới cho chúng ta thư mục <mark>tmp/coverage</mark>, trong đó chứa kết quả độ bao phủ của lần chạy test vừa rồi. Mở file <mark>index.html</mark> bên trong sẽ cho ta kết quả như sau

![Coverage result](/assets/images/post_017/simplecov_empty_result.png "Coverage result")

#### Hand on vào viết unit test đầu tiên
Giả như bạn có một api trả về text **Hello World**.

```ruby
# config/routes.rb

Rails.application.routes.draw do
  get 'hello_world', to: 'hello_world#index'
end
```

```ruby
# app/controllers/hello_world_controller.rb

class HelloWorldController < ApplicationController
  def index
    render json: { message: 'Hello, World!' }
  end
end
```
Và giờ ta viết một file test với path tương đương trong thư mục <mark>spec</mark>

```ruby
# spec/controllers/hello_world_controller_spec.rb
require 'rails_helper'

RSpec.describe 'GET /hello_world', type: :request do
  context 'when show successfully' do
    before do
      get '/hello_world'
    end

    it 'should return status 200' do
      expect(response.status).to eq 200
      expect(JSON.parse(response.body)['message']).to eq 'Hello, World!'
    end
  end
end

```
Chạy **bundle exec rspec** một lần nữa, giờ chúng ta có kết quả
![Coverage result](/assets/images/post_017/simplecov_first_result.png "Coverage result")

Kiểm tra chi tiết file <mark>app/controllers/hello_world_controller.rb</mark> thì ta thấy phần code được chạy test, và số lần được test của những dòng code đó

![Coverage result](/assets/images/post_017/simplecov_detail_result.png "Coverage result")
