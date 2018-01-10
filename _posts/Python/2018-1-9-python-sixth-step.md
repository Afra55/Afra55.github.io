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

    while True:     # 无限循环
        print('阻塞中，等待客户端连接...')
        tcp_client_sock, addr = tcp_ser_sock.accept()   # 被动接受 TCP 客户端连接，一直等待直到连接到达
        print('已连接到地址:', addr)

        while True:     # 接收到连接，进入对话
            data = tcp_client_sock.recv(BUFSIZE)    # 接收消息
            if not data:    # 如果消息空白，意味客户端已经退出，此时跳出对话循环
                break
            tcp_client_sock.send('[%s] %s' % (bytes(ctime(), 'utf-8'), data))   # 如果接收到使用信息，将信息格式化并返回相同到数据

        tcp_client_sock.close()     # 关闭当前客户端连接

    tcp_ser_sock.close()

### 创建 TCP客户端 的一般套路

    














