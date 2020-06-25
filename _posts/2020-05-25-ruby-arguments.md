---
layout: post
title:  "006.Arguments trong Ruby."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_006/parameter.jpeg
---
Một vài tóm tắt nho nhỏ về parameter của Ruby.

#### Required parameters
```ruby
def chocolate(number_of_milk_packets)
  “This will be good with #{number_of_milk_packets} packets”
end
chocolate()
# ArgumentError: wrong number of arguments (given 0, expected 1)
chocolate(1,2,3)
# ArgumentError: wrong number of arguments (given 3, expected 1)
```
#### Default parameters
```ruby
def chocolate(number_of_milk_packets=1) #method with default parameter
  “This will be good with #{number_of_milk_packets} milk packets”
  end
chocolate()
# This will be good with 1 milk packets
chocolate(7)
# This will be good with 7 milk packets
```
#### Optional parameters
```ruby
def chocolate(*number_of_milk_packets) #with optional parameter
  “This will be good with #{number_of_milk_packets} packets”
end
chocolate(5,9,2)
# “This will be good with [5,9,2] packets”
```
#### Variable parameters
giống default parameter, nhưng khi gọi phải có thêm tên của arguments
```ruby
def testing(d: 1)
  p d
end
testing()
# 1
testing(d: 2)
# 2
```
#### Keyword parameter
```Ruby
def testing(**x)
  p x
end
testing(x: 1)
# {:x=>1}
```
#### Other case
Thực sự méo biết để làm gì
```ruby
class Food
  def nutrition(vitamins, minerals)
    puts vitamins
    puts minerals
  end
end
class Bacon < Food
  def nutrition(*)
    super
  end
end
bacon = Bacon.new
bacon.nutrition("B6", "Iron")
# B6
# Iron
```
