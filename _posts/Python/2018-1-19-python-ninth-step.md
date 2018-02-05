---
layout: post
title:  "Python Ninth Step: Microsoft Office 编程"
date:   2018-01-19 16:22
categories: Python
comments: true
description: Python Ninth Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/19/python-ninth-step/](http://afra55.github.io/2018/01/19/python-ninth-step/)

##  Microsoft Office 编程

COM 是一 个 服务， 通过 该 服务 可 以使 PC 应用 与其 他 应用 进行 交互

Windows 编程 的 领域 正在 不断 扩大， 其中 大多数 都 来自于 Windows Extensions for Python 包。 它 包括： Windows API、 派生 进程、 MFC GUI 开发、 Windows 多 线程 编程、 服务、 远程 访问、 管道、 服务器 端 COM 编程 以及 事件

涉及：Excel、 Word、 PowerPoint 和 Outlook

这里使用 pywin32

下载地址：https://sourceforge.net/projects/pywin32/files/pywin32/

pyw 扩展名 用于 抑制 终端 的 显示， 其 目的 是 运行 一个 用户 命令行 交互 非 必需 的 GUI 应用

下面的示例文件名都以 .pyw 结尾

### Excel

示例

    from tkinter import Tk
    from time import sleep
    from tkinter.messagebox import showwarning
    import win32com.client as win32

    warn = lambda app: showwarning(app, 'Exit?')
    RANGE = list(range(3, 8))


    def excel():
        app = 'Excel'
        xl = win32.gencache.EnsureDispatch('%s.Application' % app)      # 启动 Excel，静态调度
        # xl = win32.client.Dispatch('% s. Application' % app)          # 动态调度
        ss = xl.Workbooks.Add()     # 添加一个工作薄
        sh = ss.ActiveSheet     # 取得活动工作表到句柄
        xl.Visible = True       # True 代表应用在桌面上可用
        sleep(1)

        sh.Cells(1, 1).Value = 'Python-to-%s Demo' % app    # 在（1, 1）单元格写入标题
        sleep(1)
        for i in RANGE:
            sh.Cells(i, 1).Value = '第 %d 行' % i    # 将信息写入对应单元格
            sleep(1)
        sh.Cells(i + 2, 1).Value = "啦啦啦，啦啦啦啊啦啦啦啊!"

        warn(app)       # 演示结束时弹出警告
        ss.Close(False)     # 关闭工作薄，False 表示退出不保存
        xl.Application.Quit()   # 退出应用


    if __name__ == '__main__':
        Tk().withdraw()
        excel()

这个库 http://www.python-excel.org 专门用来操作 Excel 文件

### Word

示例

    from tkinter import Tk
    from time import sleep
    from tkinter.messagebox import showwarning
    import win32com.client as win32

    warn = lambda app: showwarning(app, 'Exit?')
    RANGE = list(range(3, 8))


    def word():
        app = 'Word'
        word = win32.gencache.EnsureDispatch('%s.Application' % app)
        doc = word.Documents.Add()
        word.Visible = True
        sleep(1)

        rng = doc.Range(0, 0)
        rng.InsertAfter('Python-to-%s Test\r\n\r\n' % app)  # 必须手动回车
        sleep(1)
        for i in RANGE:
            rng.InsertAfter('第 %d 行\r\n' % i)
            sleep(1)
        rng.InsertAfter("\r\n本宝宝宝宝宝宝宝宝宝宝!\r\n")

        warn(app)
        doc.Close(False)
        word.Application.Quit()


    if __name__ == '__main__':
        Tk().withdraw()
        word()

### PowerPoint

    from tkinter import Tk
    from time import sleep
    from tkinter.messagebox import showwarning
    import win32com.client as win32

    warn = lambda app: showwarning(app, 'Exit?')
    RANGE = list(range(3, 8))


    def ppoint():
        app = 'PowerPoint'
        ppoint = win32.gencache.EnsureDispatch('%s.Application' % app)
        pres = ppoint.Presentations.Add()
        ppoint.Visible = True

        s1 = pres.Slides.Add(1, win32.constants.ppLayoutText)   # 使用标题和文本布局,还有至少30种布局
        sleep(1)
        s1a = s1.Shapes[0].TextFrame.TextRange  # 标题
        s1a.Text = 'Python-to-%s Demo' % app
        sleep(1)
        s1b = s1.Shapes[1].TextFrame.TextRange  # 内容
        for i in RANGE:
            s1b.InsertAfter("第 %d 行\r\n" % i)
            sleep(1)
        s1b.InsertAfter("\r\n的滴滴答答的滴滴答答的s!")

        warn(app)
        pres.Close()
        ppoint.Quit()


    if __name__ == '__main__':
        Tk().withdraw()
        ppoint()

### Outlook

    from tkinter import Tk
    from tkinter.messagebox import showwarning
    import win32com.client as win32

    warn = lambda app: showwarning(app, 'Exit?')
    RANGE = list(range(3, 8))


    def outlook():
        app = 'Outlook'
        olook = win32.gencache.EnsureDispatch('%s.Application' % app)

        mail = olook.CreateItem(win32.constants.olMailItem)     # 创建邮件
        recip = mail.Recipients.Add('you@127.0.0.1')        # 收件人
        subj = mail.Subject = 'Python-to-%s Demo' % app     # 主题题
        body = ["第 %d 行" % i for i in RANGE]
        body.insert(0, '%s\r\n' % subj)
        body.append("\r\nTh-th-th-that's all folks!")
        mail.Body = '\r\n'.join(body)           # 正文内容
        mail.Send()         # 发送

        ns = olook.GetNamespace("MAPI")
        obox = ns.GetDefaultFolder(win32.constants.olFolderOutbox)  # 用于打开 Outbox 并显示
        obox.Display()
        obox.Items.Item(1).Display()

        warn(app)
        olook.Quit()


    if __name__ == '__main__':
        Tk().withdraw()
        outlook()










