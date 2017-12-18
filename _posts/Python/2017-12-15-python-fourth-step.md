---
layout: post
title:  "Python Fourth Step"
date:   2017-12-15 22:00
categories: Python
comments: true
description: Python Fourth Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2017/12/15/python-fourth-step/](http://afra55.github.io/2017/12/15/python-fourth-step/)

## Django

[https://www.djangoproject.com](https://www.djangoproject.com)

### 准备

~使用 PyCharm 编译器可以略过准备，直接创建 Django 项目~

创建名为 name 的虚拟环境： `python -m venv name`

激活虚拟环境: `source name/bin/activate`

停止虚拟环境：`deactivate`

在对象项目目录中安装 Django `pip3 install Django`

创建 mysite 项目:` django-admin startproject mysite`

创建完成后，会自动生成几个文件：

    mysite/
        manage.py
        mysite/
            __init__.py
            settings.py
            urls.py
            wsgi.py

settings.py : 配置 Django 如何与系统交互以及管理项目

urls.py : 配置对应浏览器请求时需要打开的网页

wsgi.py : An entry-point for WSGI-compatible web servers to serve your project

### 创建数据库

`python3 manage.py migrate`

migrate 指迁移，修改数据库即迁移数据库，在新项目使用 migrate 命令时，Django 会新建一个数据库 db.sqlite3

`python3 manage.py runserver` 启动服务后，在浏览器中访问 http://127.0.0.1:8000 来查看项目是否成功创建

### 创建应用程序

`python3 manage.py startapp app_name` app_name 不能与项目名同名


    app_name/
        __init__.py
        admin.py
        apps.py
        migrations/
            __init__.py
        models.py
        tests.py
        views.py”

models.py : 定义需要在应用程序中管理的数据

### 创建 model (models.py)

    from django.db import models

    # Create your models here.

model 的意义时告诉 Django 如何处理应用程序中存储的数据

    from django.db import models


    # Create your models here.
    class TestModel(models.Model):
        text = models.CharField(max_length=200)
        date_added = models.DateTimeField(auto_now_add=True)
        
        def __str__(self):
            return self.text

创建的 model 都要继承 Django 中定义 model 基本功能的类 models.Model

    CharField：由字符或文本组成的数据, max_length 设置最多存储的字符长度
    DateTimeField: 记录日期和时间的数据, auto_add_now 每当创建model时都会自己把这个属性设置为当前日期和时间

在 https://docs.djangoproject.com 查看所有的 Model field

[https://docs.djangoproject.com/en/2.0/ref/models/fields/](https://docs.djangoproject.com/en/2.0/ref/models/fields/)

`def __str__(self):` 通过返回属性来配置默认显示有关 model 的信息

### 配置 model

在 settings.py 中， INSTALLED_APPS 列表代表项目中安装了哪些程序


    INSTALLED_APPS = [
        'django.contrib.admin',
        'django.contrib.auth',
        'django.contrib.contenttypes',
        'django.contrib.sessions',
        'django.contrib.messages',
        'django.contrib.staticfiles',
    ]   

将自己的应用添加到 INSTALLED_APPS 列表里:

    INSTALLED_APPS = [
        'django.contrib.admin',
        'django.contrib.auth',
        'django.contrib.contenttypes',
        'django.contrib.sessions',
        'django.contrib.messages',
        'django.contrib.staticfiles',
        'app_name'
    ]   

`python3 manage.py makemigrations app_name` 
makemigrations 命令让 Django 确定如何修改数据库，使其能够存储与定义的 model 相关联的数据，
执行完 makemigrations 后，需要应用修改: `python3 manage.py migrate`

每次修改 model.py 后，都需要调用 makemigrations 命令来确认修改，并 migrate 应用修改，一共三步骤




