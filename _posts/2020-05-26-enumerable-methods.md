---
layout: post
title:  "007.Map, inject, select ... trong Ruby."
author: thach
categories: [ Coding, Ruby]
image: assets/images/post_007/enumerable.jpeg
---
Một số hàm thông dụng của Enumerable, module được sử dụng nhiều nhất của Ruby.

#### each
Đi qua từng phần tử và trả về array nguyên thủy
```ruby
[1,2,3].each { |num| print "#{num}! " }
# 1 2 3
["Cool", "chicken!", "beans!", "beef!"].each_with_index do |item, index|
  print "#{item} " if index%2==0
end
# Cool beans!
```
#### map
Đi qua từng phần tử và trả về array đã thay đổi giá trị
```ruby
array = ["a", "b", "c"]
array.map { |string| string.upcase }
# ["A", "B", "C"]

array = %w(a b c)
array.map.with_index { |ch, idx| [ch, idx] }
# [["a", 0], ["b", 1], ["c", 2]]
```
#### inject
```ruby
["bar","baz","quux"].inject("foo") {|acc,elem| acc + "!!" + elem }
# returns "foo!!bar!!baz!!quux"
```
#### select
giống default parameter, nhưng khi gọi phải có thêm tên của arguments
```ruby
[1,2,3,4,5,6,7,8,9,10].select{|el| el%2 == 0 }
# returns [2,4,6,8,10]
```
#### find
Trả về giá trị đầu tiên thỏa mãn điều kiện
```Ruby
[1,2,3,4,5,6,7,8,9,10].find{|el| el / 2 == 2 }
# returns 4
```
#### reject
Giữ lại những phần tử không thõa điều kiện
```ruby
[1,2,3,4,5,6,7,8,9,10].reject{|e| e==2 || e==8 }
# returns [1, 3, 4, 5, 6, 7, 9, 10]
```
#### group_by
```ruby
names = ["James", "Bob", "Joe", "Mark", "Jim"]
names.group_by{|name| name.length}
# {5=>["James"], 3=>["Bob", "Joe", "Jim"], 4=>["Mark"]}
```
#### grep
```ruby
names.grep(/J/)
# ["James", "Joe", "Jim"]
```
#### any?
Kiểm tra xem có thằng nào trong array thỏa mãn điều kiện hay không?
```ruby
[1,2,3].any? { |n| n > 0 }
# true
```
#### all?
Kiểm tra xem có có phải tất cả element trong array thỏa mãn điều kiện hay không?
```ruby
[1,2,3].all? {|a| a.is_a? Integer}
#true
```
#### none?
Kiểm tra xem có có phải tất cả element trong array đều không thỏa mãn điều kiện hay không?
```ruby
['a','b','c'].all? {|a| a.is_a? Integer}
#true
```
#### include?
Giống any vậy đó, nhưng cụ thể hơn chút
```ruby
a = [ "a", "b", "c" ]
a.include?("b")   #=> true
a.include?("z")   #=> false
```
