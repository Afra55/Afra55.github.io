---
layout: post
title:  "Python Sixth Step"
date:   2018-01-09 21:14
categories: Python
comments: true
description: Python Sixth Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/09/python-sixth-step/](http://afra55.github.io/2018/01/09/python-sixth-step/)

## socket

    import socket

创建 TCP/IP 套接字

    tcp_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)

创建 UDP/IP 套接字

    udp_socket = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

### 常用方法

| 服务器套接字方法 | 描述 |
| :--------- | :--------- |
| s.bind() | 将地址(主机名，端口号对)绑定到套接字上 |
| s.listen() | 设置并启动 TCP 监听器 |
| s.accept() | 被动接受 TCP 客户端连接，一直等待直到连接到达（即阻塞状态） |

| 客户端套接字方法 | 描述 |
| :--------- | :--------- |
| s.connect() | 主动发起 TCP 服务器连接 |
| s.connect_ex() | connect() 的扩展版本，出现问题会返回错误码而不是抛出异常 |


| 通用套接字方法 | 描述 |
| :--------- | :--------- |
| s.recv() | 接收 TCP 消息 |
| s.recv_into() | 接收 TCP 消息到指定的缓冲区 |
| s.send() | 发送 TCP 消息 |
| s.sendall() | 发送完整的 TCP 消息 |
| s.recvfrom() | 接收 UDP 消息 |
| s.recvfrom_into() | 接收 UDP 消息到指定的缓冲区 |
| s.sendto() | 发送 UDP 消息 |
| s.getpeername() | 连接到套接字(TCP)的远程地址 |
| s.getsockname() | 当前套接字的地址 |
| s.getsockopt() | 返回给定套接字选项的值 |
| s.setsockopt() | 设置给定套接字选项的值 |
| s.shutdown() | 关闭连接 |
| s.close() | 关闭套接字 |
| s.detach() | 在未关闭文件描述符的情况下关闭套接字并返回文件描述符 |
| s.ioctl() | 仅支持 windows 平台，控制套接字的模式 |

| 面向阻塞的套接字方法 | 描述 |
| :--------- | :--------- |
| s.setblocking() | 设置套接字的阻塞或非阻塞模式 |
| s.settimeout() | 设置阻塞套接字操作的超时时间 |
| s.gettimeout() | 获取阻塞套接字操作的超时时间 |

| 面向文件的套接字方法 | 描述 |
| :--------- | :--------- |
| s.fileno() | 套接字的文件描述符 |
| s.makefile() | 创建与套接字关联的文件对象 |

| 数据属性 | 描述 |
| :--------- | :--------- |
| s.family | 套接字地址族 |
| s.type | 套接字类型 |
| s.proto | 套接字协议 |

### socket 模块属性

| 数据属性 | 描述 |
| :--------- | :--------- |
| AF_UNIX, AF_INET, AF_INET6, AF_NETLINK, AF_TIPC | Python 中支持的套接字地址族 |
| SO_STREAM, SO_DGRAM | 套接字类型（TCP=流，UDP=数据报） |
| has_ipv6 | 布尔标记，是否支持 IPv6 |

| 异常 | 描述 |
| :--------- | :--------- |
| error | 套接字相关错误 |
| herror | 主机和地址相关错误 |
| gaierror | 地址相关错误 |
| timeout | 超时时间 |

| 函数 | 描述 |
| :--------- | :--------- |
| socket() | 以给定的套接字族，套接字协议和协议类型创建一个套接字对象 |
| socketpair() | 以给定的套接字族，套接字协议和协议类型创建一个套接字对象 |
| create_connection() | 接收一个地址（主机名，端口号）对，返回套接字对象 |
| fromfd() | 以一个打开的文件描述符创建一个套接字对象 |
| ssl() | 通过套接字启动一个安全套接字层链接，不执行证书验证 |
| getaddrinfo() | 获取一个五元组序列形式的地址信息 |
| getnameinfo() | 给定一个套接字地址，返回（主机名，端口号）二元组 |
| getfqdn() | 返回完整的域名 |
| gethostname() | 返回当前主机名 |
| gethostbyname() | 返回主机名对应的 IP 地址 |
| gethostbyname_ex() | 返回真实的主机名，别名列表和IP地址列表 |
| gethostbyaddr() | 返回真实的主机名，别名列表和IP地址列表 |
| getprotobyname() | 返回指定协议的协议号（几乎没有使用过） |
| getservbyname() | 从服务名称和协议名称中返回一个端口号,如果传入协议名则应该是 tcp 或 udp |
| getservbyport() | 从端口号和协议名称中返回服务名称, 如果传入协议名则应该是 tcp 或 udp |
| ntohl() | 将网络中的32位整数转换为主机字节顺序 |
| ntohs() | 将网络中的16位整数转换为主机字节顺序 |
| htonl() | 将主机的32位整数转换为网络字节顺序 |
| htohs() | 将主机的16位整数转换为网络字节顺序 |
| inet_aton() | 将字符串格式的IP地址（123.45.67.89）转换为32位的包格式(仅用于 IPv4)  |
| inet_ntoa() | 将32位的包格转换为字符串形式的IP地址(仅用于 IPv4) |
| inet_pton() | 将字符串格式的IP地址转换为适用于低级网络功能的压缩字符串 |
| inet_ntop() | 将给定族的压缩IP地址转换为字符串格式 |
| getdefaulttimeout() | 以秒为单位(浮点数)返回默认套接字超时时间 |
| setdefaulttimeout() | 以秒为单位(浮点数)设置默认套接字超时时间 |

