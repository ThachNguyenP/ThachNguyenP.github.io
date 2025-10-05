---
layout: post
title:  "037. Refactor where in Rails controller"
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_037/rails-query.png
---
Một tips nhỏ để refactor khi sử dụng nhiều lệnh `where` trong `controller`.

#### 1. Fresher code

```ruby
# app/controllers/users_controller.rb
class UsersController < ApplicationController
  def index
    users = User.where(nil)
    users = users.where(role: params[:role]) if params[:role]
    users = users.where(status: params[:status]) if params[:status]
    users = users.where(public_id: params[:public]) if params[:public]
    render json: users, status: 200
  end
end

# app/controllers/companies_controller.rb
class CompaniesController < ApplicationController
  def index
    companies = Company.where(nil)
    companies = companies.where("name like ?", "#{params[:name]}%") if params[:name]
    companies = companies.where(tax_id: params[:tax]) if params[:tax]
    render json: companies, status: 200
  end
end
```
Code này hoàn toàn ổn, chạy tốt, vì chúng ta đều biết `Arel` trong `Rails` sẽ giúp chúng ta tạo ra một câu query duy nhất. Tôi dùng cách này suốt, nhưng sau khi đúng là việc cảm thấy viết nhiều câu lệnh `where` theo `params` nhìn nó cứ ngu ngu thế nào ấy.

#### 2. Scope + Metaprogramming
```ruby
# app/models/user.rb
class User < ApplicationRecord
  scope :role,   -> (role) { where(role: role) }
  scope :status, -> (status) { where(status: status) }
  scope :public, -> (public_id) { where(public_id: public_id) }
end

# app/models/company.rb
class Company < ApplicationRecord
  scope :name, -> (name) { where("name like ?", "#{name}%") }
  scope :tax,  -> (tax_id) { where(tax_id: tax_id) }
end

# app/controllers/users_controller.rb
class UsersController < ApplicationController
  def index
    users = User.where(nil)
    users = users.role(params[:role]) if params[:role]
    users = users.status(params[:status]) if params[:status]
    users = users.public(params[:public]) if params[:public]
    render json: users, status: 200
  end
end

# app/controllers/companies_controller.rb
class CompaniesController < ApplicationController
  def index
    companies = Company.where(nil)
    companies = companies.name(params[:name]) if params[:name]
    companies = companies.tax(params[:tax]) if params[:tax]
    render json: companies, status: 200
  end
end
```

Sau đó áp dụng thêm `Metaprogramming`, ta có thể rút gọn như sau.

```ruby
# app/controllers/users_controller.rb
class UsersController < ApplicationController
  def index
    users = User.where(nil)
    params.slice(:role, :status, :public).each do |key, value|
      users = users.send(key, value) if value
    end
    render json: users, status: 200
  end
end

# app/controllers/companies_controller.rb
class CompaniesController < ApplicationController
  def index
    companies = Company.where(nil)
    params.slice(:name, :tax).each do |key, value|
      companies = companies.send(key, value) if value
    end
    render json: companies, status: 200
  end
end
```

#### 3. Module
Với cách này thì ta không cần define scope ở nhiều model nữa, ta chỉ cần define module `Filterable` trong models/concerns và include nó vào model cần dùng.
```ruby
# app/models/concerns/filterable.rb
module Filterable
  extend ActiveSupport::Concern

  module ClassMethods
    def filter(filtering_params)
      results = self.where(nil)
      filtering_params.each do |key, value|
        results = results.send(key, value) if value
      end
      results
    end
  end
end
```

```ruby
# app/models/user.rb
class User < ApplicationRecord
  include Filterable
  ...
end

# app/models/company.rb
class Company < ApplicationRecord
  include Filterable
  ...
end

# app/controllers/users_controller.rb
class UsersController < ApplicationController
  def index
    users = User.filter(filtering_params(params))
    render json: users, status: 200
  end

  private

  def filtering_params(params)
    params.slice(:role, :status, :public)
  end
end

# app/controllers/companies_controller.rb
class CompaniesController < ApplicationController
  def index
    companies = Company.filter(filtering_params(params))
    render json: companies, status: 200
  end

  private

  def filtering_params(params)
    params.slice(:name, :tax)
  end
end
```
#### 3.1 Note
```ruby
params = { destroy: 1 }

User.filter(params)
```

Nếu không `filter` params, rất có thể bạn sẽ gặp những params hiểm ác thế này.

Trong Ruby 2.6.0, một phương thức mới được thêm vào các enumerables, đó là `filter`, nhận vào một block. Bạn có thể kiểm tra mã dưới đây. Tuy nhiên, tôi khuyên bạn nên thay đổi tên phương thức từ `filter` sang `filter_by`.

```ruby
# This will throw error, because ruby use filter for enumerables.
def index
    @companies = Company.includes(:agency).order(Company.sortable(params[:sort]))
    @companies = @companies.filter(params.slice(:ferret, :geo, :status))
end

# This won't throw error, because we call filter for class Company
def index
    @companies = Company.filter(params.slice(:ferret, :geo, :status))
    @companies = @companies.includes(:agency).order(Company.sortable(params[:sort]))
end
```
Tham khảo hoàn toàn từ [K Putra](https://dev.to/kputra/rails-refactor-your-where-method-5b10)
