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

## 本文

[http://afra55.github.io/2017/12/15/python-fourth-step/](http://afra55.github.io/2017/12/15/python-fourth-step/)

## Django

[https://www.djangoproject.com](https://www.djangoproject.com)

### 准备

使用 PyCharm 编译器可以略过准备，直接创建 Django 项目

创建名为 name 的虚拟环境： `python -m venv name`

激活虚拟环境: `source name/bin/activate`

停止虚拟环境：`deactivate`

在对象项目目录中安装 Django `pip3 install Django`

创建 mysite 项目:`django-admin startproject mysite`

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

### 启动服务

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

### Django 管理网站

#### 创建超级用户

`python3 manage.py createsuperuser`

Django 存储的密码时从原密码派生出来的散列值

#### 注册模型

在相应应用包名下，在 admin.py 中注册模型,

    from django.contrib import admin

    from app_name.models import TestModel

    # Register your models here.
    admin.site.register(TestModel)

注册完成后，访问： http://127.0.0.1:8000/admin/ 
输入用户名和密码进入管理网站的页面, 这个页面可以提那家和修改用户和用户组，还可以管理自定义的 model  

#### Django shell

在输入数据后，可以通过 Django shell 查看这些数据, 多用于测试项目和排除故障

`python3 manage.py shell`

    >>> from app_name.models import TestModel
    >>> TestModel.objects.all()

`TestModel.objects.all()` 用来获取 model 多所有实例，返回了一个列表（这个列表称为查询集，queryset), 可以像列表一样遍历查询

    >>> tests = TestModel.objects.all()
    >>> for test in tests:
    ...     print(test.id, test)
    ... 

知道 id 后，可以通过id 获取相应的数据 ：`t = TestModel.objects.get(id=1)`

如果有外键，则可以从外键获取对应关系的数据, 使用相关模型的小写加下划线加set来获取：`t.model_set.all()`

注意：每次修改 model 后都需要重启 shell 才能看到修改后的效果

退出 shell 按 `<Control-D>`， windows 按 `<Control-Z><Enter>`

### 创建网页

三步骤：定义URL，编写 view， 编写模板

定义 URL，让 Django 知道如何将浏览器请求与网站 URL 匹配, 来确定返回哪个网页

view, 每个 URL 都被映射到特定的视图，视图函数用于获取并处理网页所需的数据

模板，视图函数通常调用一个模板，让模板生成浏览器能够理解的网页

#### 映射 URL

默认情况下，主页URL(http://127.0.0.1:8000/) 返回默认的 Django 网站

项目主文件夹 `mysite` 下面的 `urls.py` 文件

    """learning_log URL Configuration

    The `urlpatterns` list routes URLs to views. For more information please see:
        https://docs.djangoproject.com/en/2.0/topics/http/urls/
    Examples:
    Function views
        1. Add an import:  from my_app import views
        2. Add a URL to urlpatterns:  path('', views.home, name='home')
    Class-based views
        1. Add an import:  from other_app.views import Home
        2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
    Including another URLconf
        1. Import the include() function: from django.urls import include, path
        2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
    """
    from django.contrib import admin
    from django.urls import path

    urlpatterns = [
        path('admin/', admin.site.urls),
    ]

admin.site.urls 定义了可以在管理网站中请求的所有URL

urlpatterns 包含了项目中的应用程序的 URL

将自己的应用 url 添加到 urlpatterns 中

    from django.contrib import admin
    from django.urls import path, include

    urlpatterns = [
        path('admin/', admin.site.urls),
        path('', include(('app_name.urls', 'app_name'), namespace='app_name'))
    ]

在自己的应用 `app_name` 包下创建 `urls.py`

    from django.urls import path

    from . import views


    urlpatterns = [
        path('', views.index, name='index'),  # 默认忽略基本 URL (http://127.0.0.1:8000/) ，所以这个 path 指 http://127.0.0.1:8000
    ]

urlpatterns 是一个列表，包含可在应用 app_name 中请求的网址

path 接受三个实参，
第一个是正则用于 Django 在 urlpatterns 查找与请求的 url 字符串匹配的内容;
第二个实参指定调用视图函数；
第三个实参将这个模式命名为 index ，以便在代码的其他地方引用

#### 编写视图

应用 app_name 包下的 views.py 

    from django.shortcuts import render

    # Create your views here.

render() 根据视图提供的数据渲染响应

编写 index 函数

    from django.shortcuts import render


    # Create your views here.
    def index(request):
        return render(request, 'app_name/index.html')

render() 第一个实参指原始的请求对象，第二个是模板

    def index(request):
        tests = TestModel.objects.order_by('date_added')
        context = {'tests': tests}
        return render(request, 'app_name/index.html', context)

可以在视图函数里进行数据库查询,例如:`tests=TestModel.objects.order_by('date_added')`请求Topic对象,按照属性`'date_added'`排序,将返回集存储在tests中

可以给模板发送上下文 context，这是一个字典, 例如：`{'tests': tests}`, 键是模版中用来访问数据的名称,值是发送给模板的数据, 使用 `render()` 传递 context

然后在模板中获取 context数据，例 for 循环遍历打印有序列表，内容 是 tests 里存储的内容



`{% endfor %}` 用于结束循环

`{{ test }}` 会被替换为当前遍历的test值

`{% empty %}` 为空时该如何处理


#### 编写模板

模板就是 html 网页

在 应用 app_name 包下新建一个名为 templates 的 文件夹 再创建一个 app_name 文件夹，`index.html` 放在最里层


### 创建模板网页

创建其他网页

#### 模版继承

网页都包含一些共有的元素，这种情况下，可以编写一个父模板，让每个网页都继承这个模板, 不用在每个页面重复定义这些共有的元素

#### 父模块

base.html

`{% block content %}{% endblock %}`

模版标签，用大括号和百分号表示 `({%   %})`

`{% url 'app_name:index' %}` 生成一个 URL, app_name 是命名空间，index 是该命名空间的 URL 模式 (就是 path 的第三个参数)， 与 app_name/urls.py 中 index 的 URL 模式匹配

`<a href="{% url 'app_name:index' %}">App Name</a>` 

`{% block content %}{% endblock %}` 一对块标签，块名是 content，是一个占位符,其中的信息由子模块指定, 可以有多个不同块名的块标签

#### 子模块

index.html

```
    {% extends "app_name/base.html" %}

    {% block content %}

    <p>天净沙·秋思</p>

    <p>枯藤老树昏鸦，小桥流水人家，古道西风瘦马。夕阳西下，断肠人在天涯。</p>

    {% endblock %}
```

`{% extends "app_name/base.html" %}` 让 Django 知道它继承了哪个父模板

`{% block content %}` 定义 content 块的开始

`{% endblock %}` 定义 content 块的结束