### 创建 TCP服务器 的一般套路

    创建服务器套接字    s.socket()
    套接字与地址绑定    s.bind()
    监听连接           s.listen()
    服务器无限循环
    接收客户端连接      cs = s.accept()
    接收到连接后进行通信循环
    进行对话（接收，发送） cs.recv()   cs.send()
    对话结束关闭客户端套接字 cs.close()
    （可选）关闭服务器套接字或不关闭继续监听  s.close()

示例

    from socket import *
    from time import ctime


    HOST = ''       # 表示可以使用任何可用的地址
    PORT = 21566    # 随机的一个端口号，该端口号没有被使用或系统保留
    BUFSIZE = 1024  # 缓冲区大小 1KB
    ADDR = (HOST, PORT)

    tcp_ser_sock = socket(AF_INET, SOCK_STREAM)     # 创建 ipv4 tcp 套接字, 如果使用IPv6，则替换 AF_INET 为 AF_INET6 即可
    tcp_ser_sock.bind(ADDR)     # 将套接字绑定到服务器地址
    tcp_ser_sock.listen(5)      # 开启 TCP 监听器， 参数 5 代表连接被转接或拒绝前，接收连接请求的最大数

    while True:     # 无限循环, 可以对这个循环进行 KeyboardInterrupt 或 EOFError 异常捕获，在 finally 中关闭服务器套接字
        print('阻塞中，等待客户端连接...')
        tcp_client_sock, addr = tcp_ser_sock.accept()   # 被动接受 TCP 客户端连接，一直等待直到连接到达
        print('已连接到地址:', addr)

        while True:     # 接收到连接，进入对话
            data = tcp_client_sock.recv(BUFSIZE)    # 接收消息
            if not data:    # 如果消息空白，意味客户端已经退出，此时跳出对话循环
                break
            tcp_client_sock.send(bytes('[%s] %s' % (ctime(), data), 'utf-8'))    # 如果接收到使用信息，将信息格式化并返回相同到数据

        tcp_client_sock.close()     # 关闭当前客户端连接

    tcp_ser_sock.close()

### 创建 TCP客户端 的一般套路

    创建客户端套接字    cs = socket()
    连接服务器         cs.connect()
    通信循环
    对话（接收，发送)   cs.recv()   cs.send()
    关闭客户端套接字    cs.close()

示例

    from socket import *


    HOST = 'localhost'  # 本地服务器主机名, 如果是 IPv6 则需要把本地主机修改成它的 IPv6 地址: HOST = '::1'
    PORT = 21566        # 服务器端口号，需要与服务器设置的完全相同
    BUFSIZE = 1024      # 缓冲区带下 1KB
    ADDR = (HOST, PORT)

    tcp_client_sock = socket(AF_INET, SOCK_STREAM)  # 创建 tcp 套接字, 如果使用IPv6，则替换 AF_INET 为 AF_INET6 即可
    tcp_client_sock.connect(ADDR)   # 连接到服务器

    while True:     # 无限循环
        data = input('输入发送的数据: ')   # 输入数据
        if not data:    # 没有输入数据时，跳出循环
            break
        tcp_client_sock.send(bytes(data, 'utf-8'))     # 发送数据到服务器进行处理
        data = tcp_client_sock.recv(BUFSIZE)    # 接收到服务器返回到数据
        if not data:    # 服务器终止或者 recv() 方法调用失败时跳出循环
            break
        print(data.decode('utf-8'))     # 使用数据

    tcp_client_sock.close()

