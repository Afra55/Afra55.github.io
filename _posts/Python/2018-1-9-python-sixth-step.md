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







