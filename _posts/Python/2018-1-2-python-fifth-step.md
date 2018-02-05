---
layout: post
title:  "Python Fifth Step: 正则表达式"
date:   2018-01-02 21:04
categories: Python
comments: true
description: Python Fifth Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/02/python-fifth-step/](http://afra55.github.io/2018/01/02/python-fifth-step/)

## 正则表达式

正则表达式是包含文本和特殊字符的字符串，该字符串描述一个可以识别各种字符串的模式

### 常见正则表达式符号和特殊字符

| 符号 | 说明 | 示例 |
| :------ | :------ | :------ |
| literal | 匹配文本字符串的字面值 literal | foo | 
| text1&#124;text2 | 匹配正则表达式 text1 或 text2 | one&#124;One |
| . | 匹配任何字符（除了\n之外） | b.b |
| ^ | 匹配字符串起始部分 | ^Lover |
| $ | 匹配字符串终止部分 | /bin/*sh$ |
| * | 匹配 0 次或多次前面出现的正则表达式 | `[A-Za-z0-9]*` |
| + | 匹配 1 次或多次前面出现的正则表达式 | `[a-z]+\.com` |
| ? | 匹配 0 次或 1 次前面出现的正则表达式 | goo? |
| {N} | 匹配 N 次前面出现的正则表达式 | `[0-9]{7}` |
| {M,N} | 匹配 M~N 次前面出现的正则表达式 | `[0-9]{5,7}` |
| `[...]` | 匹配来自字符集的任意单一字符 | `[aeiou]` |
| `[..x-y..]` | 匹配 x~y 范围中的任意单一字符 | `[0-9],[A-Za-z]` |
| `[^...]` | 不匹配此字符集中出现的任一字符，包括在该字符集中出现的某一范围的字符 | `[^aeiou],[^A-Za-z0-9]` |
| (`*`&#124;+&#124;?&#124;{})? | 用于匹配上面频繁出现或重复出现符号的非贪婪版本(`*`, +, ?, {}), 例如 `\*(.+?)\*`匹配`*abc*def*`中的`*abc*`而不是`*abc*def*` | `.*?[a-z]` |
| (...) | 匹配封闭的正则表达式，然后另存为子组 | ([0-9]{3})?,f(oo&#124;u)bar |


| 特殊字符 | 说明 | 示例 |
| :------ | :------ | :------ |
| `\d` | 匹配任何十进制数字，与 `[0-9]` 一致, `\D` 与 `\d` 相反意思是匹配一个非数字字符。等价于`[^0-9]` | data\d+.txt |
| `\w` | 匹配任何字母数字字符, 与 `[A-Za-z0-9]` 一致(`\W` 意义相反) | `[A-Za-z_]\w+` |
| `\s` | 匹配任何空格字符，与 `[\n\t\r\v\f]` 相同（`\S` 意义相反） | of\sthe |
| `\b` | 匹配任何单词边界,也就是指单词和空格间的位置, 例如，“er\b”可以匹配“never”中的“er”，但不能匹配“verb”中的“er”(`\B`意义相反) | `\bThe\b` |
| `\N` | 匹配已保存的子组 N (参见 `(...)`) | price:\16 |
| `\c` | 逐字匹配任何特殊字符c (仅按照字面意义匹配，不匹配特殊含义) | `\.,\\,\*` | 
| `\A(\Z)` | 匹配字符串的起始（结束）（参见^, $）| `\ALover` |



| 扩展表示法 | 说明 | 示例 |
| :------ | :------ | :------ |
| `(?iLmsux)` | 在正则表达式中嵌入一个或多个特殊“标记”参数（或函数/方法） | `(?i), (?x), (?im)` |
| `(?:...)` | 表示一个匹配不用保存的分组 | `(?:\w+\.)*` |
| `(?P<name>)...` | 表示一个仅由 name 标识而不是数字标识的正则分组 | `(?P<data>)` |
| `(?P=name)` | 在同一字符串中匹配之前的 `(?P<name>)` 正则分组 | `(?P=data)` |
| `(?#...)` | 表示注释，所有内容都被忽略 | `(?#comment)` |
| `(?=...)` | 正向前视断言: 例如，“Windows(?=7&#124;8&#124;9&#124;2000)”能匹配“Windows2000”中的“Windows”，但不能匹配“Windows10”中的“Windows” | `(?=.com)` |
| `(?!=...)` | 负向前视断言: 例如，“Windows(?!7&#124;8&#124;9&#124;2000)”能匹配“Windows10”中的“Windows”，但不能匹配“Windows2000”中的“Windows” | `(?!=.net)` |
| `(?<=...)` | 正向后视断言: 例如，“(?<=7&#124;8&#124;9&#124;2000)Windows”能匹配“2000Windows”中的“Windows”，但不能匹配“10Windows”中的“Windows” | `(?<=800-)` |
| `(?<!...)` | 负向后视断言：例如，"`(?<!2000)Windows`" 能匹配"10Windows" 中的 "Windows", 但不能匹配 "2000Windows" 中的"windows" | `(?<!192\.168\.)` |
| (?(id/name)Y&#124;N) | 如果分组所提供的 id 或 name 存在，就返回正则表达式的条件匹配Y, 如果不存在就返回 N (&#124;N 是可选的) | (?(1)y&#124;x) |


### 择一匹配

`|` 是表示择一匹配（并，也可称作或）的符号, 即从多个模式中选择其一

比如 `你|我|他` 匹配的字符串是 '你'、'我'、'他'

### 字符集

由方括号包含 `[...]`, 能够匹配一对方括号中包含的任何字符

`b[aeiou]t` 匹配 'bat','bet','bit','bot','but'

方括号中，两个字符用 `-` 连字符连接，代表字符的范围

A-Z,a-z,0-9 分别表示大写字母，小写字母，数字

`[^...]` 表示不匹配字符集中的任一字符

### 闭包

闭包，匹配一个或多个或没有出现的字符模式

Kleene 闭包: `*`

正闭包操作符：`+`

`?`, `{}`

使用分组操作符时，正则表达式引擎会尽可能的扩大匹配的范围，这叫做贪婪匹配

加 `?` 可以避免贪婪匹配

### 分组

使用圆括号指定分组

`\d+(\.\d*)?` 任何十进制数字后面可以接一个小数点和零个或多个数字，例如 0.003, 3, 33.

### 使用 Python 写正则

Python 通过 re 模块来支持正则表达式

| re 模块函数 | 说明 |
| :------ | :------ |
| `compile(pattern, flags=0)` | 使用可选的标记（flags）来编译正则表达式的模式，并返回一个正则表达式对象 |

| re 模块函数和正则表达式对象的方法 | 说明 |
| :------ | :------ |
| `match(pattern, string, flags=0)` | 使用带有可选标记(flags)的正则表达式对象来匹配字符串，如果匹配成功则返回匹配对象，否则返回 None |
| `search(pattern, string, flags=0)` | 使用可选标记搜索字符串中第一次出现的正则表达式模式，如果匹配成功则返回匹配对象，否则返回 None |
| `findall(pattern, string, flags=0)` | 查找字符串中所有（非重复）出现的正则表达式模式，并返回一个匹配列表 |
| `finditer(pattern, string, flags=0)` | 与 findall() 函数相同，但返回的是一个迭代器，对每一次匹配，迭代器都返回一个匹配对象 |
| `split(pattern, string, maxsplit=0, flags=0)` | 根据正则表达式的模式分隔符， 将字符串分隔为列表， 然后返回成功匹配的列表，分隔最多操作 maxsplite 次(默认分隔所有匹配成功的位置) |
| `sub(pattern, repl, string, count=0, flags=0)` | 使用 repl 替换所有正则表达式模式在字符串中出现的位置, 除非定义 count 否则替换所有位置(subn()函数返回替换操作的数目) |
| `purge()` | 清除隐式编译的正则表达式模式 |

| 常用的匹配对象方法 | 说明 |
| :------ | :------ |
| `group(self, *args)` | 默认返回整个匹配对象，如果传入数字(`group(num=0)`)则子组模式的匹配对象，默认是0即整个匹配对象，如果传入多个参数(`group(0, 1, 2)`则返回一个元组包含传入编号的子组的匹配对象 |
| `groups(self, default=None)` | 返回一个包含所有匹配子组的元组,如果没有匹配成功，则返回空元组 |
| `groupdict(self, default=None)` | 返回一个包含所有匹配的命名子组的字典，所有子组名称作为字典的键，如果没有成功匹配，则反回一个空字典 |

| 常用的模块属性(用于正则表达式的标记 flags, (?iLmsux)) | 说明 |
| :------ | :------ |
| `re.I` `re.IGNORECASE` | 不区分大小写匹配 |
| `re.L` `re.LOCALE` | 根据所使用的本地语言环境通过 `\w,\W,\b,\B,\s,\S` 实现匹配 |
| `re.M` `re.MULTILINE` | `^`和`$`分别匹配目标字符串中行的起始和结尾，而不是严格匹配整个字符串本身的起始和结尾 |
| `re.S` `re.DOTALL` | 表示 `.`点能够匹配所有字符包括 `\n` 换行符 |
| `re.X` `re.VERBOSE` | 通过反斜杠转义，否则所有空格和#（以及该行中所有的后续文字）都被忽略，除非在字符类中或者允许注释且提高可读性 |

match() 函数从字符串起始部分对模式进行匹配，如果匹配成功返回一个匹配对象，匹配失败返回None

    m = re.match('victor', 'victor')    # 匹配成功，则返回一个匹配对象 <_sre.SRE_Match object; span=(0, 6), match='victor'>
    if m is not None:
        m.group()   # victor, 返回匹配的字符串

search() 在字符串中查找模式, 当需要匹配的模式出现在字符串中间时('aavictor') 则 match() 会匹配失败，search() 会在任意位置对正则表达式的模式进行匹配，如果搜索到成功的匹配，就会返回一个匹配对象, 否则返回 None

    m = re.match('victor', 'i am victor')   # None
    if m is not None:
        print(m.group())
    print('--')
    s = re.search('victor', 'i am victor')  # <_sre.SRE_Match object; span=(5, 11), match='victor'>
    if s is not None:
        print(s.group())    # victor

子组

    m = re.match('(\w\w\w)-(\d\d\d)', 'abc-123')
    if m is not None:
        print(m.group(), m.group(1), m.group(2))    # abc-123 abc 123
        print(m.groups())                           # ('abc', '123')

findall()

    m = re.findall('victor', 'victor i am victor yvictor')
    if m is not None:
        print(m)         # ['victor', 'victor', 'victor']   

sub() subn()


    m = re.sub('X', 'Victor', 'I am X, i love X')
    if m is not None:
        print(m)        # I am Victor, i love Victor

    m = re.subn('X', 'Victor', 'I am X, i love X')
    if m is not None:
        print(m)        # ('I am Victor, i love Victor', 2)

    m = re.sub(r'(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})', r'\2/\1/\3', '20/3/2018')  # \1, \2, \3 分别代表分组1，2，3,即前面模式中圆括号扩起来的
    if m is not None:
        print(m)        # 3/20/2018

split()

    m = re.split(':', '1:2:3:and')
    if m is not None:
        print(m)    # ['1', '2', '3', 'and']




    data = (
        'A, 129',
        'B, 230',
        'C, 409',
        'D MN',
        'E HU'
    )
    for d in data:
        m = re.split(', | (?=(?:\d{3}|[A-Z]{2}))', d)
        if m is not None:
            print(m)

    """
    输出
    ['A', '129']
    ['B', '230']
    ['C', '409']
    ['D', 'MN']
    ['E', 'HU']
    """

扩展符号

(?iLmsux)

    m = re.findall('yes', 'yes, Yes, YES')
    if m is not None:
        print(m)    # ['yes']

    m = re.findall('(?i)yes', 'yes, Yes, YES')
    if m is not None:
        print(m)    # ['yes', 'Yes', 'YES']

    m = re.findall('yes', 'yes, Yes, YES', flags=re.I)
    if m is not None:
        print(m)    # ['yes', 'Yes', 'YES']

    m = re.findall('(?im)(^th[\w]+)', """
    The me is that.
    That what i have you.
    th hh h h.
    """)
    if m is not None:
        print(m)    # ['The', 'That']

原始字符串差异, 如果 有 符号 同时 用于 ASCII 和 正 则 表达式，则需要使用原始字符串来避免问题,例如： `r'\b'`

    m = re.match('\byes', 'yes')    # \b 退格符号
    if m is not None:
        print(m.group())    # None

    m = re.match('\\byes', 'yes')   # \\b 正则表达式
    if m is not None:
        print(m.group())    # yes

    m = re.match(r'\byes', 'yes')   # \b 正则表达式
    if m is not None:
        print(m.group())    # yes