### 执行 TCP 服务器和客户端

首先启动服务器, 再进行启动客户端

服务器控制台

    阻塞中，等待客户端连接...
    已连接到地址: ('127.0.0.1', 54736)

客户端控制台

    输入发送的数据: 2222222
    [Wed Jan 10 23:32:35 2018] b'2222222'
    输入发送的数据: 2323232
    [Wed Jan 10 23:33:23 2018] b'2323232'
    输入发送的数据: fefefef
    [Wed Jan 10 23:33:25 2018] b'fefefef'
    输入发送的数据: 

    Process finished with exit code 0

### 创建 UDP 服务器的一般套路

    创建服务器套接字    s = socket()
    绑定服务器套接字    s.bind()
    服务器无限循环     
    接收或发送UDP消息     s.recvfrom()  s.sendto()
    关闭服务器套接字    s.close() 

示例

    from socket import *
    from time import ctime


    HOST = ''
    PORT = '21565'
    BUFSIZE = 1024
    ADDR = (HOST, PORT)

    udp_service_sock = socket(AF_INET, SOCK_DGRAM)
    udp_service_sock.bind(ADDR)     # UDP 是无连接到，所以绑定后，不需要开启监听器

    while True:
        print('阻塞，等待消息...')     # UDP 不需要连接，只需要等待接收消息
        data, addr = udp_service_sock.recvfrom(BUFSIZE)
        udp_service_sock.sendto(bytes('[%s] %s' % (ctime(), data), 'utf-8'), addr)
        print('接收到信息，并返回信息到', addr)

    udp_service_sock.close()

### 创建 UDP 客户端的一般套路

    创建客户端套接字    cs = socket()
    通信循环
    对话（发送/接收）   cs.sendto() cs.recvfrom()
    关闭客户端套接字    cs.close()

示例

    from socket import *


    HOST = 'localhost'
    PORT = 21565
    BUFFSIZE = 1024
    ADDR = (HOST, PORT)

    udp_client_sock = socket(AF_INET, SOCK_DGRAM)

    while True:
        data = input('请输入数据:')
        if not data:
            break
        udp_client_sock.sendto(bytes(data, 'utf-8'), ADDR)
        data, addr = udp_client_sock.recvfrom(BUFFSIZE)
        if not data:
            break
        print(data)

    udp_client_sock.close()

### 执行 UDP 服务器和客户端

    与 TCP 一致

### 扩展

socketserver是标准库到一个高级模块，简化创建网络服务器和客户端所必须的样板代码

Twisted 完整的事件驱动的网络框架， 可以使用也可以开发完整的异步网络应用程序和协议, 提供 了 大量 的 支持 来 建立 完整 的 系统， 包括 网络 协议、 线程、 安全性 和 身份 验证、 聊天/ IM、 DBM 及 RDBMS 数据库 集成、 Web/ 因 特 网、 电子邮件、 命令行 参数、 GUI 集成 工具包 等, http://twistedmatrix.com/trac/

## 文件传输 FTP

FTP，文件传输协议

UUCP, UNIX 到 UNIX 复制 协议

rcp，Unix 下的远程网络复制命令

HTTP, Web 超文本传输协议, 主要用于基于 Web 的文件下载以及访问 Web 服务

### FTP

文件传输协议(File Transfor Protocol, FTP), 主要用于匿名下载公共文件，也可以在两台计算机中传输文件

工作流程 
    
    客户端连接远程主机上的 FTP 服务器
    客户端输入用户名和密码（或者 'anonymous'和电子邮件地址）
    客户端进行各种文件传输和信息查询操作
    客户端从远程FTP服务器退出，结束传输

如果客户端超过 15分钟（900秒）还没响应，FTP会因为超时中断传输

FTP 在底层只使用 TCP，不使用 UDP

FTP 客户端和 FTP 服务器由两个套接字来通信：一个时控制和命令端口21，一个时数据传输端口20

