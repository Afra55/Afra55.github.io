---
layout: post
title:  "Django - Field types reference (译)"
date:   2017-12-25 13:58
categories: Python
comments: true
description: Django - Field types reference (译)！
---

* content
{:toc}

## 本文

[http://afra55.github.io/2017/12/25/django-field-types-reference/](http://afra55.github.io/2017/12/25/django-field-types-reference/)

## Model field reference

https://docs.djangoproject.com/en/2.0/ref/models/fields/

## Field options 

下面的参数适用所有的参数类型（field type）。都是可选的。

### null

`Field.null`

如果是 `True`， `Django` 会在数据库中将空值存储为 `NULL`。默认是 `False`。

避免在基于字符串的字段（例如：CharField, TextField）上使用 null。
如果基于字符串的字段设置 `null=True`，就意味空数据可能有两种一种是 `NULL` 一种是空字符串 `""`。
在多数情况下，空数据不应该有两种情况。Django 约定使用空字符串而不是 `NULL`。
一个例外是当 `CharField` 同时设置了 `unique=True` `blank=True` ，这个时候 `null=True` 是必须的，以避免保存多个空值对象时 unique 的约束问题。

对于同时基于字符串和非基于字符串的字段，如果允许表单中有空值，需要设置 `blank=True` ，因为 `null` 参数之影响数据库存储。

如果你想要 `BooleanField` 接收 `null` 数据，使用 `NullbooleanField` 字段来代替 `BooleanField`。

### blank

`Field.blank`

如果是 `True`， 则字段允许为空，默认是 `False`。

与 `null` 不用。 `null` 只针对数据库存储，`blank` 与验证数据有关。
如果一个字段设置 `blank=True`, 则表单允许输入一个空置。
如果设置 `blank=False`，就说明该字段是必填项。

### choices

`Field.choices`

一个迭代器（例如列表或元组）包含了多个恰好有两个项目的迭代器（例如：`[(A, B), (A, B) ...]`），这个迭代器作为字段的选择时，默认表单控件会是个有这些选项的选择框而不是输入框。

在每个元组中第一个元素是实际值，第二个是可读的名字。例如：

        YEAR_IN_SCHOOL_CHOICES = (
                ('FR', 'Freshman'),
                ('SO', 'Sophomore'),
                ('JR', 'Junior'),
                ('SR', 'Senior'),
        )

通常情况下，最好在 model 类中定义选择项，并为每个值定义一个适合命名的常量:

        from django.db import models

        class Student(models.Model):
                FRESHMAN = 'FR'
                SOPHOMORE = 'SO'
                JUNIOR = 'JR'
                SENIOR = 'SR'
                YEAR_IN_SCHOOL_CHOICES = (
                        (FRESHMAN, 'Freshman'),
                        (SOPHOMORE, 'Sophomore'),
                        (JUNIOR, 'Junior'),
                        (SENIOR, 'Senior'),
                )
                year_in_school = models.CharField(
                max_length=2,
                choices=YEAR_IN_SCHOOL_CHOICES,
                default=FRESHMAN,
        )

        def is_upperclass(self):
                return self.year_in_school in (self.JUNIOR, self.SENIOR)

虽然可以把选项列表声明在 model 类外面再去引用它，但是声明在 model 类里面的选择项将信息和类绑定在了一起并易于引用(例如：只要 `Student` model 类被引用，`Student.SOPHOMORE` 就可以用在任何地方)。

还可以把有用的选项放进命名组，用来区分编组：

        MEDIA_CHOICES = (
                ('Audio', (
                        ('vinyl', 'Vinyl'),
                        ('cd', 'CD'),
                    )
                ),
                ('Video', (
                        ('vhs', 'VHS Tape'),
                        ('dvd', 'DVD'),
                    )
                ),
                ('unknown', 'Unknown'),
        )

每个元祖的第一个元素是这一组的名字，第二个元素是个迭代器存储着两个元素的元组(第一个元素是实际值，第二个是可读的名字)
, 分组选项可以与单个列表中的未分组选项组合(例如本例中的未知选项)。

对每个设置了 `choices` 的字段， Django 会添加一个方法来获取字段的当前值的可读名字。 [get_FOO_display()](https://docs.djangoproject.com/en/2.0/ref/models/instances/#django.db.models.Model.get_FOO_display)

这些选项可以是任何的迭代对象，不一定是个列表或元组。这可以动态的设计选择项。如果 `choices` 是动态的，最好使用带有外键 ForeignKey 的表，这样静态数据就不会改变太多。

除非设置 `blank=False` 否则选择框的标签会展示 "---------" 来代表空值，来避免这种行为，可以在选项中添加一个元组包含 `None` 例如：`(None, '需要展示的字符串')`。或者，可以使用空字符串来代替 `None`。

### db_column

`Field.db_column`

数据库列名使用这个字段。么有没有设置这个参数，则 Django 默认使用字段的名字。

如果数据库列名是一个SQL保留字，或者包含在Python变量名中不允许的字符，特别是连字符 `-`，那没关系。Django 会自己在列和表明加引号。

### db_index

`Field.db_index`

如果是 True，这个字段会创建一个数据库索引

### db_tablespace

`Field.db_tablespace`

如果字段有索引，则 `db_tablespace` 用于该索引的名称。

默认是项目的 `DEFAULT_INDEX_TABLESPACE`，或者模型的 `db_tablespace`。

### default 

`Field.default`

字段的默认值。这可以是一个值，也可以是一个可调用的对象。如果这个值是可调用的，那每次创建新对象他都会被调用。

默认值不能是一个可变的对象（模型实例, list, set, 等），作为对该对象的相同实例的引用，将在所有新模型实例中作为默认值使用.

可以将默认值包装成可调用的，例如，如果想给 `JSONField` 制定一个默认字典值，使用函数将值包装起来：

        def contact_default():
        return {"email": "to1@example.com"}

        contact_info = JSONField("ContactInfo", default=contact_default)

匿名函数不被用作字段选项因为它不能被序列化迁移( [serialized by migrations](https://docs.djangoproject.com/en/2.0/topics/migrations/#migration-serializing))。

对于映射到模型实例的 `ForeignKey` 等字段，默认值应该是它们引用的字段的值(除非`to_field`设置为`pk`)，而不是模型实例。

在创建新的模型实例并没有为该字段提供值时使用默认值。当字段是主键并设置为None时，也会使用默认值。

### editable

`Field.editable`

默认是 True，如果是 False 这个字段不会展现在管理员或其他 `ModelForm` 中。

### error_messages¶


`Field.error_messages`

`error_messages` 可以覆盖默认的字段信息。

传入 字典，这个字典的 key 是你想匹配的错误信息，值是错误信息。

错误信息的 key 包括 `null`, `blank`, `invalid_choice`, `invalid`, `unique`, `unique_for_date`。


### help_text

`Field.help_text`

额外的“帮助”文本将显示在表单控件上。即使字段不在表单中使用，它对文档也很有用。

允许     `help_text` 包含 HTML，例如：

    help_text="Please use the following format: <em>YYYY-MM-DD</em>."

可以使用 `django.utils.html.escape()` 来转义 HTML 特殊字符，避免跨站点脚本攻击。

###  primary_key¶

`Field.primary_key`

True, 则这个字段是模型的主键。

如果在模型中没有设置 `primary_key=True`，Django 会自动添加一个 `AutoField` 字段来作为主键。

`primary_key=True` 就意味 `null=False` `unique=True`。对象中只允许有一个主键。

主键字段是只读。

如果在已有的对象上改变主键并保存它，那会在旧的对象旁边创建一个新的对象出来。


### unique¶

`Field.unique`

True，代表这个字段在整个表是唯一的。

这个会在数据库级别和模型验证的时候强制执行。

如果保存有多个 unique 字段的模型，在调用 save() 方法时报错 `django.db.IntegrityError`。

这个字段对所有字段有效除了  `ManyToManyField ,OneToOneField`。

当设置 `unique=True` 就不需要设置 `db_index`, 因为 unique 意味创建索引。

### unique_for_date

`Field.unique_for_date`

将此设置在`DateField`或`DateTimeField`的字段上，以要求该字段在日期字段的值上是惟一的。

例如，如果有个 `title` 字段设置了 `unique_for_date="pub_date"`, Django 不允许两个 `title` 有相同的 `pub_date`。

如果给 `DateTimeField` 设置 unique_for_date, 只考虑字段的日期部分。此外，当 `USE_TZ=True`时，校验将在对象保存在当前时区时执行。

在模型验证过程中，这是由Model.validate_unique()强制执行的，但不是在数据库级别上执行的。如果任何unique_for_date约束涉及不属于ModelForm字段(例如，如果其中一个字段在 `exclude` 列表中或有`editable=False`的情况下)，Model.validate_unique()将跳过对该特定约束的验证。

### unique_for_month¶

`Field.unique_for_month`

和unique_for_date一样，但要求字段在这个月是唯一的。

### unique_for_year¶

`Field.unique_for_year`

### verbose_name¶

`Field.verbose_name`

一个人类可读的字段名。如果没有给出详细名称，Django将使用字段的属性名自动创建它，将下划线转换为空格。[Verbose field names](https://docs.djangoproject.com/en/2.0/topics/db/models/#verbose-field-names)。
### validators¶

`Field.validators`

为这个字段运行验证器列表。[validators documentation](https://docs.djangoproject.com/en/2.0/ref/validators/)

`Registering and fetching lookups`

字段实现[查找注册API](https://docs.djangoproject.com/en/2.0/ref/models/lookups/#lookup-registration-api)。该API可用于自定义字段类可用的查找，以及从字段中获取查找的方式。


   ##  Field types

### AutoField

`class AutoField(**options)`  [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#AutoField)

一个 `IntegerField` 字段，自动递增。

### BigAutoField

`class BigAutoField` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#BigAutoField)

一个64位整数，类似 `AutoField` 但是数值范围更大  1 到 9223372036854775807。

### BigIntegerField

`class BigIntegerField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#BigIntegerField)

一个64位整数，类似 `IntegerField` 但是它的范围是 -9223372036854775808 到 9223372036854775807.默认的表单控件是 `TextInput`。

### BinaryField

`class BinaryField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#BinaryField)


存储原始二进制数据的字段。需要注意这个字段的功能有限。例如，不可能在 `BinaryField` 上过滤查询集(queryset)。也不可能在一个 `ModelForm` 中包含一个 `BinaryField` 。


### BooleanField

`class BooleanField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#BooleanField)

一个 true/false 字段。

默认表单控件是 `CheckboxInput`。

如果想要接收 `null` 值，则使用 `NullBooleanField` 替换。

`BooleanField` 默认的值是 `None` , 除非设置了 `Field.default`。

### CharField

`class CharField(max_length=None, **options)`  [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#CharField)

一个字符串字段，。

大量文本使用 `TextField`。

默认表单空间是 `TextInput`。

`CharField` 有一个必须的参数：

`CharField.max_length` 最大字符长度。在数据库级别和验证时候执行。

### DateField

`class DateField(auto_now=False, auto_now_add=False, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#DateField)

日期， 在 Python 中以 `datetime.date` 实例展示。有几个可选参数：

#### `DateField.auto_now`

每次保存对象时，都会设置这个字段为当前时间。用于展示最后一次修改的时间。

字段只在调用 `Model.save()` 时自动更新。在以其他方式(例如QuerySet.update())对其他字段进行更新时，该字段不会自动更新。

#### `DateField.auto_now_add`

当对象第一次创建时，自动将字段设置为当前时间。用于展示创建的时间。
即使你在创建对象时给这个字段设置一个值，这个设置的值会被忽略，如果想修改这个字段，如下设置来代替 `auto_now_add=True`:

· `DateField: default=date.today` （来自 `datetime.date.today()`）
· `DateTimeField: default=timezone.now`(来自 `django.utils.timezone.now()`)

默认的表单控件是 `TextInput`。 

选项auto_now_add,auto_now和default是互斥的。这些选项的任何组合都会导致错误。

### DateTimeField

`class DateTimeField(auto_now=False, auto_now_add=False, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#DateTimeField)

一个日期和时间, 在 Python 中以 `datetime.datetime` 实例展示。与DateField 有相同的额外参数。

默认的表单控件是一个单一的 `TextInput`。

### DecimalField

`class DecimalField(max_digits=None, decimal_places=None, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#DecimalField)

一个固定精度的十进制数，在 Python 中用`Decimal`的实例来表示。需要有两个参数:

#### DecimalField.max_digits

最多有几位数字，大于等于 `decimal_places`.

#### DecimalField.decimal_places

小数位个数。

例如，存储 999 以及小数点后两位，可以这么使用:

    models.DecimalField(..., max_digits=5, decimal_places=2)

当 `localize` 是 `False` 时默认表单控件是 `NumberInput` 否则是 `TextInput`

### DurationField

`class DurationField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#DurationField)

存储时间的字段，以 Python 的 `timedelta` 为模型。

在PostgreSQL中使用的数据类型是interval，而在Oracle中，数据类型是INTERVAL DAY(9)到SECOND(6)。否则，将使用一个微秒级的bigint。

### EmailField

`class EmailField(max_length=254, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#EmailField)

一个 `CharField` 并检查值是否是个合法的邮件地址。它使用 `EmailValidator` 验证输入。

### FileField

`class FileField(upload_to=None, max_length=100, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FileField)

一个文件上传字段。

有两个可选参数：

（1） FileField.upload_to

这个参数用于设置上传目录和文件名。值都传递给了 `Storage.save()` 

如果指定一个字符串值包含strftime()格式，它将被文件上传的日期/时间所取代(因此上传的文件不会上传到给定的目录)。例如:


   
        class MyModel(models.Model):
                # file will be uploaded to MEDIA_ROOT/uploads
                upload = models.FileField(upload_to='uploads/')
                # or...
                # file will be saved to MEDIA_ROOT/uploads/2015/01/30
                upload = models.FileField(upload_to='uploads/%Y/%m/%d/')

如果使用默认的 FileSystemStorage, 字符串会附加在 MEDIA_ROOT 路径之后。

upload_to也可以是可调用的，如函数。被调用用来获取上传路径包括名字。被调用时，必须接受两个参数，并返回一个统一样式的路径（带前斜杠）传递给存储系统。这两个参数是：

instance :  定义 FileField 的模型的一个实例。是当前文件连接的特定势力。
filename：文件的原始名字。

   
        def user_directory_path(instance, filename):
                # file will be uploaded to MEDIA_ROOT/user_<id>/<filename>
                return 'user_{0}/{1}'.format(instance.user.id, filename)

        class MyModel(models.Model):
                upload = models.FileField(upload_to=user_directory_path)

(2) FileField.storage

一个存储对象，它处理文件的存储和检索。


默认的表单空间是  ClearableFileInput。

在模型中使用FileField或ImageField(见下)需要几个步骤:

1 在配置文件中，需要将 MEDIA_ROOT 定义为 希望 Django 存储上传文件的完整路径。（为了性能，这些文件不存储在数据库中）定义 MEDIA_URL 作为该目录的基本 URL。确保目录是由 Web服务器的用户账户写入的。

2 将FileField或ImageField添加到模型中，定义upload_to选项来指定用于上传文件的MEDIA_ROOT的子目录。

3 所有上传的文件路径都会存储到数据苦衷，这个路径是相对 MEDIA_ROOT 的相对路径。如果 ImageField 命名为 mug_shot, 然后就可以在模板中获取图片绝对值路径{{ object.mug_shot.url }}。

例如，设置 MEDIA_ROOT 为 '/home/media'， upload_to 设置为 'photos/%Y/%m/%d'。 '%Y/%m/%d' 是 strftime() 格式。'%Y' 四位的年， '%m' 是两位的月份，'%d' 是两位的一月中的某天。如果在 2017年12月22日上传了一个文件，他会保存在 '/home/media/photos/2017/12/22' 目录下。

如果想要检索上传文件的在磁盘中的文件名或文件大小，则可以使用属性 `name` 和 `size` 来查看。

FileField 实例在数据库中是作为 varchar 列来存储的，默认最大长度是 100 个字符。可以使用 max_length 来更改最大长度。

### FileField and FieldFile

`class FieldFile` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FieldFile)

当在模型上方位 FileField 时，将获得一个 FieldFile 实例作为访问底层文件的代理。

The API of FieldFile mirrors that of File, with one key difference: The object wrapped by the class is not necessarily a wrapper around Python’s built-in file object.Instead, it is a wrapper around the result of the Storage.open() method, which may be a File object, or it may be a custom storage’s implementation of the File API.
In addition to the API inherited from File such as read() and write(), FieldFileincludes several methods that can be used to interact with the underlying file:

#### FieldFile.name

文件的名称，包括相对路径。

#### FieldFile.size

文件的大小，Storage.size() 方法的结果。

#### FieldFile.url

链接到文件的相对 URL ，通过调用 url() 方法来获得。

#### FieldFile.open(mode='rb')

[源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FieldFile.open)

以指定的模式打开或重新打开与该实例相关联的文件。与 Python 的 open() 方法不同,不反回文件描述符。

由于底层文件在访问文件的时候已经隐式的打开了文件，因此除了将指针重设到底层文件或更改模式外，这个方法是没必要调用的。

#### FieldFile.close()

[源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FieldFile.close)

类似于 Python 的 close() 方法，关闭与该实例相关联的文件。

#### FieldFile.save(name, content, save=True)

[源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FieldFile.save)

接受文件名和文件内容并将其传递给字段的存储类，然后将存储的文件与模型关联起来。如过想要手动将文件数据与模型的 FileField 实例关联，则使用 save() 方法来保存文件数据。

两个必须的参数：name 文件的名称，content 文件的内容对象。可选参数 save 判断是否在与该字段关联的文件被修改后保存实例模型。

content 参数应该是 `django.core.files.File` 实例，而不是 Python 内置的文件对象。可以从现有的 Python 文件对象中构建一个文件:

        from django.core.files import File# Open an existing file using Python's built-in open()
        f =  open('/path/to/hello.world')
        myfile = File(f)

或者可以从 Python 字符串中构建一个：

        from django.core.files.base import ContentFile
        myfile = ContentFile("hello world")

[查看更多信息](https://docs.djangoproject.com/en/2.0/topics/files/)

#### FieldFile.delete(save=True)

[源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#FieldFile.delete)

删除与实例相关联的文件，并清楚该字段上的所有属性。如果在调用 delete() 时候打开文件，则该方法会关闭该文件。

可选参数 save 来判断是否在与该字段关联的文件被删除后是否保存模型实例。默认是 True。

注意，当一个模型被删除的时候，相关联的文件不会被删除。

### FilePathField

`class FilePathField(path=None, match=None, recursive=False, max_length=100, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#FilePathField)

一个 CharField 只能选择在文件系统的某个目录下的文件名。有三个特殊的参数，第一个参数是必须的：

#### FilePathField.path

必须要传的参数。一个目录的绝对路径，例如：`"/home/images"`。

#### FilePathField.match

可选参数, 一个正则表达式，是一个字符串，用于筛选文件名子。
这个正则用于基本文件名，不是全路径。
例如:`"foo.*\.txt$"`，会匹配名字为 "foo23.txt"的文件而不是 "bar.txt" 或者 "foo23.png"。


#### FilePathField.recursive

可选参数，True 或 False。默认是 Flase。指定是否包含目录的所有子目录。

#### FilePathField.allow_files

可选参数。True 或 False。默认是 True。指定是否应该包含指定位置的文件。与 allow_folders 其中之一必须为 True。

#### FilePathField.allow_folders

可选参数。True 或 False。默认是 False。指定是否应该包含指定位置的文件夹。与 allow_files其中之一必须为 True。

这些参数可以一起联合使用。

    FilePathField(path="/home/images", match="foo.*", recursive=True)

将匹配 `/home/images/foo.png` 而不是 `/home/images/foo/bar.png` 因为匹配应用于基本文件名 (foo.png and bar.png)。

在数据库中将FilePathField实例创建为varchar列，默认最大长度为100个字符。与其他字段一样，可以使用max_length参数更改最大长度。

### FloatField

`class FloatField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#FloatField)

一个浮点数，在 Python 中代表 float 实例。

默认表单控件是 NumberInput， 当 localize 是 True 时是 TextInput。


### ImageField

`class ImageField(upload_to=None, height_field=None, width_field=None, max_length=100, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/files/#ImageField)

从FileField继承所有属性和方法，除此之外验证上传的对象是一个有效的图像。

除了用于FileField的特殊属性之外，ImageField还具有高度(height)和宽度(width)属性。

为了便于查询这些属性，ImageField有两个额外的可选参数:

#### ImageField.height_field

模型字段的名称，该字段将在每次保存模型实例时自动填充图像的高度。

#### ImageField.width_field

模型字段的名称，该字段将在每次保存模型实例时自动填充图像的宽度。

需要 Pillow 库。

ImageField实例在数据库中创建为varchar列，默认的最大长度为100个字符。与其他字段一样，可以使用max_length参数更改最大长度。

这个字段的默认表单控件是一个ClearableFileInput。

### IntegerField

`class IntegerField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#IntegerField)

一个整数。在Django支持的所有数据库中，从- 2147483648到2147483647的值都是安全的。这个字段的默认表单空间是NumberInput， 当localize为 True 时 是TextInput时。

### GenericIPAddressField

`class GenericIPAddressField(protocol='both', unpack_ipv4=False, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#GenericIPAddressField)

一个IPv4或IPv6地址，字符串格式(如`192.0.2.30`或`2a02:42fe::4`)。这个字段的默认控件是一个TextInput。

IPv6地址的标准化遵循 [ RFC 4291#section-2.2](https://tools.ietf.org/html/rfc4291.html#section-2.2) 第 2.2 节, 包括使用该节第3段中建议的 IPv4 格式，如 ::ffff:192.0.2.0。例如，  2001:0:0:01将被归一化到2001::1，然后::ffff:0a0a:0a0a 转化为 ::ffff:10.10.10.10。 所有字符都转化为小写。

#### GenericIPAddressField.protocol

将有效输入限制为指定的协议。被接受的值是' both '(默认)、' IPv4 '或' IPv6 '。匹配不区分大小写。

#### GenericIPAddressField.unpack_ipv4

Unpacks  IPv4映射地址如:ffff:192.0.2.1。如果启用此选项，那么地址将被 Unpacks 到192.0.2.1。默认是禁用的。只能在协议设置为“both”时使用。

如果允许空白值，则必须允许null值，因为空值被存储为null。

### NullBooleanField

`class NullBooleanField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#NullBooleanField)

类似 BooleanField，但允许NULL作为选项之一。使用这个代替BooleanField, 这时 null = True。这个字段的默认表单小部件是一个NullBooleanSelect。

### PositiveIntegerField

`class PositiveIntegerField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#PositiveIntegerField)

类似 IntegerField ，但必须是正的或零(0)。从0到2147483647的值在Django支持的所有数据库中是安全的。

### PositiveSmallIntegerField

`class PositiveSmallIntegerField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#PositiveSmallIntegerField)

类似 PositiveIntegerField，但只允许在特定(数据库依赖)点下的值。在Django支持的所有数据库中，从0到32767的值都是安全的。

### SlugField

`class SlugField(max_length=50, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#SlugField)

[Slug](https://docs.djangoproject.com/en/2.0/glossary/#term-slug) 是一个报纸术语。slug 是某些东西的短标签，只包含字母、数字、下划线或连字符。它们通常用于url。

类似 CharField，可以指定max_length(在该节中也可以看到关于数据库可移植性和max_length的说明)。如果max_length未指定，Django将使用默认长度为50。

这个字段意味着设置 Field.db_index 为 True。

经常会根据其他的值自动填充这个 SlugField 字段。可以在管理中使用 prepopulated_fields 字段自动完成此操作。

#### SlugField.allow_unicode

如果是True，则除了ASCII字符外，该字段还接受Unicode字母。默认值为False。

### SmallIntegerField

`class SmallIntegerField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#SmallIntegerField)

类似 IntegerField 一样，但只允许在特定(数据库依赖)点下的值。在Django支持的所有数据库中，从- 32768到32767的值都是安全的。

### TextField

`class TextField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#TextField)

一个大的文本字段。这个字段的默认表单小部件是一个Textarea。

如果指定了max_length属性，它将反映在从该字段自动生成的表单空间俺 Textarea 控件中。但是，它不是在模型或数据库级别执行的。使用一个CharField for that。

### TimeField

`class TimeField(auto_now=False, auto_now_add=False, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#TimeField)

时间，用 Python 表示是 datetime.time 实例。接受与 DateField 相同的自动填充选项。

这个字段默认表单控件是 TextInput。管理员会添加一些 JavaScript 快捷方法。


### URLField

`class URLField(max_length=200, **options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#URLField)

一个 CharField。

默认的表单控件是 TextInput。

与所有CharField子类一样，URLField使用了可选的max_length参数。如果没有指定max_length，则使用默认的200。

### UUIDField

`class UUIDField(**options)` [源码](https://docs.djangoproject.com/en/2.0/_modules/django/db/models/fields/#UUIDField)

用于存储通用唯一标识符的字段。使用Python的UUID类。当在PostgreSQL上使用时，存储在uuid数据类型中，否则在char(32)中。

通用唯一标识符是primary_key的AutoField的一个很好的替代方法。数据库不会生成UUID，因此建议使用默认值:

        import uuidfrom django.db import models

        class MyUUIDModel(models.Model):
                id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
                # other fields


