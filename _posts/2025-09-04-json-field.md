---
layout: post
title:  "039. Json Field."
author: thach
categories: [Coding]
tags: [Ruby, Rails]
image: assets/images/post_042/index.png
---
Cách dùng json trong Rails app, đi cùng Postgres, trong bài viết sẽ sử dụng jsonb thay vì json.

#### 1. Migrate

```ruby
# db/migrate/*_create_books.rb
class CreateBooks < ActiveRecord::Migration[6.0]
  def change
    create_table :books do |t|
      t.integer :user_id
      t.jsonb :payload, default: {}

      t.timestamps
    end
    add_index :books, :payload, using: :gin
  end
end
```

#### 2. Insert
```ruby
book_payload = {
  title: 'Hacking Growth',
  publisher: 'Currency',
  published_date: '2017-04-07',
  authors: [
    { id: 1, name: 'Sean Ellis' },
    { id: 2, name: 'Morgan Brown' }
  ]
}

Book.create(user_id: 1, payload: book_payload)
# <Book id: 1, user_id: 1, payload: {"title"=>"Hacking Growth", "publisher"=>"Currency", "published_date"=>"2017-04-07", "authors"=>[{"id"=>1, "name"=>"Sean Ellis"}, {"id"=>2, "name"=>"Morgan Brown"}]}, created_at: "2025-10-05 08:48:42", updated_at: "2025-10-05 08:48:42">
```

#### 3. Show
```ruby
book = Book.first
book.payload
# => {"title"=>"Hacking Growth", "publisher"=>"Currency", "published_date"=>"2017-04-07", "authors"=>[{"id"=>1, "name"=>"Sean Ellis"}, {"id"=>2, "name"=>"Morgan Brown"}]}

book.payload['title']
# => "Hacking Growth"

book.payload['authors'][0]['name']
# => "Sean Ellis"

# Sử dụng with_indifferent_access để truy cập bằng symbol
book.payload.with_indifferent_access[:title]
# => "Hacking Growth"
```
```ruby
# app/models/book.rb
class Book < ApplicationRecord
  belongs_to :user
  serialize :payload, JsonbSerializers
end


# app/serializers/jsonb_serializers.rb
class JsonbSerializers
  def self.dump(hash)
    hash.to_json
  end

  def self.load(hash)
    if hash.nil?
      {}
    elsif hash.is_a?(Hash) && hash.empty?
      hash
    else
      JSON.parse(hash)
    end.with_indifferent_access
  end
end
```

```ruby
Book.last.payload[:title]
# => "Hacking Growth"
```


#### 3.1 store_accessor
`store_accessor` giúp truy cập các attribute thường dùng một cách dễ dàng hơn:

```ruby
# app/models/book.rb
class Book < ApplicationRecord
  store_accessor :payload, :title, :publisher, :published_date, :authors
end

book = Book.first
book.title
# => "Hacking Growth"

book.publisher = 'New Publisher'
book.save!
```

**Lưu ý**: `store_accessor` chỉ hoạt động với các attribute ở layer đầu tiên.

#### 4. Update
```ruby
book = Book.first
book.payload['title'] = 'New Title'
book.save!
book.payload['title']
# => "New Title"

# Update nested attribute
book.payload['authors'][0]['name'] = 'John Doe'
book.save!
```

Sử dụng JSON Schema để validate JSONB data:

```ruby
# Gemfile
gem 'activerecord_json_validator'

# app/models/schemas/book_payload.json
{
  "$schema": "http://json-schema.org/draft-04/schema#",
  "type": "object",
  "required": [ "title", "publisher", "published_date", "authors" ],
  "properties": {
    "title": { "type": "string" },
    "publisher": { "type": "string" },
    "published_date": { "type": "string" },
    "authors": {
      "type": "array",
      "items": {
        "$ref": "authors.json#/definitions/data"
      },
      "minItems": 1,
      "uniqueItems": true
    }
  }
}

# app/models/schemas/authors.json
{
  "definitions": {
    "data": {
      "type": "object",
      "required": [ "id", "name" ],
      "properties": {
        "id": { "type": "integer" },
        "name": { "type": "string" }
      }
    }
  }
}
```
```sh
# Gemfile
gem 'activerecord_json_validator'
```
```ruby
# app/models/book.rb
class Book < ApplicationRecord
  ...

  PAYLOAD_SCHEMA = Rails.root.join("app","models","schemas", "book_payload.json")
  validates :payload, presence: true, json: { message: -> (err) { err }, schema: PAYLOAD_SCHEMA }
end

```

#### 5. Search
```ruby
# Tìm kiếm exact match
Book.where("payload ->> 'title' = ?", 'Hacking Growth')

# Tìm kiếm với named parameter (bảo mật hơn)
Book.where("payload ->> 'title' = :title", title: 'Hacking Growth')

# Tìm kiếm nested attribute
Book.where("payload #>> '{authors,0,name}' = ?", 'Sean Ellis')

# Tìm kiếm pattern matching
Book.where("payload ->> 'title' LIKE ?", '%Growth%')

# Tìm kiếm với contains operator
Book.where("payload @> ?", { title: 'Hacking Growth' }.to_json)

# Tìm kiếm multiple conditions
Book.where("payload @> ?", { publisher: 'Currency', title: 'Hacking Growth' }.to_json)

# Check existence của key
Book.where("payload ? :key", key: 'title')

# Check existence của any key
Book.where("payload ?| array[:keys]", keys: ['title', 'publisher'])

# Check existence của all keys
Book.where("payload ?& array[:keys]", keys: ['title', 'publisher'])
```

#### 6. Important Notes
- JSONB lưu data dưới dạng string ban đầu
- Luôn set default value `'{}'` để tránh `nil` errors
- Sử dụng GIN index để tăng performance khi query
- Whitelist params trong controller để bảo mật
- `->` trả về JSON object, `->>` trả về text
- `#>` trả về JSON object từ path, `#>>` trả về text từ path

Tham khảo hoàn toàn từ [K Putra](https://dev.to/kputra/rails-postgresql-jsonb-part-1-4ibg)
