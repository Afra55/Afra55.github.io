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

## pygal

[http://www.pygal.org](http://www.pygal.org)

pygal 可以让图标具有交互性

### 安装

MacOs `pip3 install --user pygal`

Windows `python -m pip install --user pygal`

### 绘制直方图

    bar = pygal.Bar()   # 获取 Bar 条形图
    bar.title = 'Title'     # 图标标题
    bar.x_labels = ['1', '2', '3', '4', '5', '6']   # 横轴刻度值
    bar.x_title = "X Title"     # 横轴标题
    bar.y_title = "Y Title"     # 纵轴标题
    bar.add('Values Name', value_list)  # 第一个实参代表这个值的含义，第二个实参是个列表代表条形图的纵轴值
    bar.render_to_file('test_visual.svg')      # 把图标渲染成 svg 格式的文件保存起来