| ftplib.FTP类方法 | 描述 |
| :--------- | :--------- |
| login(user = '', passwd = '', acct = '') | 登陆 FTP 服务器，所有参数时可选的 |
| pwd() | 获取当前工作目录 | 
| cwd(dirname) | 把当前工作目录设置为 dirname 所在的路径 |
| dir(*args) | 列出目录里的内容, 可选的最后一个参数是回调函数，会传递给 retrlines() 方法 |
| nlst(*args) | 与 dir() 类似，但返回文件名列表，而不是显示文件名 | 
| retrlines(cmd, callback=None) | 给定 FTP 命令（例如：'RETR filename'），用于下载文本文件， 回调函数 callback 用于处理文件的每一行 |
| retrbinary(cmd, callback, blocksize=8192, rest=None) | cmd命令用于处理二进制文件，回调函数 callback 用于处理文件的每一块（块大小默认8KB）下载的数据 |
| storlines(cmd, fp, callback=None) | 给定 FTP 命令(例如：'STOR filename'), 用来上传文本文件。需要给定文本对象 fp |
| storbinary(cmd, fp, blocksize=8192, callback=None, rest=None) | cmd 指令用于处理二进制文件，需要给定文件对象 fp，上传块大小默认为 8KB |
| rename(fromname, toname) | 把远程文件 fromname 重命名为 toname | 
| delete(filename) | 删除远程文件 filename | 
| mkd(dirname) | 创建远程目录 |
| rmd(dirname) | 删除远程目录 |
| quit() | 关闭连接并退出 |

可以参考如下命令直接在命令行连接 FTP服务器

    from ftplib import FTP


    f = FTP('ftp.python.org')
    f.login()
    f.dir()
    f.retrlines('RETR motd')
    f.quit()

### 客户端FTP示例

    import ftplib
    import os
    import socket


    HOST = 'ftp.mozilla.org'
    DIR = 'pub/webtools/'
    FILE = 'mozbot-LATEST.tar.gz'


    def main():
        try:
            f = ftplib.FTP(HOST)    # 创建 FTP 对象, 并尝试连接到 FTP 服务器
        except (socket.error, socket.gaierror):
            print('ERROR 无法连接到 "%s"' % HOST)
            return

        print('连接到 FTP 服务器 "%s"' % HOST)

        try:
            f.login()   # 匿名登陆
        except ftplib.error_perm:
            print('ERROR 无法匿名登陆')
            f.quit()
            return

        print('匿名登陆成功')

        try:
            f.cwd(DIR)  # 转到目录
        except ftplib.error_perm:
            print('ERROR 无法切换目录到 "%s"' % DIR)
            f.quit()
            return

        print('切换目录到 "%s"' % DIR)

        try:
            local_file = open(FILE, 'wb')
            f.retrbinary('RETR %s' % FILE, local_file.write)  # 下载文件
            local_file.close()
        except ftplib.error_perm:
            print('ERROR 无法读取文件 "%s"' % FILE)
            os.unlink(FILE)     # 如果下载失败，就移除这个空文件
        else:
            print('下载文件 "%s"' % FILE)

        f.quit()


    if __name__ == '__main__':
        main()

## 新闻网络传输协议 NNTP 

NNTP 只使用一个标准端口 119 来通信

    连接到服务器
    登陆
    发出服务请求
    退出

伪代码

    from nntplib import NNTP


    n = NNTP('your.nntp.server')
    r, c, f, l, g = n.group('comp.lang.python')     # 服务器到回复，文章到数量，第一篇和最后一篇到文章ID，新闻组到名称
    # 其他操作
    n.quit()

## 电子邮件

电子邮件消息由头字段（消息标题）以及后面可选的正文组成, 邮件可以没有正文但是一定要有标题（标题只需要两个字段发送地址字段'From:' 和 发送日期字段'Date:'）

MTA 消息传输代理，在邮件交换主机上运行的服务器进程，负责邮件的路由，队列处理和发送工作

MTA 通过 DNS域名服务来查找目的域名的 MX（邮件交换 mail eXchange）

MTA 之间通过消息传输系统 MTS 互相通信

SMTP 简单邮件传输协议

LMTP 本地邮件传输协议

    连接到服务器
    登陆(可选)
    发出服务请求
    退出

SMTP 通信时只需要一个端口 25

| SMTP对象常见方法 | 描述 |
| :--------- | :--------- |
| `sendmail(from_addr, to_addrs, msg, mail_options=[], rcpt_options=[])` | 将msg从from_addr发送至to_addrs(列表或元组),还可以设置ESMTP邮件(mail_options)和收件人(rcpt_options)选项 |
| ehlo(name='') | 使用 EHLO 初始化 SMTP (可选，sendmail（）会自动调用相关内容)  |
| helo(name='') | 使用 HELO 初始化 SMTP (可选，sendmail（）会自动调用相关内容) |
| starttls(keyfile=None, certfile=None, context=None) | 让服务器启动 TLS 模式，如果给定 keyfile 和 certfile 则它们用来创建安全套接字 |
| set_debuglevel(debuglevel) | 为服务器通信设置调试级别 |
| quit() | 关闭连接并退出 |
| login(user, password, *, initial_response_ok=True) | 使用用户名和密码登陆 SMTP 服务器 |

