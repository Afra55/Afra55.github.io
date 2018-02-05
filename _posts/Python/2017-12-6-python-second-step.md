---
layout: post
title:  "Python Second Step: GUI 编程"
date:   2017-12-6 20:36
categories: Python
comments: true
description: Python Second Step！
---

* content
{:toc}

# 本文

[http://afra55.github.io/2017/12/06/python-second-step/](http://afra55.github.io/2017/12/06/python-second-step/)



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

`def fill(self, color, rect=None, special_flags=0)` 如果传入 rect 则在 rect 位置区域上绘制背景 color

surface 的 blit(surface， rect) 方法根据指定的位置 rect 绘制实参 surfcae 到调用这个方法的 surface 上

### 图片

创建一个图片 surface : `pygame.image.load_basic('images/view.bmp')`

获取 surface 的 rect 属性： `image.get_rect()`, rect 包含 x, y, center, centerx, centery, top, bottom, left, right, height, width

`rect.collidepoint(x, y)` 返回一个 布尔类型，用于判断 （x, y） 这个点是否在 rect 区域内

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

### 文本

`import pygame.ftfont` pygame.ftfont 能够再屏幕上渲染文本

`font = pygame.ftfont.SysFont(None, 48)` 返回一个 FontType 指用什么字体来渲染文本， 实参None指使用默认字体， 48指文本等字号，详细配置看文档

`msg_image = font.render(msg, True, self.text_color, self.button_color)`

`def render(self, text, antialias, color, background=None)` 
将 text 文本转换为图像，并返回图像 surface，antialias 布尔类型是否开启反锯齿功能， color 指文本颜色， background 指背景色（默认是透明色）

`not Flast == True`

`not True == False`

`not` 类似 java 中的 `!`

`def round(number, ndigits=None)` round() 让小数精确到小数点后 ndigits 位，如果 ndigits 为负数， round() 将圆整到最近的 10,100,100 等多整数倍

`"{:,}".format(rounded_score)` 将数值转化为字符串时，在其中插入逗号，例如 1,000,000

### 小结

Python编程 从入门到实践 里面的打飞机游戏很有意思，做完后有了更深一层的认识 

https://github.com/Afra55/alien_invasion

## GUI 编程

图形用户界面编程

python 默认的 UI 工具包 tkinter ，它基于 Tk 工具包（最初为工具命令语言 Tcl 设计的）

    1. 导入 Tkinter 模块
    2. 创建 一个 顶层 窗口 对象， 用于 容纳 整个 GUI 应用
    3. 在 顶层 窗口 对象 之上（ 或者“ 其中”） 构建 所有 的 GUI 组件（ 及其 功能）
    4. 通过 底层 的 应用 代码 将 这些 GUI 组件 连接 起来
    5. 进入 主事 件 循环

创建顶层窗口,可以创建多个顶层窗口，但是只能有一个根窗口

    tkinter.Tk()

顶层 的 根 窗口 对象 包含 组成 GUI 应用 的 所有 小窗 口 对象。 它们 可能 是 文字 标签、 按钮、 列表 框 等。 这些 独立 的 GUI 组件 称为 控 件。 所以 当 我们 说 创建 一个 顶层 窗口 时， 只是 表示 需要 一个 地方 来 摆放 所 有的 控 件

事件 可以 包括 按钮 按下（ 及 释放）、 鼠标 移动、 敲击 回车 键 等。 一个 GUI 应用 从 开始 到 结束 就是 通过 整套 事件 体系 来 驱动 的。 这种 方式 称为 事件 驱动 处理

布局管理器有三种：Placer(设置控件的大小和位置来配置摆放控件),Packer(填充控件到父控件中)，Grid(网格)

摆放完控件后进入主循环：tkinter.mainloop()

| 常用控件 | 描述 |
| :--------- | :--------- |
| Button | 用于包含文本或图像，并提供额外事件，例如 鼠标悬浮、按下、释放、键盘事件 |
| Canvas | 提供绘制图像到功能（线段，椭圆，多边形，矩形），可以包含图像或位图 |
| CheckButton | 多选框 |
| Entry | 单行文本框，用于收集键盘输入 |
| Frame | 包含其他控件到纯容器 |
| Label | 包含文本或图像　|
| LabelFrame | 一个 Frame 可以包含文本或图像 |
| Listbox | 选项列表 |
| Menu | 按下 Menubutton 后弹出的选项列表，用户可以从中选择 |
| Menubutton | 用于包含 Menu |
| Message | 消息，多行文本框 |
| PanedWindow | 容器控件，可以控制其他控件在其中摆放 |
| Radiobutton | 单选框 |
| Scale | 线性'滑块'控件，根据起始和结束值，来返回当前值 |
| Scrollbar | 为 Text、Canvas、Listbox、Entry 提供滑动功能 |
| Spinbox | Entry 和 Button 的组合，可以对值进行调整 |
| Text | 多行文本框，用于收集或显示用户输入的文本 |
| Toplevel | 于 Frame 类似，并提供一个单独的窗口　|

### Label 示例

    import tkinter


    if __name__ == '__main__':
        top = tkinter.Tk()
        label = tkinter.Label(top, text='Hello World!')
        label.pack()
        tkinter.mainloop()

### Button 示例

    import tkinter


    if __name__ == '__main__':
        top = tkinter.Tk()
        quit_btn = tkinter.Button(top, text='Hello World!', command=top.quit)   # command 用于绑定点击的回调函数
        quit_btn.pack()
        tkinter.mainloop()

Packer 默认垂直排列

    import tkinter


    if __name__ == '__main__':
        top = tkinter.Tk()

        hello = tkinter.Label(top, text='Hello Afra55!')
        hello.pack()

        quit_btn = tkinter.Button(top, text='QUIT!', command=top.quit, bg='red', fg='white')
        quit_btn.pack(fill=tkinter.X, expand=1)
        
        tkinter.mainloop()

### Scale 示例

    import tkinter


    def resize(ev=None):
        hello.config(font='华康少女字体 -%d bold' % scale.get())


    if __name__ == '__main__':
        top = tkinter.Tk()
        top.geometry('400x400')

        hello = tkinter.Label(top, text='床前明月光!', font='华康少女字体 -12 bold')
        hello.pack(fill=tkinter.Y, expand=1)

        scale = tkinter.Scale(top, from_=10, to=40, orient=tkinter.HORIZONTAL, command=resize)
        scale.set(12)
        scale.pack(fill=tkinter.X, expand=1)

        quit_btn = tkinter.Button(top, text='QUIT!', command=top.quit, activeforeground='white', activebackground='red')
        quit_btn.pack()

        tkinter.mainloop()

### 偏函数

使用 偏 函数， 可以 通过 有效地“ 冻结” 那些 预先 确定 的 参数 来 缓存 函数 参数， 然后 在 运行时， 当获 得 需要 的 剩余 参数 后， 可以 将它 们 解冻， 传递 到 最终 的 参数 中， 从而 使用 最终 确定 的 所有 参数 去 调用 函数

    from functools import partial
    from tkinter import Tk, Button, X
    from tkinter.messagebox import showinfo, showwarning, showerror  # tk 对话框

    warn = 'warn'
    error = 'error'
    info = 'info'

    SIGNS = {
        'error one': error,
        'warn one': warn,
        'info one': info,
        'error two': error,
        'warn two': warn,
        'info two': info,
    }

    error_cb = lambda: showerror('Error', 'Error Button Pressed!')
    warn_cb = lambda: showwarning('Warning', 'Warning Button Pressed!')
    info_cb = lambda: showinfo('Info', 'Info Button Pressed!')

    top = Tk()
    top.geometry('400x400')
    top.title('偏函数示例')
    Button(top, text='退出', command=top.quit, bg='red', fg='white').pack()

    # 这里使用了两阶偏函数
    my_button = partial(Button, top)    # 第一阶模版化两 Button 和 top，即每次调用 my_button 就会调用 Button类 并把 top 作为第一个参数
    ErrorButton = partial(my_button, command=error_cb, bg='white', fg='red')    # 第二阶偏函数，使用第一阶并模版化，创建按钮类型
    WarnButton = partial(my_button, command=warn_cb, bg='goldenrod1')
    InfoButton = partial(my_button, command=info_cb, bg='white')

    for each_sign in SIGNS:
        sign_type = SIGNS[each_sign]
        cmd = '%sButton(text=%r%s).pack(fill=X, expand=True)' % (
            sign_type.title(), each_sign,
            '.upper()' if sign_type == error else '.title()')
        eval(cmd)   # 每个按钮通过 eval() 函数实例化

    top.mainloop()

### 文件列表示例

    import os
    from time import sleep
    from tkinter import *


    class DirList(object):
        def __init__(self, initdir=None):
            self.top = Tk()
            self.label = Label(self.top, text='文件夹监听器')     # 标题
            self.label.pack()

            self.dirl = Label(self.top, fg='blue', font=('Helvetica', 12, 'bold'))   # 显示当前路径
            self.dirl.pack()

            self.dirfm = Frame(self.top)    # 框
            self.dirsb = Scrollbar(self.dirfm)  # 滑块
            self.dirsb.pack(side=RIGHT, fill=Y)     # 滑块在右侧
            self.dirs = Listbox(self.dirfm, height=15, width=50, yscrollcommand=self.dirsb.set)     # 列表，展示当前目录下的文件
            self.dirs.bind('<Double-1>', self.setdirandgo)  # 双击鼠标左键, 跳转到选择到目标路径
            self.dirsb.config(command=self.dirs.yview)      # 改变垂直方向的位置
            self.dirs.pack(side=LEFT, fill=BOTH)    # 列表在左侧，填充 xy
            self.dirfm.pack()

            self.cwd = StringVar(self.top)
            self.dirn = Entry(self.top, width=50, textvariable=self.cwd)    # 输入框
            self.dirn.bind('<Return>', self.dols)       # 绑定回车键, 跳转到输入框内容的目录下
            self.dirn.pack()

            self.bfm = Frame(self.top)      # 最底下的容器
            self.clr = Button(self.bfm, text='清空',
                              command=self.clrdir,      # 清空输入框内容
                              activeforeground='white',
                              activebackground='blue')
            self.ls = Button(self.bfm,
                             text='跳转到选中目录',
                             command=self.dols,
                             activeforeground='white',
                             activebackground='green')
            self.quit = Button(self.bfm, text='退出',
                               command=self.top.quit,
                               activeforeground='white',
                               activebackground='red')
            self.clr.pack(side=LEFT)
            self.ls.pack(side=LEFT)
            self.quit.pack(side=LEFT)
            self.bfm.pack()

            if initdir:
                self.cwd.set(os.curdir)
                self.dols()

        def clrdir(self, ev=None):
            """
            空输入框内容
            """
            self.cwd.set('')

        def setdirandgo(self, ev=None):
            self.last = self.cwd.get()
            self.dirs.config(selectbackground='red')    # 选择的文件背景变为红色
            check = self.dirs.get(self.dirs.curselection())
            if not check:
                check = os.curdir
            self.cwd.set(check)     # 设置输入框为选择的item文件名
            self.dols()             # 跳转到选择到文件目标

        def dols(self, ev=None):
            """
            跳转到目标目录
            """
            error = ''
            tdir = self.cwd.get()   # 获取输入框的内容
            if not tdir:    # 入股内容为空，则默认为 '.'
                tdir = os.curdir

            if not os.path.exists(tdir):        # 如果文件不存在
                error = tdir + ': 没找到该文件'
            elif not os.path.isdir(tdir):       # 如果不是文件夹
                error = tdir + ': 不是一个文件夹'

            if error:   # 如果出错
                self.cwd.set(error)     # 输入框设置出错信息
                self.top.update()       # 更新绘制
                sleep(2)                # 睡眠2秒
                if not (hasattr(self, 'last') and self.last):
                    self.last = os.curdir
                self.cwd.set(self.last)     # 设置输入框为上一个正确的路径
                self.dirs.config(selectbackground='LightSkyBlue')   # 设置选择的item背景是亮蓝色
                self.top.update()       # 更新绘制
                return

            self.cwd.set('抓取文件夹内容...')
            self.top.update()
            dirlist = os.listdir(tdir)  # 获取目标路径下的文件列表
            dirlist.sort()              # 按文件名　排序
            os.chdir(tdir)              # 将活动目录设置为目标路径
            self.dirl.config(text=os.getcwd())      # 显示目标路径
            self.dirs.delete(0, END)    # 清空当前展示的文件列表
            self.dirs.insert(END, os.curdir)    # 插入 '.'
            self.dirs.insert(END, os.pardir)    # 插入 '..'
            for eachFile in dirlist:
                self.dirs.insert(END, eachFile)     # 插入目标路径下的所有文件
            self.cwd.set(os.curdir)     # 输入框内容设置为 '.'
            self.dirs.config(selectbackground='LightSkyBlue')   # # 设置选择的item背景是亮蓝色


    def main():
        d = DirList(os.curdir)
        mainloop()


    if __name__ == '__main__':
        main()

### 相关工具

https://wiki.python.org/moin/GuiProgramming



























