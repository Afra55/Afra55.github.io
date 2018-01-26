---
layout: post
title:  "Python Tenth Step"
date:   2018-01-22 13:22
categories: Python
comments: true
description: Python Tenth Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/22/python-tenth-step/](http://afra55.github.io/2018/01/22/python-tenth-step/)

推荐用 http://cn.python-requests.org/zh_CN/latest/

##  Web 客户端和服务器

HTTP（ HyperText Transfer Protocol， 超 文本 传输）

HTTP 是 TCP/ IP 的 上层 协议， 这 意味着 HTTP 协议 依靠 TCP/ IP 来 进行 低层 的 交流 工作

SSL (Secure SocketLayer) 安全套接字层, 用来创建一个套接字，加密通过该套接字传传输的数据

URL (Uniform Resource Identifier) 统一资源标识符， `scheme://netloc[:port]/path/[;params][?query]#fragment`

## urllib 模块

urllib 提供 了 一个 高级的 Web 通信 库， 支持 基本 的 Web 协议， 如 HTTP、 FTP 和 Gopher 协议， 同时 也 支持 对本 地 文件 的 访问

### urllib.parse 模块

`urlparse(url, scheme='', allow_fragments=True)` 将 url 解析为6元组，(scheme, netloc, path, params, query, fragment)

    values = urlparse("http://so.csdn.net/so/search/s.do?q=AAA啊哈&t=blog")
    print(values)   # ParseResult(scheme='http', netloc='so.csdn.net', path='/so/search/s.do', params='', query='q=AAA啊哈&t=blog', fragment='')
    print(urlunparse(values))   # http://so.csdn.net/so/search/s.do?q=AAA啊哈&t=blog

urlunparse() 将 urlparse 处理生成的6元组拼接成 url 并返回

`urljoin(base, url, allow_fragments=True)` 

    print(urljoin('https://docs.python.org/3/faq/index.html', 'general.html#what-is-python'))
    # https://docs.python.org/3/faq/general.html#what-is-python

urljoin() 将 baseurl 的根域名和 newurl 拼合成一个完整的 URL

| urllib.parse 函数 | 描述 |
| :--------- | :--------- |
| quote(string, safe='/') | 对 string 在 URL 无法使用的字符进行编码， safe 中的字符不需要编码 |
| quote_plus(string, safe='/') | 与 quote() 类似，除了将空格编码为 '+' 号 |
| unquote(string) | 和 quote() 功能相反 |
| unquote_plus(string) | 和 quote_plus() 功能相反 |
| urlencode(dict) | 将字典的 key 和 value 进行quote_plus() 转换为有效的 CGI 查询字符串，并变为 ‘键=值’ 的格式 |


`quote(string, safe='/', encoding=None, errors=None)` 获取 url 数据，并将其编码使其可以用于 url 字符串中，那些 URL 不能 使用 的 字符 前边 会被 加上 百分 号（%） 同时 转换 成 十六进制， 例如，“% xx”， 其中，“ xx” 表示 这个 字母 的 ASCII 码 的 十六进制 值， 逗号、 下划线、 句号、 斜线 和 字母 数字 这类 符号 不需要 转化， 其 他的 则 均需 要 转换

    quote('abc def')    # 'abc%20def'

`quote_plus(string, safe='', encoding=None, errors=None)`  与quote（） 类似，但是还可以将空格编码为 '+'号

    quote_plus('abc def')   # 'abc+def'

`unquote(string, encoding='utf-8', errors='replace')` 和 quote() 功能相反， 将 所有 编码 为“% xx” 式 的 字符 转换 成 等价 的 ASCII 码 值

`unquote_plus(string, encoding='utf-8', errors='replace')` 与 unquote() 类似，除此之外会将 '+' 转换为 空格

`urlencode(query, doseq=False, safe='', encoding=None, errors=None, quote_via=quote_plus)` 将字典的 key 和 value 进行quote_plus() 转换为有效的 CGI 查询字符串，并变为 ‘键=值’ 的格式


### urllib.request 模块

| urllib.request 函数 | 描述 |
| :--------- | :--------- |
| urlopen(url, data=None) | 打开 url，如果是 POST 请求，则通过 data 发送请求数据 |
| urlretrieve(url, filename=None, reporthook=None) | 将 url 中的文件下载到 filename 或临时文件中，  reporthook 函数会获取到统计信息 |

`urlopen(url, data=None, timeout=socket._GLOBAL_DEFAULT_TIMEOUT, *, cafile=None, capath=None, cadefault=False, context=None)`

urlopen(), 打开给定 url 字符串表示的 web 连接，并返回文件类型对象。如果没有给定协议或者 scheme 或者传入文件时打开一个本地文件
    
| urlopen() 对象方法 | 描述 |
| :--------- | :--------- |
| f.read(`[bytes]`) | 从 f 中读出所有子节，或 bytes 个字节 |
| f.readline() | 从 f 中读取一行 |
| f.readlines() | 以列表形式返回 f 中的所有行　|
| f.close() | 关闭 f 的 url 连接 |
| f.fileno() | 返回 f 的文件句柄 |
| f.info() | 获得 f 的 MIME 头文件 |
| f.geturl() | 返回 f 的真正url |

`urlretrieve(url, filename=None, reporthook=None, data=None)`

urlretrieve(), 下载 url 打开的完整的 html 到本地硬盘。其返回一个二元组（filename, mime_hdrs），filename 是含有下载数据的本地文件名，mime_hdrs 是 Web 服务器响应后返回的一系列 MIME 文件头。如果提供 reporthook(blocknum, bs, size) 函数，则在每块数据下载或传输完成后调用这个函数来提供 块编号、读取的块大小、块总大小

## urllib2 模块

urllib2 可以 处理 更 复杂 URL 的 打开 问题。 例如 有 基本 验证（ 登录 名 和 密码） 需求 的 Web 站点。 通过 验证 的 最简单 方法 是 使用 前边 章节 描述 的 URL 中的 net_ loc 组件

HTTP 验证示例

    import urllib.request, urllib.error, urllib.parse

    LOGIN = 'wesley'
    PASSWD = "you'llNeverGuess"
    URL = 'http://localhost'
    REALM = 'Secure Archive'


    def handler_version(url):
        hdlr = urllib.request.HTTPBasicAuthHandler()
        hdlr.add_password(REALM, urllib.parse.urlparse(url)[1], LOGIN, PASSWD)
        opener = urllib.request.build_opener(hdlr)
        urllib.request.install_opener(opener)
        return url


    def request_version(url):
        from base64 import encodestring
        req = urllib.request.Request(url)   # 创建一个 request 对象
        b64str = encodestring(bytes('%s:%s' % (LOGIN, PASSWD), 'utf-8'))[:-1]   # 验证头信息
        req.add_header("Authorization", "Basic %s" % b64str)
        return req


    for funcType in ('handler', 'request'):
        print('*** Using %s:' % funcType.upper())
        url = eval('%s_version' % funcType)(URL)
        f = urllib.request.urlopen(url)
        print(str(f.readline(), 'utf-8'))
        f.close()

## 推荐使用 requests

[requests](http://cn.python-requests.org/zh_CN/latest/)

## 爬虫

[更多内容，上 github 搜爬虫](https://github.com/search?o=desc&q=爬虫&s=stars&type=Repositories&utf8=✓)

使用 [requests](http://cn.python-requests.org/zh_CN/latest/)

使用 [Beautiful Soup](http://beautifulsoup.readthedocs.io/zh_CN/latest/)

一个爬小说的例子：

    import requests
    from bs4 import BeautifulSoup

    server = 'http://www.biqukan.com'
    target = 'http://www.biqukan.com/1_1496/'


    def req_get_bf(url):
        return BeautifulSoup(requests.get(url).text, 'html.parser')


    def get_content(content_url):
        bf = req_get_bf(content_url)
        texts = bf.find_all('div', 'showtxt')
        return texts[0].text.replace('\xa0' * 8, '\n\n')


    def get_target_url(main_url, name_list, url_list):
        div_bf = req_get_bf(main_url)
        div = div_bf.find_all('div', 'listmain')
        a_div_bf = BeautifulSoup(str(div[0]), 'html.parser')
        a = a_div_bf.find_all('a')[12:]
        for item in a:
            url_list.append(server + item.get('href'))
            name_list.append(item.string)

        return len(a)


    def write_to_file(name, path, text):
        with open(path, 'a', encoding='utf-8') as f:
            f.write(name + '\n')
            f.writelines(text)
            f.write('\n\n')


    if __name__ == '__main__':
        names = []  # 存放章节名
        urls = []  # 存放章节链接
        nums = get_target_url(target, names, urls)
        for i in range(nums):
            print('正在下载', names[i])
            write_to_file(names[i], '龙王传说.txt', get_content(urls[i]))

## Web(http)服务器

要 建立 一个 Web 服务器， 必须 建立 一个 基本 的 服务器 和 一个“ 处理 程序”

基础 的 Web 服务器 是一 个 模板。 其 角色 是在 客户 端 和 服务器 端 完成 必要 的 HTTP 交互

处理 程序 是一 些 处理 主要“ Web 服务” 的 简单 软件。 它 用于 处理 客户 端 的 请求， 并 返回 适当 的 文件， 包括 静态 文件 或 动态 文件。 处理 程序 的 复杂性 决定了 Web 服务器 的 复杂 程度

以下是三种不同的处理程序，都整合在 http.server 模块中:

1. BaseHTTPResquestHandler  除了 获得 客户 端 的 请求 外， 没有 实现 其他 处理 工作
2. SimpleHTTPRequestHandler  建立 在 BaseHTTPResquestHandler 的 基础上， 以 非常 直接 的 形式 实现 了 标准 的 GET 和 HEAD 请求
3. CGIHTTPRequestHandler 这个 处理 程序 可以 获取 SimpleHTTPRequestHandler， 并 添 加了 对 POST 请求 的 支持,其 可以 调用 CGI 脚本 完成 请求 处理 过程, 也可以 将 生成 的 HTML 脚本 返回 给 客户 端

一个简单的 Web服务器示例，可以读取 GET 请求，获取 Web页面 html文件，并返回给调用的客户端:

    from http.server import BaseHTTPRequestHandler, HTTPServer


    class MyHandler(BaseHTTPRequestHandler):
        def do_get(self):
            try:
                f = open(self.path[1:], 'r')
                self.send_response(200)
                self.send_header('Content-type', 'text/html')
                self.end_headers()
                self.wfile.write(f.read())
                f.close()
            except IOError:
                self.send_error(404, 'File Not Found: %s' % self.path)


    def main():
        server = HTTPServer(('', 8080), MyHandler)
        try:
            print('Welcome to the machine...')
            print('Press ^C once or twice to quit')
            server.serve_forever()
        except KeyboardInterrupt:
            print('^C received, shutting down server')
        finally:
            if server:
                server.socket.close()


    if __name__ == '__main__':
        main()

| Web 应用程序　| 描述 |
| :--------- | :--------- |
| cgi | 冲标准网关（CGI）获取数据 |
| cgitb | 处理 CGI 返回数据 |
| HTMLparse | HTML, XHTML 解析器 |
| htmlentitydefs | 一些 HTML 普通实体定义 |
| Cookie | 用于 HTTP 状态管理的服务器端 cookie |
| cookielib | HTTP 客户端的 cookie 处理类 |
| webbrowser | 控制器：向浏览器加载文档 |
| sgmllib | 解析简单的 SGML 文件 |
| robotparser | 解析 robots.txt 文件，对 URL 做“可获得性分析” |
| httplib | 用来创建 HTTP 客户端　|
| urllib | 通过 URL 或相关工具访问服务器 |

| Xml 处理 | 描述 |
| :--------- | :--------- |
| xml | 包含许多不同解析器的 XML 包 |
| xml.sax | 用于兼容 SAX2 的 XML（SAX）解析器 |
| xml.dom | 文档对象模型(DOM)XML解析器 |
| xml.etree | 树型 xml 解析器，基于 Element 灵活容器对象 |
| xml.parsers.expat | 非验证型 Expat XML 解析器的接口 |
| xmlrpclib | 通过 HTTP 提供 XML 远程过程调用 （RPC）客户端 |
| SimpleXMLRPCServer | python XML-RPC 服务器的基本框架 |
| DocXMLRPCServer | 自描述XML-RPC 服务器的基本框架 |

| Web 服务器 | 描述 |
| :--------- | :--------- |
| BaseHTTPServer | 开发 Web服务器的抽象类 |
| SimpleHTTPServer | 处理最简单的 HTTP 请求 (HEAD 和 GET) |
| CGIHTTPServer | 像 SimpleHTTPServer 一样处理 Web文件，还能处理 CGI （HTTP POST） 请求 |
| wsgiref | 定义 Web 服务器和 Python Web 应用程序间的标准接口的包 |






















