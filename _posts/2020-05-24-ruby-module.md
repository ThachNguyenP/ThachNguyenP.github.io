---
layout: post
title:  "005.Mixin trong Ruby."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_005/module.jpeg
---
Bài viết này chủ yếu tập trung về việc module hóa trong Ruby.

#### Include
```ruby
module Person
  def name
    "Person name"
  end
end
class User
  include Person
end
puts User.new.name
# => Person name
```
#### Extend
```ruby
module Person
  def name
    "Person name"
  end
end
class User
  extend Person
end
puts User.name # => Person name
```
xài như singleton methods
```ruby
u1 = User.new
u2 = User.new

u1.extend Person

puts u1.name # => Person name
puts u2.name #=> báo lỗi "undefined method `name'"
```
#### Prepended
```ruby
module Person
  def name
    "My name belongs to Person"
  end
end

class User
  prepend Person
  def name
    "My name belongs to User"
  end
end

puts User.new.name 
# => My name belongs to Person
```
#### Inherited
```Ruby
class Person
  def self.inherited(child_class)
    puts "#{child_class} inherits #{self}"
  end

  def name
    "My name is Person"
  end
end

class User < Person
end

puts User.new.name
# User inherits Person
# My name is Person
```
#### Methods lookup
```Ruby
module One
  def hello
    "I'm one (include in class Test)"
  end
end

module Two
  def hello
    "I'm two (include in class Test)"
  end
end

module Three
  def hello
    "I'm three (extend)"
  end
end

module Four
  def hello
    "I'm four (extend)"
  end
end

class FatherOfTest
  def hello
   "I'm father of test class"
  end
end

class Test < FatherOfTest
  include One
  include Two

  def hello
    "It's my hello - Test class"
  end
end

m = Test.new

def m.hello
  "I'm object m"
end

m.extend(Three)
m.extend(Four)

m.hello
```
Thứ tự output khi ta xóa dần là
```Ruby
# phương thức hello cho riêng instance m
"I'm object m"
# phương thức được extend riêng cho m
"I'm four (extend)"
"I'm three (extend)"
# phương thức trong chính class Test, class của m
"It's my hello - Test class"
# phương thức trong module được include vào Class Test
"I'm two (include in class Test)"
"I'm one (include in class Test)"
# phương thức trong lớp cha của Class Test
"I'm father of test class"
```
