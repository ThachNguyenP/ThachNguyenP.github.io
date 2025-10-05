---
layout: post
title:  "038. Array Field."
author: thach
categories: [ Coding, Ruby, Rails]
image: assets/images/post_038/arr.png
---
Một số trường hợp sử dụng array field trong Rails.

#### 1. Migrate

```ruby
# db/migrate/*_create_books.rb
class CreateBooks < ActiveRecord::Migration[6.0]
  def change
    create_table :books do |t|
      t.string :title
      t.string :tags, array: true, default: []
      t.integer :ratings, array: true, default: []

      t.timestamps
    end
    add_index :books, :tags, using: 'gin'
    add_index :books, :ratings, using: 'gin'
  end
end
```

```ruby
# db/migrate/*_add_subjects_to_books.rb
class AddSubjectsToBooks < ActiveRecord::Migration
  def change
    add_column :books, :subjects, :string, array:true, default: []
  end
end
```

#### 2. Insert
```ruby
Book.create(title: "Hacking Growth", tags: ["business", "startup"], ratings: [4, 5])
# <Book id: 1, title: "Hacking Growth", tags: ["business", "startup"], ratings: [4, 5], created_at: "2020-06-29 08:48:42", updated_at: "2020-06-29 08:48:42">
```

#### 3. Show
```ruby
book = Book.first
book.tags
# => ["business", "startup"]
book.tags[0]
# => "business"
```

#### 4. Update
```ruby
book.tags << 'management'
# => ["business", "startup", "management"]
book.save!
book.tags
# => ["business", "startup", "management"]
```

Nhưng mà đừng có làm thế này: `Book.first.tags << 'finance'`, nó sẽ không được lưu vào database.

```ruby
Book.first.tags << "finance"
# Book Load (0.3ms)  SELECT "books".* FROM "books" ORDER BY "books"."id" ASC LIMIT $1  [["LIMIT", 1]]
# => ["business", "startup", "management", "finance"]
Book.first.save!
# Book Load (0.3ms)  SELECT "books".* FROM "books" ORDER BY "books"."id" ASC LIMIT $1  [["LIMIT", 1]]
# => true
Book.first.tags
# Book Load (0.3ms)  SELECT "books".* FROM "books" ORDER BY "books"."id" ASC LIMIT $1  [["LIMIT", 1]]
# => ["business", "startup", "management"]
```
#### 5.Search
```ruby
# Let say we want to search every single Book that have tags management:
Book.where("'management' = ANY (tags)")

# This is more secure
Book.where(":tags = ANY (tags)", tags: 'management')

# This is also valid
Book.where("tags @> ?", "{management}")
```
```ruby
Book.where.not("tags @> ?", "{management}")
```
```ruby
# Now, what if we want to search book that contain multiple tags, like management and startup
Book.where("tags @> ARRAY[?]::varchar[]", ["management", "startup"])
# OR contain any of tags
Book.where("tags && ARRAY[?]::varchar[]", ["management", "startup"])

# This is also valid
Book.where("tags &&  ?", "{management,startup}")

# If you use where.not, you basically search for all that do not contain the parameter given.
```
```ruby
# Now what if we want to search all book that have rating more than 3:
Book.where("array_length(ratings, 1) >= 3")
```
```ruby
# search matching, %gem% is manaGEMent
Book.where("array_to_string(tags, '||') LIKE :tags", tags: "%gem%")
```

Tham khảo hoàn toàn từ [K Putra](https://dev.to/kputra/rails-postgresql-array-1jn0#chapter-5)