发送邮件伪代码

    from smtplib import SMTP as smtp


    s = smtp('smtp.host')
    s.set_debuglevel(1)

    s.sendmail('afra55@foxmail.com', ('afra@foxmail.com', '786654260@qq.com'), '''From:afra55@foxmail.com\r\nTo:afra@foxmail.com,786654260@qq.com\r\nSubject:test message\r\n\r\nAfra55\r\n.''')
    s.quit()

MUA 邮件用户代理

POP 邮件协议, 第一个用于下载邮件的协议, 最新版时 POP3

Python 中 poplib.POP3类 提供了许多方法用来下载和离线管理邮箱

POP3 伪代码

    from poplib import POP3 
    p = POP3('pop.python.is.cool') 
    p.user(...)
    p.pass_(...)
    ...
    p.quit()

IMAP 因特网消息访问协议(因特网邮件访问协议，交互式邮件访问协议，临时邮件访问协议)

IMAP 伪代码

    from imaplib import IMAP4 
    s = IMAP4('imap.python.is.cool') 
    s.login(...) 
    ... 
    s.close()
    s.logout()

### 发送邮件示例

    from email.mime.image import MIMEImage
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    from smtplib import SMTP


    def make_mpa_msg():
        """
        包含纯文本消息，和 HTML 消息，由邮件客户端显示哪个部分
        基于 Web 的 电子邮件 系统 会 显示 HTML 版本， 而 基于 命令 行的 邮件 阅读 器 只会 显示 纯 文本 版本
        :return: MIMEMultipart
        """
        email = MIMEMultipart('alternative')  # 如果不传 alternative ，则文本和 HTML 会分别作为消息中的附件发送
        text = MIMEText('Hello World!\r\n', 'plain')
        email.attach(text)  # 附加到邮件中
        html = MIMEText(
            '<html><body><h4>Hello World!</h4>'
            '</body></html>', 'html')
        email.attach(html)  # 附加到邮件中
        return email


    def make_img_msg(fn):
        """
        图片消息
        :param fn: 文件名
        :return: MIMEImage
        """
        f = open(fn, 'r')
        data = f.read()
        f.close()
        email = MIMEImage(data, name=fn)
        email.add_header('Content-Disposition',
                         'attachment; filename="%s"' % fn)  # 添加 Header
        return email


    def send_msg(fr, to, msg):
        """
        获取 基本 的 电子邮件 发送 信息（ 发 件 人、 收件人、 消息 正文）， 接着 传送 消息， 然后 返回 给 调用 者
        :param fr:
        :param to:
        :param msg:
        :return:
        """
        s = SMTP('localhost')
        errs = s.sendmail(fr, to, msg)
        s.quit()


    if __name__ == '__main__':
        print('sending multipart alternative msg')
        msg = make_mpa_msg()
        msg['From'] = SENDER
        msg['To'] = ', '.join(RECIPS)
        msg['Subject'] = 'multipart alternative test'
        send_msg(SENDER, RECIPS, msg.as_string())

        print('sending image msg')
        msg = make_img_msg(SOME_IMG_FILE)
        msg['From'] = SENDER
        msg['To'] = ', '.join(RECIPS)
        msg['Subject'] = 'image file test'
        send_msg(SENDER, RECIPS, msg.as_string())

### 解析 email

    import email


    def processMsg(entire_msg):
        body = ''
        msg = email.message_from_string(entire_msg)
        if msg.is_multipart(): 
            for part in msg.walk(): 
                if part.get_content_type() == 'text/ plain': 
                    body = part.get_payload() 
                    break 
                else: 
                    body = msg.get_payload(decode=True) 
        else: 
            body = msg.get_payload(decode=True) 
            return body

email.message_from_string()： 用来 解析 消息

msg.walk()： 遍历 消息 的 附件

part.get_content_type()： 获得 正确 MIME 类型

msg.get_payload()： 从 消息 正文 中 获取 特定 的 部分。 通常 decode 标记 会 设为 True， 即 邮件 正文 根据 每个 Content- Transfer- Encoding 头 解码
















