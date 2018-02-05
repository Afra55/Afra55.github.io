---
layout: post
title:  "Python Fourth Step: Django"
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

[官方引导](https://docs.djangoproject.com/en/2.0/intro/)

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

### 重置数据库

`python3 manage.py flush`

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

![picture_1](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_1.png?raw=true)

![picture_2](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_2.png?raw=true) 用于结束循环

![picture_3](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_3.png?raw=true) 会被替换为当前遍历的test值

![picture_4](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_4.png?raw=true) 为空时该如何处理


#### 编写模板

模板就是 html 网页

在 应用 app_name 包下新建一个名为 templates 的 文件夹 再创建一个 app_name 文件夹，`index.html` 放在最里层


### 创建模板网页

创建其他网页

#### 模版继承

网页都包含一些共有的元素，这种情况下，可以编写一个父模板，让每个网页都继承这个模板, 不用在每个页面重复定义这些共有的元素

一个应用程序的模板可以继承另一个应用程序的模板

#### 父模块

base.html

![picture_5](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_5.png?raw=true)

模版标签，用大括号和百分号表示 ![picture_6](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_6.png?raw=true)

![picture_7](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_7.png?raw=true) 生成一个 URL, app_name 是命名空间，index 是该命名空间的 URL 模式 (就是 path 的第三个参数)， 与 app_name/urls.py 中 index 的 URL 模式匹配

![picture_8](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_8.png?raw=true) 

![picture_9](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_9.png?raw=true) 一对块标签，块名是 content，是一个占位符,其中的信息由子模块指定, 可以有多个不同块名的块标签

#### 子模块

index.html

![picture_10](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_10.png?raw=true)

![picture_11](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_11.png?raw=true) 让 Django 知道它继承了哪个父模板

![picture_12](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_12.png?raw=true) 定义 content 块的开始

![picture_13](https://github.com/Afra55/Afra55.github.io/blob/master/blog_picture/shortcuts/python_fourth_pic_13.png?raw=true) 定义 content 块的结束

### 自定义表单

forms.py

    from django import forms

    from .models import TestModel


    class TestModelForm(forms.ModelForm):
        class Meta:     # 指出表单基于的模型，以及表单包含的哪些字段
            fields = ['text']
            labels = {'text': ''}
            widgets = {'text': forms.Textarea(attrs={'cols': 80})}  # 小部件，Textarea，区域宽度 80

views.py

    def lalala(request):
        if request.method != 'POST':  # 判断请求的方法
            form = TopiTestModelFormcForm()
        else:
            form = TestModelForm(request.POST)

        if form.is_valid():  # 验证表单字段是否都填写了（默认都必须填写）
            form.save()  # 将表单数据写入数据库
            return HttpResponseRedirect(reverse('app_name:hahaha'))  # 重定向 URL

        context = {'form': form}
        return render(request, 'app_name/lalala.html', context)

### 装饰器

装饰器是放在函数定义前面的指令，类似于 java 中的注解

例如： views.py 视图函数

    from django.contrib.auth.decorators import login_required


    @login_required
    def test(request):

`@login_required` 指把函数 login_required() 作为装饰器， 用于检查用户是否登录，仅当已登录时，Django 才运行 test() 代码，如果未登陆，会重定向到登陆页面, 需要在 settings.py 中配置重定向路径, 在最后添加如下配置:

LOGIN_URL = '/app_name/login/'

### django-bootstrap

Bootstrap 工具库，为 web 程序设置样式。

### 安装

`pip3 install django-bootstrap3`

引入到项目中，在 settings.py 中配置：

    INSTALLED_APPS = [
        'django.contrib.admin',
        'django.contrib.auth',
        'django.contrib.contenttypes',
        'django.contrib.sessions',
        'django.contrib.messages',
        'django.contrib.staticfiles',
        'bootstrap3',   # 第三方应用
        'app_name'      # 我的应用
    ]

需要让 django-bootstrap3 包含 jQuery, 在 settins.py 后添加如下配置：

    BOOTSTRAP3 = {
        'include_jquery': True
    }

### Heroku

在 https://heroku.com/ 注册，验证的时候需要梯子

在 https://devcenter.heroku.com/articles/heroku-cli 查找安装方式，并安装

在项目中安装如下包包：

    (venv) afra55deMacBook-Air:learning_log yangshuai$ pip3 install dj-database-url     # 用于 Django 与 Heroku 使用的数据库通信
    (venv) afra55deMacBook-Air:learning_log yangshuai$ pip3 install dj-static       # 管理静态文件
    (venv) afra55deMacBook-Air:learning_log yangshuai$ pip3 install gunicorn        # 服务器软件，在在线环境下支持应用程序提供的服务

使用 freeze 命令将项目安装的所有包的名称写入到文件中：

    (venv) afra55deMacBook-Air:learning_log yangshuai$ pip3 freeze > requirements.txt

requirements.txt:

    dj-database-url==0.4.2
    dj-static==0.0.6
    Django==2.0
    django-bootstrap==0.2.4
    django-bootstrap3==9.1.0
    gunicorn==19.7.1
    pytz==2017.3
    static3==0.7.0

在 manage.py 相同目录下创建 runtime.txt, 来指定 Python 版本

runtime.txt:

    python-3.6.2

在 settings.py 中如下配置：

    cwd = os.getcwd()   # 获取当前到工作目录
    if cwd == '/app' or cwd[:4] == '/tmp':  # 在 Heroku 部署中，当签工作目录总是 /app
        import dj_database_url

        # 配置数据库
        DATABASES = {
            'default': dj_database_url.config(default='postgres://localhost')
        }

        # 支持 https 请求
        SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')

        # Only allow heroku to host the project.
        ALLOWED_HOSTS = ['*']
        DEBUG = False

        # Static asset configuration
        BASE_DIR = os.path.dirname(os.path.abspath(__file__))
        STATIC_ROOT = 'staticfiles'
        STATICFILES_DIRS = (
            os.path.join(BASE_DIR, 'static'),
        )

创建启动进程的 Procfile，来告诉 Heroku 启动了哪些进程, 在 manage.py 同目录下创建文件 `Procfile`, `Procfile` 内容如下：

    web: gunicorn mysite.wsgi --log-file -

这行，让 Heroku 将 gunicorn 用作服务器，并使用 mysite/wsgi.py 中的设置来启动应用程序

修改 wsgi.py， 使用 Cling 启动应用程序:

    """
    WSGI config for mysite project.

    It exposes the WSGI callable as a module-level variable named ``application``.

    For more information on this file, see
    https://docs.djangoproject.com/en/2.0/howto/deployment/wsgi/
    """

    import os

    from dj_static import Cling
    from django.core.wsgi import get_wsgi_application

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "mysite.settings")

    application = Cling(get_wsgi_application())

创建用于存储静态文件的目录，这个目录在 mysite/mysite/ 下，名字为 static,即 mysite/mysite/static/

尝试在本地使用 gunicorn 服务器（仅限 OS X, Linux 系统）：

    (venv) afra55deMacBook-Air:mysite yangshuai$ heroku local
    22:25:51 web.1   |  [2017-12-27 22:25:51 +0800] [4514] [INFO] Starting gunicorn 19.7.1
    22:25:51 web.1   |  [2017-12-27 22:25:51 +0800] [4514] [INFO] Listening at: http://0.0.0.0:5000 (4514)
    22:25:51 web.1   |  [2017-12-27 22:25:51 +0800] [4514] [INFO] Using worker: sync
    22:25:51 web.1   |  [2017-12-27 22:25:51 +0800] [4517] [INFO] Booting worker with pid: 4517
    22:27:54 web.1   |  Not Found: /favicon.ico


然后访问： http://localhost:5000 查看网页

使用 `<Control-C>` 停止服务

在激活的虚拟环境命令行中：
    heroku create   # 创建一个空项目
    git push heroku master  # 让 git 将项目分支 master 推送到 Heroku 创建的仓库中

推送到仓库后，命令行日志 `remote:        https://evening-headland-33619.herokuapp.com/ deployed to Heroku` 即显示访问这个项目的 URL

执行 `heroku ps` 核实是否正确启动了项目

    Free dyno hours quota remaining this month: 550h 0m (100%)
    For more information on dyno sleeping and how to upgrade, see:
    https://devcenter.heroku.com/articles/dyno-sleeping

    === web (Free): gunicorn mysite.wsgi --log-file - (1)
    web.1: up 2017/12/27 22:41:05 +0800 (~ 5m ago)

使用命令 `heroku open` 在浏览器打开应用

可以使用 `heroku run ` + python 命令在 Heroku 项目执行 python 命令

在 Heroku 上创建数据库: `heroku run python manage.py migrate`

在 Heroku 上创建超级用户使用 `heroku run bash` 命令，打开 bash 终端会话，然后在创建超级用户，与本地创建方法一致

重命名应用程序： `heroku apps:rename afra55-mysite`, 这时就可以使用好记的域名来访问项目来

如果对项目进行了修改，则先要提交代码到 git 仓库, 再将修改推送到 Heroku

    git push heroku master

注当在 settings.py 中，本地 DEBUG 模式关闭时，需要设置一个主机

    DEBUG = False

    ALLOWED_HOSTS = ['localhost']

在 mysite/mysite/templates 文件夹下创建类似 `404.html`, `500html` 然后在 setting.py 里面配置:

    TEMPLATES = [
        {
            'BACKEND': 'django.template.backends.django.DjangoTemplates',
            'DIRS': [os.path.join(BASE_DIR, 'mysite/templates')]    # 错误时，会展示我们指定的错误页面
            ,
            'APP_DIRS': True,
            'OPTIONS': {
                'context_processors': [
                    'django.template.context_processors.debug',
                    'django.template.context_processors.request',
                    'django.contrib.auth.context_processors.auth',
                    'django.contrib.messages.context_processors.messages',
                ],
            },
        },
    ]

当服务器错误时，会展示我们自己指定的错误页面

可以使用 Django 函数 get_object_or_404 自动在找不到对象时引发 404 错误，例如：

    test = get_object_or_404(Test, id=topic_id)  # test = Test.objects.get(id=test_id)

可以使用命令 `heroku apps:destroy --app mysite` 删除项目

### 小结

[https://github.com/Afra55/learning_log](https://github.com/Afra55/learning_log)

## 再谈 Web 框架: Django

在产线环境需要使用 Web 服务器的王者 Apache

建议使用 Apache 的 mod_wdgi 这个模块，[安装教程](https://docs.djangoproject.com/en/2.0/topics/install/#install-apache-and-mod-wsgi), [开发文档 ](https://docs.djangoproject.com/en/2.0/howto/deployment/wsgi/modwsgi/)

[数据库安装](https://docs.djangoproject.com/en/2.0/topics/install/#get-your-database-running)

[Django 安装](https://www.djangoproject.com/download/)

[Django 开源项目](http://pinaxproject.com)

| Django 项目文件名 | 描述 |
| :--------- | :--------- |
| `__init__.py` | 告诉 python 这是一个软件包 |
| urls.py | 全局 URL 配置 ("URLconf") |
| settings.py | 项目相关配置 |
| manage.py | 应用命令行接口 |

| Django 应用文件名 | 描述 |
| :--------- | :--------- |
| `__init__.py` | 告诉 python 这是一个包 |
| urls.py | 应用的 URL 配置 ("URLconf") |
| models.py | 数据模型 |
| views.py | 视图函数(MVC 中的控制器) |
| tests.py | 单元测试 |

可以在 settings 配置 数据库 [教程](https://docs.djangoproject.com/en/2.0/ref/settings/#databases)

    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',      # 引擎
            'NAME': 'mydatabase',       # 数据库路径
            'USER': 'mydatabaseuser',       # 用户名
            'PASSWORD': 'mypassword',       # 密码
            'HOST': '127.0.0.1',        
            'PORT': '5432',
        }
    } 

在配置完 INSTALLED_APPS 以及对应的 models.py 后，执行 `manage.py syncdb`  Django 会找到每个模型然后进行数据库表的创建

Django 使用的是 MTV 模式, 即 模型-模版-视图, 数据 模型 保持 不变， 但 视图 在 Django 中 是 模板， 因为 模板 用来 定义 用户 可见 的 内容。 最后， Django 中的 视图 表示 视图 函数， 它们 组成 控制器 的 逻辑

Django 提供 了 Python 应用 shell， 通过 这个 工具， 可以 实例 化 模型， 并与 应用 交互, 启动命令 `manage.py shell`, [更多信息](https://docs.djangoproject.com/en/2.0/intro/tutorial02/#playing-with-the-api)

[通用视图](https://docs.djangoproject.com/en/2.0/ref/class-based-views/base/), 即只要在 urls.py 中配置，既可以重定向链接:

    from django.urls import path
    from django.views.generic.base import RedirectView

    urlpatterns = [
        path('go-to-django/', RedirectView.as_view(url='https://djangoproject.com'), name='go-to-django'),
    ]

在 test.py 中写单元测试，下面是一个例子：

    from datetime import datetime
    from django.test import TestCase
    from django.test.client import Client
    from example.models import ExamplePost

    class ExamplePostTest(TestCase):
        def test_obj_create(self):      # 单元测试的测试方法必须以 'test_' 开头
            ExamplePost.objects.create(title='raw title',
                body='raw body', timestamp=datetime.now())
            self.assertEqual(1, ExamplePost.objects.count())
            self.assertEqual('raw title',
                ExamplePost.objects.get(id=1).title)

        def test_home(self):
            """
            用于检测用户界面
            如果子类化 django.test.TestCase， 会自动免费获得一个 Django 测试客户端 实例， 并直接使用 self.client 来引用它
            """
            response = self.client.get('/example/')     # 调用应用主页面
            self.failUnlessEqual(response.status_code, 200)     # 确保返回的状态码是 200

        def test_slash(self):
            response = self.client.get('/')
            self.assertIn(response.status_code, (301, 302))

        def test_empty_create(self):
            response = self.client.get('/example/create/')
            self.assertIn(response.status_code, (301, 302))

        def test_post_create(self):
            “”“
            模拟用户 POST 请求
            ”“”
            response = self.client.post('/example/create/', {
                'title': 'post title',
                'body': 'post body',
            })
            self.assertIn(response.status_code, (301, 302))
            self.assertEqual(1, ExamplePost.objects.count())
            self.assertEqual('post title',
                ExamplePost.objects.get(id=1).title)

[Django 验证系统](https://docs.djangoproject.com/en/2.0/topics/auth/)

当下以返回的数据格式普遍为 Json 格式， 下面是用 Django 返回 Json 数据的示例：

    import json  
    from django.http import HttpResponse  
      

    def get_json_data(request):
        response_data = {'result':'success', 'statue': 0}      # 用字典
        return HttpResponse(json.dumps(response_data), content_type="application/json") 
































