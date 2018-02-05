---
layout: post
title:  "Python Eighth Step: 数据库编程"
date:   2018-01-16 16:50
categories: Python
comments: true
description: Python Eighth Step！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2018/01/16/python-eighth-step/](http://afra55.github.io/2018/01/16/python-eighth-step/)

## 数据库编程

SQL 结构化查询语言

数据库 通常 使用 文件 系统 作为 基本 的 持久 化 存储， 它 可以 是 普通 的 操作系统 文件、 专用 的 操作系统 文件， 甚至 是 原始 的 磁盘 分区

RDBMS 关系数据库管理系统，通常 可以 管理 多个 数据库

MySQL 是一 种 基于 服务 的 RDBMS， 因为 它有 一个 服务器 进程 始终 运行 以 等待 命令行 输入； 而 SQLite 和 Gadfly 则 不会 运行 服务器

数据库 存储 可以 抽象 为 一张 表。 每 行数 据 都有 一些 字段 对 应于数据库 的 列。 每 一列 的 表 定义 的 集合 以及 每个 表 的 数据 类型 放到 一起 定义 了 数据库 的 模式（ schema）

数据库 命令 和 查询 操作 是 通过 SQL 语句 提 交给 数据库 的，一般来说， 对 数据库 关键字 使用 大写字母 是最 为 广泛 接受 的 风格。 大多数 命令行 程序 需要 一条 结尾 的 分号（;） 来 结束 这条 SQL 语句

创建数据库:  `CREATE DATABASE test;`

为指定用户提升权限，以便操作数据库：`GRANT ALL ON test.* to user(s);`

有了权限后便可以进行如下操作

    USE test;   # 使用数据库
    DROP DATABASE test;     # 删除数据库
    CREATE TABLE users (login VARCHAR(8), userid INT, projid INT);      # 创建表, 字符串列 login, 整形列 userid 和 projid
    DROP TABLE users;       # 删除表
    INSERT INTO users VALUES('afra',1110, 1);    # 插入行
    UPDATE users SET projid=4 WHERE projid = 1;     # 更新行
    DELETE FROM users WHERE projid=%d;  # 删除行
    DELETE FROM users;  # 删除表中所有行

### Python 数据库API(DB-API)

访问 数据库 包括 直接 通过 数据库 接口 访问 和 使用 ORM 访问 两种 方式。 其中 使用 ORM 访问 的 方式 不需要 显 式 给出 SQL 命令， 但也 能 完成 相同 的 任务

Gadfly 数据库，一个完全使用 Python 编写的简单的 RDBMS

在 Python 中 数据库 是 通过 适配器 的 方式 进行 访问

DB-API 是 阐明 一系列 所需 对象 和 数据库 访问 机制 的 标准， 它可 以为 不同 的 数据库 适配器 和 底层 数据库 系统 提供 一致 性的 访问

| 属性 | 描述 |
| :--------- | :--------- |
| apilevel | 字符串值，默认是1，需要适配兼容的 DB-API 版本 |
| threadsafety | 整形值，本模块的线程安全级别 |
| paramstyle | 字符串值，本模块的 SQL 语句参数风格 |
| connet() | Connet() 函数 |

threadsafety 有如下几个可选值：

    0： 不支持 线程 安全。 线程 间 不能 共享 模块
    1： 最小化 线程 安全 支持： 线程 间 可以 共享 模块， 但是 不能 共享 连接
    2： 适度 的 线程 安全 支持： 线程 间 可以 共享 模块 和 连接， 但是 不能 共享 游标
    3： 完整 的 线程 安全 支持： 线程 间 可以 共享 模块、 连接 和 游标

| paramstyle 参数风格 | 描述 | 示例 |
| :--------- | :--------- | :--------- |
| numeric | 数值位置风格 | WHERE name=:1 |
| named | 命名风格 | WHERE name=:name |
| pyformat | python 字典 print() 格式转换 | WHERE name=%(name)s |
| qmark | 问号风格 | WHERE name=? |
| format | ANSIC 的 print() 格式转换 | WHERE name=%s |

connect() 函数 通过 Connection 对象 访问 数据库。 兼容 模块 必须 实现 connect() 函数， 该 函数 创建 并 返回 一个 Connection 对象

| connet() 参数 | 描述 |
| :--------- | :--------- |
| user | 用户名 |
| password | 密码 |
| host | 主机名 |
| database |  数据库名 |
| dsn | 数据源名 |

`connect(dsn='myhost:MYDB', user='afra55', password='123456')`

| 异常 | 描述 |
| :--------- | :--------- |
| Warning | 警告异常基类 |
| Error | 错误异常基类 |
| InterfaceError | 数据库接口错误 |
| DatabaseError | 数据库错误 |
| DataError | 处理数据时出现问题 |
| OperationError | 数据库操作执行期间出现错误 |
| IntegrityError | 数据库关系完整性错误 |
| InternalError | 数据库内部错误 |
| ProgrammingError | SQL 命令执行命令 |
| NotSupportedError | 不支持的操作 |


应用 与 数据库 之间 进行 通信 需要 建立 数据库 连接

| Connection 对象方法 | 描述 |
| :--------- | :--------- |
| close() | 关闭数据库连接 |
| commit() | 提交当前事务 |
| rollback() | 取消当前事务 |
| cursor() | 使用该连接创建并返回一个游标或类游标的对象 |
| errorhandler(cxn, cur, errcls, errval) | 作为给定连接的游标的处理程序 |


当 建立 连接 后， 就可以 和 数据库 进行 通信 了,游标 可以 让 用户 提交 数据库 命令， 并 获得 查询 的 结果 行


| Cursor 对象属性 | 描述 |
| :--------- | :--------- |
| arraysize | 使用 fetchmany() 时，一次取出的结果行数，默认是1 |
| connection | 创建此游标的连接 |
| description | 返回游标活动状态（7项元组）：(name, type_code, display_size, internal_size, precision, scale, null_ok), 只有 name 和 type_code 是必须的 |
| lastrowid | 上次修改行的行 ID，如果不支持 ID 则返回 None |
| rowcount | 上次 excute() 方法处理或影响的行数 |
| callproc() | 调用存储过程 |
| close() | 关闭游标 |
| execute() | 执行数据库查询或命令 |
| executemany() | execute() 和 map() 结合， 为给定的所有参数准备并执行数据库查询或命令 |
| fetchone() | 获取查询结果的下一行 |
| fetchmany(size) | 获取查询结果的下面 size 行 |
| fetchall() | 获取查询结果的所有（剩余）行 |
| `__iter()__` | 为游标创建迭代器对象 |
| messages | 游标执行后从数据库中获得的消息列表（元组集合） |
| next() | 在迭代器中用于获取查询结果的下一行 |
| nextset() | 移动到下一个结果集合 |
| rownumber | 当前结果集中游标的索引(以行为单位，从 0 开始) |
| setinputsize(size) | 设置允许的最大输入大小 |
| setoutputsize(size) | 设置列获取的最大缓冲大小 |

SQL 的 NULL 值 对 应于 Python 的 NULL 对象 None


| 类型对象 | 描述 |
| :--------- | :--------- |
| Date(y,M,d) | 日期值对象 |
| Time(h,m,s) | 事件值对象 |
| Timestamp(y,M,d,h,m,s) |  时间戳值对象 |
| DateFromTicks(ticks) | 日期对象，给出从新纪元时间(1980年1月1日 00:00:00 UTC)以来的秒数 |
| TimeFromTicks(ticks) | 时间对象，给出从新纪元时间(1980年1月1日 00:00:00 UTC)以来的秒数 |
| TimestampFromTicks(ticks) | 时间戳对象，给出从新纪元时间(1980年1月1日 00:00:00 UTC)以来的秒数 |
| Binary(string) | 对应二进制字符串对象 |
| STRING | 表示基于字符串列的对象，例如 VARCHAR |
| BINARY | 表示二进制列的对象，比如 RAW、BLOB |
| NUMBER | 表示数值列的对象 |
| DATETIME | 表示日期时间列的对象 |
| ROWID | 表示'行ID'列的对象 |

[更多数据库编程信息](https://wiki.python.org/moin/DatabaseProgramming)

### 适配器示例

    from distutils.log import warn as printf
    import os
    from random import randrange as rand


    COLSIZ = 10
    FIELDS = ('login', 'userid', 'projid')
    RDBMSs = {'s': 'sqlite', 'm': 'mysql', 'g': 'gadfly'}
    DBNAME = 'test'
    DBUSER = 'root'
    DB_EXC = None  # 数据库异常
    NAMELEN = 16

    tformat = lambda s: str(s).title().ljust(COLSIZ)  # 格式化字符串来显示标题
    cformat = lambda s: s.upper().ljust(COLSIZ)  # 全大写


    def setup():
        return RDBMSs[input('''
    选择一个数据库系统:

    (M)ySQL
    (G)adfly
    (S)QLite

    输入: ''').strip().lower()[0]]


    def connect(db):
        """
        找到合适的模块，并加载数据库，建立连接
        :param db:  模块名
        :return:    返回 Connection 对象
        """
        global DB_EXC
        dbDir = '%s_%s' % (db, DBNAME)

        if db == 'sqlite':
            try:
                import sqlite3
            except ImportError:
                try:
                    from pysqlite2 import dbapi2 as sqlite3
                except ImportError:
                    return None

            DB_EXC = sqlite3
            if not os.path.isdir(dbDir):
                os.mkdir(dbDir)
            cxn = sqlite3.connect(os.path.join(dbDir, DBNAME))

        elif db == 'mysql':
            try:
                import MySQLdb
                import _mysql_exceptions as DB_EXC

                try:
                    cxn = MySQLdb.connect(db=DBNAME)
                except DB_EXC.OperationalError:
                    try:
                        cxn = MySQLdb.connect(user=DBUSER)
                        cxn.query('CREATE DATABASE %s' % DBNAME)
                        cxn.commit()
                        cxn.close()
                        cxn = MySQLdb.connect(db=DBNAME)
                    except DB_EXC.OperationalError:
                        return None
            except ImportError:
                try:
                    import mysql.connector
                    import mysql.connector.errors as DB_EXC
                    try:
                        cxn = mysql.connector.Connect(**{
                            'database': DBNAME,
                            'user': DBUSER,
                        })
                    except DB_EXC.InterfaceError:
                        return None
                except ImportError:
                    return None

        elif db == 'gadfly':
            try:
                from gadfly import gadfly
                DB_EXC = gadfly
            except ImportError:
                return None

            try:
                cxn = gadfly(DBNAME, dbDir)
            except IOError:
                cxn = gadfly()
                if not os.path.isdir(dbDir):
                    os.mkdir(dbDir)
                cxn.startup(DBNAME, dbDir)
        else:
            return None
        return cxn


    def create(cur):
        """
        在数据库中创建一个新表 users
        :param cur:
        :return:
        """
        try:
            cur.execute('''
                CREATE TABLE users (
                    login  VARCHAR(%d),
                    userid INTEGER,
                    projid INTEGER)
            ''' % NAMELEN)
        except (DB_EXC.OperationalError, DB_EXC.ProgrammingError):
            drop(cur)
            create(cur)


    drop = lambda cur: cur.execute('DROP TABLE users')  # 删除users表

    NAMES = (
        ('aaron', 8312), ('angela', 7603), ('dave', 7306),
        ('davina', 7902), ('elliot', 7911), ('ernie', 7410),
        ('jess', 7912), ('jim', 7512), ('larry', 7311),
        ('leslie', 7808), ('melissa', 8602), ('pat', 7711),
        ('serena', 7003), ('stan', 7607), ('faye', 6812),
        ('amy', 7209), ('mona', 7404), ('jennifer', 7608),
    )


    def rand_name():
        """
        获取名字及ID
        :return: 名字及ID
        """
        pick = set(NAMES)
        while pick:
            yield pick.pop()


    def insert(cur, db):
        """
        插入名字和ID到users表中
        :param cur: 游标
        :param db: 模块
        :return:
        """
        if db == 'sqlite':
            cur.executemany("INSERT INTO users VALUES(?, ?, ?)",
                            [(who, uid, rand(1, 5)) for who, uid in rand_name()])
        elif db == 'gadfly':
            for who, uid in rand_name():
                cur.execute("INSERT INTO users VALUES(?, ?, ?)",
                            (who, uid, rand(1, 5)))
        elif db == 'mysql':
            cur.executemany("INSERT INTO users VALUES(%s, %s, %s)",
                            [(who, uid, rand(1, 5)) for who, uid in rand_name()])


    get_rc = lambda cur: cur.rowcount if hasattr(cur, 'rowcount') else -1  # 上次 excute() 方法处理或影响的行数


    def update(cur):
        """
        随机更新表中的行的projid通过projid
        :param cur:
        :return:
        """
        fr = rand(1, 5)
        to = rand(1, 5)
        cur.execute(
            "UPDATE users SET projid=%d WHERE projid=%d" % (to, fr))
        return fr, to, get_rc(cur)


    def delete(cur):
        """
        随机删除表中的行通过projid
        :param cur:
        :return:
        """
        rm = rand(1, 5)
        cur.execute('DELETE FROM users WHERE projid=%d' % rm)
        return rm, get_rc(cur)


    def db_dump(cur):
        """
        从数据库中拉取所有行，并显示
        :param cur:
        :return:
        """
        cur.execute('SELECT * FROM users')
        printf('\n%s' % ''.join(map(cformat, FIELDS)))
        for data in cur.fetchall():
            printf(''.join(map(tformat, data)))


    def main():
        db = setup()
        printf('*** 连接到数据库 %r ' % db)
        cxn = connect(db)
        if not cxn:
            printf('ERROR:不支持 %r 数据库或者无法获取该数据库, exit' % db)
            return
        cur = cxn.cursor()

        printf('\n*** 创建 users 表')
        create(cur)

        printf('\n*** 插入 names 到表中')
        insert(cur, db)
        db_dump(cur)

        printf('\n*** 随机移动用户到另一个组')
        fr, to, num = update(cur)
        printf('\t(%d 个用户被移动) 从 (%d) 到 (%d)' % (num, fr, to))
        db_dump(cur)

        printf('\n*** 随机删除用户组')
        rm, num = delete(cur)
        printf('\t(组 #%d; %d 用户被删除)' % (rm, num))
        db_dump(cur)

        printf('\n*** 删除表')
        drop(cur)
        printf('\n*** 关闭连接')
        cur.close()
        cxn.commit()
        cxn.close()


    if __name__ == '__main__':
        main()


### ORM

ORM 系统将 纯 SQL 语句 进行 了 抽象化 处理， 将其 实现 为 Python 中的 对象， 这样 你 只 操作 这些 对象 就能 完成 与生 成 SQL 语句 相同 的 任务

SQLObject 更加 简单、 更加 类似 Python、 更 快速， 而在 SQLAlchemy 中 对象 的 抽象化 十分 完美，以及更好的 灵活性 用来 提交 原生 SQL 语句

SQLAlchemy: http://sqlalchemy.org
SQLObject: http://sqlobject.org

### 非关系数据库

MongoDB 类示例

    from pymongo import Connection, errors

    class MongoTest(object):
        def __init__(self):
            try:
                cxn = Connection()
            except errors.AutoReconnect:
                raise RuntimeError()
            self.db = cxn[DBNAME]   # 创建或复用数据库
            self.users = self.db[COLLECTION]    # 获取 users 集合

        def insert(self):
            """
            插入用户名和ID 到 users 集合中
            :return:
            """
            self.users.insert(dict(login=who, userid=uid, projid=rand(1, 5)) for who, uid in randName())

        def update(self):
            """
            更新projid
            :return:
            """
            fr = rand(1, 5)
            to = rand(1, 5)
            i = -1
            for i, user in enumerate(self.users.find({'projid': fr})):
                self.users.update(user,
                                  {'$set': {'projid': to}})
            return fr, to, i + 1

        def delete(self):
            """
            删除行
            :return:
            """
            rm = rand(1, 5)
            i = -1
            for i, user in enumerate(self.users.find({'projid': rm})):
                self.users.remove(user)
            return rm, i + 1

        def db_dump(self):
            """
            获取所有行
            :return:
            """
            printf('\n%s' % ''.join(map(cformat, FIELDS)))
            for user in self.users.find():
                printf(''.join(map(tformat,
                                   (user[k] for k in FIELDS))))

        def finish(self):
            """
            断开连接
            :return:
            """
            self.db.connection.disconnect()














