---
layout: post
title:  "Python Third Step"
date:   2017-12-11 23:03
categories: Python
comments: true
description: Python Third Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2017/12/11/python-third-step/](http://afra55.github.io/2017/12/11/python-third-step/)


# 图表

数据可视化

数据挖掘

数学绘图库 matplotlib, 可以制作图表如折线图，散点图

pygal 包， 用于生成图表（这种图表可以控制调整来在各种设备合适的显示）

## matplotlib

[http://www.matplotlib.org](http://www.matplotlib.org)

这里有大量的例子，还有源码，满足生活的各个需求

matplotlib 更多的用于绘制折线图，散列图

### 安装

MacOs 
`pip3 install --user matplotlib`

Windows 
`https://developer.microsoft.com/zh-cn/windows` 
`https://pypi.python.org/pypi/matplotlib/` 下载 whl 到项目文件夹中

`.whl` 安装命令 `python -m pip install --user xx.whl`

### 绘制简单折线图

   import matplotlib.pyplot as pyplot


    values = [1, 2, 3, 4, 5]
    squares = [1, 4, 9, 16, 25]
    pyplot.plot(values, squares, linewidth=5)   # 第一个实参列表代表横轴数据，第二个实参代表纵轴数据，linewidth 折线的宽度
    pyplot.title('Afra55 Lucky Numbers', fontsize=24)   # 标题，及标题字体大小
    pyplot.xlabel('Value', fontsize=14)     # 横轴轴标签
    pyplot.ylabel('Luck Number', fontsize=14)   # 纵轴标签

    pyplot.tick_params(axis='both', labelsize=14)   # 设置刻度的样式，可配置多种多样的设置

    pyplot.show()


`pyplot.show()` 打开 matplotlib 查看器，并显示绘制的图形

    pyplot.plot(x_values, y_values_1)
    pyplot.plot(x_values, y_values_2)
    pyplot.fill_between(x_values, y_values_1, y_values_2, facecolor='blue', alpha=0.1)

可以同时绘制多个折线

pyplot.fill_between() 以颜色 facecolor 来填充两个折线间的区域


### 绘制简单散点图

    import matplotlib.pyplot as pyplot


    pyplot.scatter(3, 9, s=200)     # s 代表点的尺寸

    pyplot.title('Afra55 Luck Numbers')
    pyplot.xlabel('Value', fontsize=14)
    pyplot.ylabel('Luck Number', fontsize=14)
    pyplot.tick_params(axis='both', which='major', labelsize=14)
    pyplot.show()

函数 scatter(x, y) 在指定位置 (x, y) 坐标位置绘制一个点

    x_values = [1, 2, 3, 4, 5]
    y_values = [1, 4, 9, 16, 25]

    pyplot.scatter(x_values, y_values, s=100)   # 绘制一些列的点 x_values 对应横轴，y_values 对应纵轴

`scatter(x_values, y_values)` 如上所示，即绘制点：(1, 1), (2, 4), (3, 9), (4, 16), (5, 25)

`pyplot.axis([x_min_value, x_max_value, y_min_value, y_max_value])`
axis() 函数指定每个坐标轴的取值范围， x_min_value 和 x_max_value 分别指横轴的最小值和最大值， y_min_value 和 y_max_value 分别指纵轴的最小值和最大值

`pyplot.scatter(x_values, y_values, s=100, edgecolor='none', c='red')` edgecolor 轮廓颜色， c 数据点颜色 可以是颜色字符串也可以是 RGB(红, 绿, 蓝) 三个值是 0~1 之间的小书值来表示比重

`pyplot.scatter(x_values, y_values, s=100, edgecolor='none', c=y_values, cmap=pyplot.cm.get_cmap('Blues'))`
cmap(colormap) 颜色映射，c 传入一个列表指绘制的顺序，即 cmap 映射的点的顺序，cmap 设置以哪种颜色映射 这里使用了内置的一组颜色 具体可以看 pyplot.colormaps

查看所有颜色映射： http://matplotlib.org/tutorials/index.html#tutorials-colors

    pyplot.savefig('test.png', inches='tight')  # 第一个实参指名字，第二个指将多余的空白区域裁剪掉 默认不裁剪
    pyplot.show()

savefig() 保存图表, 在 show() 之前调用

    pyplot.axes().get_xaxis().set_visible(False)    # 隐藏横轴
    pyplot.axes().get_yaxis().set_visible(False)    # 隐藏纵轴

`pyplot.figure(figsize=(width, height))` figure() 用于设置图标的宽度，高度，分辨率，背景色， figsize 用于指定绘制窗口的尺寸 单位是英寸

`pyplot.autofmt_xdate()` 如果坐标刻度显示的拥挤，可以使用 autofmt_xdate() 来使其清晰, 不会看到重叠在一起的刻度显示

## pygal

[http://www.pygal.org](http://www.pygal.org)

pygal 可以让图标具有交互性

### 安装

MacOs `pip3 install --user pygal`

Windows `python -m pip install --user pygal`

### 绘制直方图
    
    my_config = pygal.Config()      # Config() 可以配置各种参数，具体看源码
    my_config.x_label_rotation = 45     # 横轴刻度以 斜 45度角展示
    bar = pygal.Bar(my_config)   # 获取 Bar 条形图
    bar.title = 'Title'     # 图标标题
    bar.x_labels = ['1', '2', '3', '4', '5', '6']   # 横轴刻度值
    bar.x_title = "X Title"     # 横轴标题
    bar.y_title = "Y Title"     # 纵轴标题
    bar.add('Values Name', value_list)  # 第一个实参代表这个值的含义，第二个实参是个列表代表条形图的纵轴值
    bar.render_to_file('test_visual.svg')      # 把图标渲染成 svg 格式的文件保存起来

### 可以自定义提示内容

    value_list = [
        {'value': 110, 'label': 'Label1'},
        {'value': 112, 'label': 'Label2'},
        {'value': 132, 'label': 'Label2'}
    ]
    bar.add('Values Name', value_list)

这样鼠标交互时，就会提示 自定义的 lable 内容, 需要严格按照 {'value': value, 'label': babel} 形式写

### 添加可点击链接

    values = [
        {'value': 110, 'label': 'Label1', 'xlink': 'http://afra55.github.io'},
        {'value': 112, 'label': 'Label2'},
        {'value': 132, 'label': 'Label2'}
    ]
    bar.add('Values Name', value_list)

这样鼠标交互时，单机第一条形就可以跳转到指定的链接上， 是可选内容, 需要严格按照 {'value': value, 'label': babel, 'xlink': link} 形式写

### World map 世界地图

[http://www.pygal.org/en/stable/documentation/types/maps/pygal_maps_world.html](http://www.pygal.org/en/stable/documentation/types/maps/pygal_maps_world.html)

安装： `pip3 install pygal_maps_world`

#### 制作世界地图

    from pygal_maps_world import maps


    worldmap_chart = maps.World()
    worldmap_chart.title = 'Some countries'     # 设置标题
    worldmap_chart.add('F countries', ['fr', 'fi'])     # 第一个实参设置标签，第二个实参是列表表示要突出的国家，列表的元素是国家码
    worldmap_chart.add('M countries', ['ma', 'mc', 'md', 'me', 'mg',
                                       'mk', 'ml', 'mm', 'mn', 'mo',
                                       'mr', 'mt', 'mu', 'mv', 'mw',
                                       'mx', 'my', 'mz'])
    worldmap_chart.add('U countries', ['ua', 'ug', 'us', 'uy', 'uz'])      
    # 每次调用 add() 都会自动选择一种颜色, 并在左上角显示标签和对应的颜色
    worldmap_chart.render_to_file('world.svg')

### 在地图上显示数字　

    worldmap_chart = maps.World()
    worldmap_chart.title = 'Minimum deaths by capital punishement (source: Amnesty International)'
    worldmap_chart.add('In 2012', {
      'af': 14,
      'bd': 1,
      'by': 3,
      'cn': 1000,
      'gm': 9,
      'in': 1,
      'ir': 314,
      'iq': 129,
      'jp': 7,
      'kp': 6,
      'pk': 1,
      'ps': 6,
      'sa': 79,
      'so': 6,
      'sd': 5,
      'tw': 6,
      'ae': 1,
      'us': 43,
      'ye': 28
    })      # add() 的第二个实参是字典，key 是国别码，value 是数字值
    worldmap_chart.render_to_file('world.svg')



还可以针对 country 设置不同有意义的值

#### 世界板块

    supra = maps.SupranationalWorld()
    supra.add('Asia', [('asia', 1)])
    supra.add('Europe', [('europe', 1)])
    supra.add('Africa', [('africa', 1)])
    supra.add('North america', [('north_america', 1)])
    supra.add('South america', [('south_america', 1)])
    supra.add('Oceania', [('oceania', 1)])
    supra.add('Antartica', [('antartica', 1)])
    supra.render_to_file('world_test.svg')

还可以展示地图板块　maps.SupranationalWorld()

#### 国别码

    from pygal_maps_world import i18n

    for country_code in sorted(i18n.COUNTRIES.keys()):
        print(country_code, i18n.COUNTRIES[country_code])

i18n.COUNTRIES 字典存储了两位国别码

## CSV

CSV, 每一行的内容以逗号分隔的值, 例 test.csv: 

    64,56,50,53,51,48,96,83,58,30.19,30.00,29.79,10,10,10,7,4,,0.00,7,,337
    64,56,50,53,51,48,96,83,58,30.19,30.00,29.79,10,10,10,7,4,,0.00,7,,337


CSV 的第一行通常是数据的描述

    import csv


    filename = 'text.csv'
    with open(filename) as f:
        reader = csv.reader(f)      # 创建与文件相关联的阅读器对象
        first_row = next(reader)    # 返回第一行数据，以逗号分隔，每个数据都作为元素存储到列表中, 返回这个列表
        print(first_row)

        for row in reader:      # 遍历读取之后的行，row 是列表，存储该行的所有数据
            print(row[:])

csv 的函数 next() 用于返回文件的下一行，第一次调用即第一行

    for index, value in enumerate(list):     # 获取列表中每个元素的索引及值
        print(index, value)

enumerate() 用于获取列表每个元素的索引和值

## JSON

### 回顾

    import json

    filename = 'file/json_file.json'

    names = ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']

    with open(filename, 'w') as file_obj:
        json.dump(names, file_obj)  # 存储了一个列表

    with open(filename) as file_obj:
        print(file_obj.read())      # ["Afra55", "Bfra55", "Cfra55", "Dfra55", "Fra55"]

json.dump(存储的数据，用于存储数据的文件对象) 将数据存储到文件中，通常文件扩展名实 .json

    import json

    filename = 'file/json_file.json'

    with open(filename) as file_obj:
        temp_names = json.load(file_obj)    # 返回了一个列表

    print(temp_names)   # ['Afra55', 'Bfra55', 'Cfra55', 'Dfra55', 'Fra55']

json.load(文件对象) 读取文件并存储到变量中返回

### 举例

test.json

    [
      {
        "Country Name": "Arab World",
        "Country Code": "ARB",
        "Year": "1960",
        "Value": "96388069"
      },
      {
        "Country Name": "Arab World",
        "Country Code": "ARB",
        "Year": "1961",
        "Value": "98882541.4"
      }
    ]

这个 json 格式是 列表中包含字典元素

    with open(filename) as f:
        pop_data = json.load(f)     # 读取文件

        for pop_dict in pop_data:   # 遍历列表
            year = pop_dict['Year']     # 获取字典元素key相对应的值
            country_name = pop_dict['Country Name']
            population = pop_dict['Value']


## 时间格式化

    from datetime import datetime


    date = datetime.strptime('2018-1-1', '%Y-%m-%d')
    print(date)     # 2018-01-01 00:00:00

`strptime(date_string, format)` 第一个实参是日期字符串，第二个实参是日期的解析格式

    %y 两位数的年份表示（00-99）
    %Y 四位数的年份表示（000-9999）
    %m 月份（01-12）
    %d 月内中的一天（0-31）
    %H 24小时制小时数（0-23）
    %I 12小时制小时数（01-12）
    %M 分钟数（00=59）
    %S 秒（00-59）
    %a 本地简化星期名称
    %A 本地完整星期名称
    %b 本地简化的月份名称
    %B 本地完整的月份名称
    %c 本地相应的日期表示和时间表示
    %j 年内的一天（001-366）
    %p 本地A.M.或P.M.的等价符
    %U 一年中的星期数（00-53）星期天为星期的开始
    %w 星期（0-6），星期天为星期的开始
    %W 一年中的星期数（00-53）星期一为星期的开始
    %x 本地相应的日期表示
    %X 本地相应的时间表示
    %Z 当前时区的名称
    %% %号本身

## Web API

获取 GitHub 当前托管的 Python 项目，按照 star 数排序
[https://api.github.com/search/repositories?q=language:python&sort=stars](https://api.github.com/search/repositories?q=language:python&sort=stars)

### requests

    pip3 install --user requests

requests 让 Python 向网站请求信息并检查返回的响应

    import requests


    url = 'https://api.github.com/search/repositories?q=language:python&sort=stars'
    r = requests.get(url)   # 执行 Get 请求
    print('Status code:', r.status_code)    # Status code: 200

    request_dict = r.json()     # 转换返回的 json字串为一个对象， 这个响应返回的是字典类型的 json 数据

    print(request_dict.keys())  # dict_keys(['total_count', 'incomplete_results', 'items'])

r.status_code 属性是返回码，用于判断是否请求成功, 200 即请求成功

### https://news.ycombinator.com

在这个网站获取文章

## 附录

    import requests


    url = 'https://api.github.com/search/repositories?q=language:python&sort=stars'
    r = requests.get(url)   # 执行 Get 请求
    print('Status code:', r.status_code)    # Status code: 200

    request_dict = r.json()     # 转换返回的 json字串为一个对象， 这个响应返回的是字典类型的 json 数据

    print('Total repositories: ', request_dict['total_count'])

    repo_dicts = request_dict['items']
    print('Repositories returned:', len(repo_dicts))

    with open(r'python_most_like_top_30.txt', 'a') as file_object:
        file_object.write("| name | homepage | html_nrl | description |\n")
        file_object.write("| :-------- | :-------- | :-------- | :-------- |\n")
        for item in repo_dicts:
            file_object.write("| {} | {} | {} | {} |\n".format(
                item['name'], str(item['homepage']), item['html_url'], str(item['description'])))

2017.12.15 Github 上 Python 项目 star top 30

| name | homepage | html_nrl | description |
| :-------- | :-------- | :-------- | :-------- |
| awesome-python | https://awesome-python.com/ | https://github.com/vinta/awesome-python | A curated list of awesome Python frameworks, libraries, software and resources |
| httpie | https://twitter.com/clihttp | https://github.com/jakubroztocil/httpie | Modern command line HTTP client – user-friendly curl alternative with intuitive UI, JSON support, syntax highlighting, wget-like downloads, extensions, etc.  https://httpie.org |
| thefuck |  | https://github.com/nvbn/thefuck | Magnificent app which corrects your previous console command. |
| youtube-dl | http://rg3.github.io/youtube-dl/ | https://github.com/rg3/youtube-dl | Command-line program to download videos from YouTube.com and other video sites |
| flask | http://flask.pocoo.org/ | https://github.com/pallets/flask | A microframework based on Werkzeug, Jinja2 and good intentions |
| django | https://www.djangoproject.com/ | https://github.com/django/django | The Web framework for perfectionists with deadlines. |
| requests | http://python-requests.org | https://github.com/requests/requests | Python HTTP Requests for Humans™ ✨🍰✨ |
| awesome-machine-learning | None | https://github.com/josephmisiti/awesome-machine-learning | A curated list of awesome Machine Learning frameworks, libraries and software. |
| ansible | https://www.ansible.com/ | https://github.com/ansible/ansible | Ansible is a radically simple IT automation platform that makes your applications and systems easier to deploy. Avoid writing scripts or custom code to deploy and update your applications— automate in a language that approaches plain English, using SSH, with no agents to install on remote systems. |
| models |  | https://github.com/tensorflow/models | Models and examples built with TensorFlow |
| scrapy | https://scrapy.org | https://github.com/scrapy/scrapy | Scrapy, a fast high-level web crawling & scraping framework for Python. |
| scikit-learn | http://scikit-learn.org | https://github.com/scikit-learn/scikit-learn | scikit-learn: machine learning in Python |
| keras | http://keras.io/ | https://github.com/keras-team/keras | Deep Learning for humans |
| shadowsocks |  | https://github.com/shadowsocks/shadowsocks | None |
| big-list-of-naughty-strings | None | https://github.com/minimaxir/big-list-of-naughty-strings | The Big List of Naughty Strings is a list of strings which have a high probability of causing issues when used as user-input data. |
| system-design-primer |  | https://github.com/donnemartin/system-design-primer | Learn how to design large-scale systems. Prep for the system design interview.  Includes Anki flashcards. |
| certbot |  | https://github.com/certbot/certbot | Certbot is EFF's tool to obtain certs from Let's Encrypt and (optionally) auto-enable HTTPS on your server.  It can also act as a client for any other CA that uses the ACME protocol. |
| XX-Net |  | https://github.com/XX-net/XX-Net | a web proxy tool |
| incubator-superset |  | https://github.com/apache/incubator-superset | Apache Superset (incubating) is a modern, enterprise-ready business intelligence web application |
| you-get | https://you-get.org/ | https://github.com/soimort/you-get | :arrow_double_down: Dumb downloader that scrapes the web |
| CppCoreGuidelines | http://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines | https://github.com/isocpp/CppCoreGuidelines | The C++ Core Guidelines are a set of tried-and-true guidelines, rules, and best practices about coding in C++ |
| YouCompleteMe | http://valloric.github.io/YouCompleteMe/ | https://github.com/Valloric/YouCompleteMe | A code-completion engine for Vim |
| Deep-Learning-Papers-Reading-Roadmap |  | https://github.com/songrotek/Deep-Learning-Papers-Reading-Roadmap | Deep Learning papers reading roadmap for anyone who are eager to learn this amazing tech! |
| sentry | https://sentry.io | https://github.com/getsentry/sentry | Sentry is a cross-platform crash reporting and aggregation platform. |
| tornado | http://www.tornadoweb.org/ | https://github.com/tornadoweb/tornado | Tornado is a Python web framework and asynchronous networking library, originally developed at FriendFeed. |
| cpython | https://www.python.org/ | https://github.com/python/cpython | The Python programming language |
| reddit |  | https://github.com/reddit/reddit | historical code from reddit.com |
| python-patterns |  | https://github.com/faif/python-patterns | A collection of design patterns/idioms in Python |
| macOS-Security-and-Privacy-Guide |  | https://github.com/drduh/macOS-Security-and-Privacy-Guide | A practical guide to securing macOS. |
| incubator-mxnet | http://mxnet.io | https://github.com/apache/incubator-mxnet | Lightweight, Portable, Flexible Distributed/Mobile Deep Learning with Dynamic, Mutation-aware Dataflow Dep Scheduler; for Python, R, Julia, Scala, Go, Javascript and more |






