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

    import sys
    import pygame

    class View:

        def __init__(self, screen):     # screen 是一个 surface
            self.screen = screen
            self.image = pygame.image.load_basic('images/view.bmp')     # 加载一个图像, 这个函数返回一个 surface 
            self.rect = self.image.get_rect()           # 获取 rect 属性
            self.screen_rect = screen.get_rect()        # 获取绘制屏幕的 rect
            self.rect.centerx = self.screen_rect.centerx    # 设置 view 水平居中, 中心点的坐标 x
            self.rect.bottom = self.screen_rect.bottom      # 设置 view 在屏幕底部

        def blit_me(self):
            self.screen.blit(self.image, self.rect)     # 将图像绘制在屏幕上


    def run_game():

        pygame.init()   # 初始化游戏并创建一个屏幕对象
        screen = pygame.display.set_mode((1200, 800))
        pygame.display.set_caption("Afra55 game")   # 设置标题
        bg_color = (255, 255, 255)

        view = View(screen)

        while True:

            # 监视键盘和鼠标事件
            for event in pygame.event.get():
                if event.type == pygame.QUIT:
                    sys.exit()

                screen.fill(bg_color)

                view.blit_me()

            pygame.display.flip()   # 让绘制的屏幕显示出来, 即更新屏幕显示


    run_game()


pygame.init() 初始化背景设置

pygame.display.set_mode((1200, 800)) 创建显示窗口并返回一个 surface 对象，所有图形绘制都在这个窗口内, 实参是一个元组用于指定尺寸

(0, 0) 原点在屏幕左上角，向下向右增大

surface 代表屏幕的一部分，用于显示游戏元素

pygame.event.get() 来监听事件，按键或者鼠标移动，可以用 循环来捕捉事件

pygame 的颜色以 RGB（0-255）值指定，红（255, 0, 0）, 绿（0, 255, 0）, 蓝（0, 0, 255）

surface 的 fill() 方法接受一个颜色实参，来设置背景的填充颜色

surface 的 blit(surface， rect) 方法根据指定的位置 rect 绘制实参 surfcae 到调用这个方法的 surface 上

使用 sys.exit() 进行退出





















