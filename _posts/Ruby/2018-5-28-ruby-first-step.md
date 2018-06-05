---
layout: post
title:  "Ruby First Step: 基础知识"
date:   2018-05-28 22:23
categories: Ruby
comments: true
description: Python First Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2018/05/28/ruby-first-step/](http://afra55.github.io/2018/05/28/ruby-first-step/)

# 基础知识

## Ruby is...

A dynamic, open source programming language with a focus on simplicity and productivity. It has an elegant syntax that is natural to read and easy to write.

## 安装

`brew install rbenv`

`rbenv install 2.4.0`

`rbenv install jruby-9.1.17.0`

`rbenv global 2.4.0`

`CONFIGURE_OPTS="--disable-install-doc --with-readline-dir=$(brew --prefix readline)" rbenv install 2.4.0`

`rbenv rehash`

`brew install rbenv-gemset`

## irb

`> irb` 即可在控制台写程序

## 字符串

    print "Afra55~\n"   # Afra55~
    print 'Bfra55 \\ \'\'~\n' # -> Bfra55 \ ''~\n 

单引号不会转义，字符串会原封不动输出，除了 \ 和 '

    puts "Bfra55", "Cfra55"

puts 会自动在输出结果后加换行

print 和 puts 方法输出数值时都是一种形式, 例如 输出 "120" 和 120 结果都是 120， 而 p 则可以区分

    p 123   # 123
    p "123"   # "123"
    p "123\t\n"   # "123\t\n"

p 输出结果，换行符等特殊字符不会转义

在程序首行添加 `# encoding: UTF-8` 来指定编码格式

## 变量

    name = "Afra55"
    print "My name is #{name}"  # My name is Afra55

在字符串中可以使用 #{变量名} 显示变量值，也可以是一个公式例如：#{1 * 2 * 3}

## 注释

    # 我是注释

    =begin
    我是注释体
    我是注释体
    我是注释体
    =end

## 控制语句

### if

    a = 20
    if a > 10 then
      puts "大于10"
    end

    a = 9
    if a < 10 then
      puts "小于10"
    end

    a = 10
    if a == 10    # 可以省略 then
      puts "等于10"
    end

### while

    i = 1
    while i < 10
      print i, " "
      i = i + 1
    end     # 1 2 3 4 5 6 7 8 9 

    10.times do     # 迭代器
      print "L "
    end     # L L L L L L L L L L 

## 数组

    objs = []   # 空数组

    objs = ["Abc", 1, -1, 1.0, nil, "xx"]
    puts objs[0]    # Abc
    objs[0] = "Ijb"
    puts objs[0]    # Ijb
    puts objs.size # 6

数组.each do |变量|
    循环体
end

    objs.each do |x|
      print x, ","
    end     # Ijb,1,-1,1.0,,xx,















