---
layout: post
title:  "004.Rails model cheatsheet."
author: thach
categories: [ Coding, Ruby, Cheatsheet]
image: assets/images/post_004/rails-model-cover.png
---
Uôi, với chủ trương Fat Model, Skin Controller thì Model trong Rails là phần béo bở nhất. Không chỉ vì file nó to bự theo thời gian, mà cũng là vì cái gì ngon nhất, dùng sướng nhất của Rails nó cũng nằm ở Model, cụ thể là thư viện ActiveRecord.  

#### Association
For basic association, here is Rails [document](https://guides.rubyonrails.org/association_basics.html)
degegate
```
Class Comment < ActiveRecord::Base
  belongs_to :post 
  delegate :user, to: :post
end
Class Post < ActiveRecord::Base
  has_many :comments
  belongs_to :user
end
comment = Comment.first
comment.user.name
```
class_name
```ruby
class User < ActiveRecord::Base
  has_many :authored_posts, foreign_key: "author_id", class_name: "Post"
  has_many :edited_posts, foreign_key: "editor_id", class_name: "User"
end
```
source
```ruby
#dùng source khi mà từ A muốn lấy quan hệ C của thằng B, A through B source C
class Post < ActiveRecord::Base
  has_many :post_authorings, foreign_key: "authored_post_id"
  has_many :authors, through: :post_authorings, source: :post_author
  belongs_to :editor, class_name: "User"
end
class User < ActiveRecord::Base
  has_many :post_authorings, foreign_key: :post_author_id
  has_many :authored_posts, through: :post_authorings
  has_many :edited_posts, foreign_key: :editor_id, class_name: "Post"
end

class PostAuthoring < ActiveRecord::Base
  belongs_to :post_author, class_name: "User"
  belongs_to :authored_post, class_name: "Post"
end
```
inverse_of
dùng cho trường hợp foreign_key hoặc through
```ruby
class Author < ApplicationRecord
  has_many :books, inverse_of: 'writer'
end

class Book < ApplicationRecord
  belongs_to :writer, class_name: 'Author', foreign_key: 'author_id'
end

a = Author.first
b = a.books.first
a.first_name == b.writer.first_name # => true
a.first_name = 'David'
a.first_name == b.writer.first_name # => true
#nếu không có inverse_of thì kết quả là false, cái này gọi là không có bi-direction
```
counter_cache
```ruby
class Book < ApplicationRecord
  belongs_to :author, counter_cache: :count_of_books
end
class Author < ApplicationRecord
  has_many :books
end
```
polymorphic, table picture có imageable_id, và imageable_type
```ruby
class Picture < ApplicationRecord
  belongs_to :imageable, polymorphic: true
end

class Employee < ApplicationRecord
  has_many :pictures, as: :imageable
end

class Product < ApplicationRecord
  has_many :pictures, as: :imageable
end
```
Single Table Inheritance
```ruby
class Car < Vehicle
end
```

option của belongs_to
```ruby
:autosave
:class_name
:counter_cache
:dependent
:foreign_key
:primary_key
:inverse_of
:polymorphic
:touch
:validate
:optional
```
option của has_one, has_many có thêm counter_cache, không có touch
```ruby
:as
:autosave
:class_name
:dependent
:foreign_key
:inverse_of
:primary_key
:source
:source_type
:through
:touch
:validate
```
#### Scope
default_scoped, nếu muốn skip có thể dùng unscoped
```ruby
class Article < ActiveRecord::Base
  default_scope { where(published: true) }
end

Article.all # => SELECT * FROM articles WHERE published = true
```
scope
```ruby
class Shirt < ActiveRecord::Base
  scope :red, -> { where(color: 'red') }
  scope :dry_clean_only, -> { joins(:washing_instructions).where('washing_instructions.dry_clean_only = ?', true) }
end
```
#### Validate
exclusion or inclusion
```ruby
class Account < ApplicationRecord
  validates :subdomain, exclusion: { in: %w(www us ca jp),
    message: "%{value} is reserved." }
end
```
format
```ruby

class Product < ApplicationRecord
  validates :legacy_code, format: { with: /\A[a-zA-Z]+\z/,
    message: "only allows letters" }
end
```
length
```ruby
class Person < ApplicationRecord
  validates :name, length: { minimum: 2 }
  validates :bio, length: { maximum: 500 }
  validates :password, length: { in: 6..20 }
  validates :registration_number, length: { is: 6 }
end
```
numericality
```ruby
class Player < ApplicationRecord
  validates :points, numericality: true
  validates :games_played, numericality: { only_integer: true, greater_than: 0 }
end
```
presence
```ruby
class Person < ApplicationRecord
  validates :name, :login, :email, presence: true
end
```
uniqueness
```ruby
class Holiday < ApplicationRecord
  validates :name, uniqueness: { scope: :year,
    message: "should happen once per year" }
end
```
validates_each
```ruby

class Person < ApplicationRecord
  validates_each :name, :surname do |record, attr, value|
    record.errors.add(attr, 'must start with upper case') if value =~ /\A[[:lower:]]/
  end
end
```
allow_nil or allow_blank
```ruby
class Coffee < ApplicationRecord
  validates :size, inclusion: { in: %w(small medium large),
    message: "%{value} is not a valid size" }, allow_nil: true
end
```
message
```ruby
class Person < ApplicationRecord
  validates :age, numericality: { message: "%{value} seems wrong" }

  validates :username,
    uniqueness: {
      # object = person object being validated
      # data = { model: "Person", attribute: "Username", value: <username> }
      message: ->(object, data) do
        "Hey #{object.name}!, #{data[:value]} is taken already! Try again #{Time.zone.tomorrow}"
      end
    }
end
```
on, if, unless
```ruby
class Order < ApplicationRecord
  validates :card_number, presence: true, if: :paid_with_card?

  def paid_with_card?
    payment_type == "card"
  end
end
```
custom validate
```ruby
class Invoice < ApplicationRecord
  validate :active_customer, on: :create

  def active_customer
    errors.add(:customer_id, "is not active") unless customer.active?
  end
end
```
một số trường hợp làm việc với errors thì tham khảo ở [đây](https://guides.rubyonrails.org/active_record_validations.html#working-with-validation-errors)

#### Callback
một cái callback sample thế lày
```ruby
class User < ApplicationRecord
  before_validation :normalize_name, on: :create

  after_validation :set_location, on: [ :create, :update ]

  private
    def normalize_name
      self.name = name.downcase.titleize
    end

    def set_location
      self.location = LocationService.query(self)
    end
end
```
đống này trigger callback
```ruby
create
create!
destroy
destroy!
destroy_all
save
save!
save(validate: false)
toggle!
touch
update_attribute
update
update!
valid?
```
đống này thì không
```ruby
decrement!
decrement_counter
delete
delete_all
increment!
increment_counter
update_column
update_columns
update_all
update_counters
```
Tạm thế đã, hôm nào sẽ viết lại, kkk
