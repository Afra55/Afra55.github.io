---
layout: post
title:  "Python Second Step"
date:   2017-12-6 20:36
categories: Python
comments: true
description: Python Second Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2017/12/6/python-second-step/](http://afra55.github.io/2017/12/6/python-second-step/)


# 项目

## pip

如果没有 pip 则通过下面的链接下载 get-pip.py 到本地并运行

[https://bootstrap.pypa.io/get-pip.py](https://bootstrap.pypa.io/get-pip.py)

或者通过如下链接安装

[https://pip.pypa.io](https://pip.pypa.io)

`sudo python3 get-pip.py`

## Pygame

[http://www.pygame.org](http://www.pygame.org)

安装 Pygame 依赖的库 `brew install hg sdl sdl_image sdl_mixer sdl_ttf`

安装 Pygame `pip3 install --user hg+http://bitbucket.org/pygame/pygame`

或者在 https://bitbucket.org/pygame/pygame/downloads/ 下载Pygame对应文件进行安装

.whl 安装方法 `python -m pip install --user xx.whl`

### 创建

`import pygame`

要使用 pygame 则要先初始化: `pygame.init()`

接下来需要创建一个显示窗口，并持有这个窗口： `screen = pygame.display.set_mode((1200, 800))`

pygame.display.set_mode((1200, 800)) 创建显示窗口并返回一个 surface 对象，所有图形绘制都在这个窗口内, 实参是一个元组用于指定尺寸

(0, 0) 原点在屏幕左上角，向下向右增大

surface 代表屏幕的一部分，用于显示游戏元素

设置窗口标题： `pygame.display.set_caption("Afra55 game")`

开始游戏的主要循环：`while True:`  不断循环来处理所有发生的事物，比如监听按键，绘制图形等

    while True:

        # 监视键盘和鼠标事件
        for event in pygame.event.get():
        if event.type == pygame.QUIT:       # 退出, type 指类型
                sys.exit() 
            elif event.type == pygame.KEYDOWN:  # 按键
                if event.key == pygame.K_RIGHT: # 向右箭头 key 指具体的键

        screen.fill(bg_color)
        pygame.display.flip()   # 让绘制的屏幕显示出来, 即更新屏幕显示

pygame.event.get() 来监听事件，按键或者鼠标移动，可以用 循环来捕捉事件

pygame 的颜色以 RGB（0-255）值指定，红（255, 0, 0）, 绿（0, 255, 0）, 蓝（0, 0, 255）

surface 的 fill() 方法接受一个颜色实参，来设置背景的填充颜色: `screen.fill(bg_color)`

surface 的 blit(surface， rect) 方法根据指定的位置 rect 绘制实参 surfcae 到调用这个方法的 surface 上

创建一个图片 surface : `pygame.image.load_basic('images/view.bmp')`

获取 surface 的 rect 属性： `image.get_rect()`, rect 包含 x, y, center, centerx, centery, top, bottom, left, right, height, width

显示所有的绘制：`pygame.display.flip()`

`from pygame.sprite import Sprite` Sprite 俗称精灵，可以将相关元素编组，就可以同时操作编组中的所有元素

`from pygame.sprite import Group` Group 编组，用于存储 Sprite 类似列表，并提供来额外的功能, 调用 update() 方法，则编组中所有的 Sprite 的 update 方法就被调用

    sprite = Sprite()   # 创建精灵
    group.add(sprite)   # 把精灵加入到编组中
    for sprite in group.sprites():    # 遍历编组
        print(sprite)

    group.draw(screen)

注： 当使用 for 循环删除列表时，遍历的应该是列表的副本即 调用列表的 copy() 方法或使用切片来获取副本

`pygame.draw.rect(self.screen, self.color, self.rect)` draw.rect() 用于绘制 一个 rect 大小的背景是 color 的方块

`group.draw(screen)` 对编组使用 draw(surface) 时，pygame 会自动绘制编组的每个元素到实参 surface 中，绘制的位置由元素的 rect 属性决定

`for sprite in group.sprites():` 便利编组的所有元素

`pygame.sprite.groupcollide(groupa, groupb, dokilla, dokillb)`  
获取 groupa 和 groupb 两个编组中元素位置有重叠的元素，返回字典，key 是 groupa 中的元素，value 是 groupb 中的元素 是个列表， dokilla 和 dokillb 布尔类型， True 指删除编组中的该元素

`group.empty()` 清空编组中的所有元素

`pygame.sprite.spritecollideany(sprite, group)` 
spritecollideany 方法第一个实参是精灵，第二个是编组，用于检测精灵是否和编组的元素位置有重叠, 如果没有重叠 返回 None，有重叠 则返回 group 中的这个元素

位置重叠，由元素的 rect 判断

    from time import sleep


    sleep(0.5)

`sleep(seconds)`  让程序睡眠 seconds 秒













