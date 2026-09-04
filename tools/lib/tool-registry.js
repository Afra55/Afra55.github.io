(() => {
  "use strict";
  /** 由 registry/tools.json 生成，勿手改。运行: node tools/scripts/build-tool-registry.cjs */
  window.DEVTOOLS_REGISTRY = {
  "version": 1,
  "groups": [
    {
      "id": "time",
      "label": "时间",
      "tools": [
        "timestamp",
        "timediff",
        "cron",
        "countdown",
        "dateremind"
      ]
    },
    {
      "id": "color",
      "label": "颜色",
      "tools": [
        "ahex",
        "color",
        "eyedropper"
      ]
    },
    {
      "id": "encode",
      "label": "编码与生成",
      "tools": [
        "base64",
        "url",
        "hash",
        "xorenc",
        "morse",
        "password",
        "uuid"
      ]
    },
    {
      "id": "data",
      "label": "数据格式",
      "tools": [
        "json",
        "yaml",
        "query"
      ]
    },
    {
      "id": "text",
      "label": "文本工具",
      "tools": [
        "text",
        "caseconv",
        "regex",
        "diff",
        "markdown",
        "mathedit",
        "mdslides",
        "memo"
      ]
    },
    {
      "id": "gif",
      "label": "GIF",
      "tools": [
        "gifmaker",
        "v2g",
        "gifc",
        "gife",
        "gifm",
        "gifx"
      ]
    },
    {
      "id": "video",
      "label": "视频",
      "tools": [
        "vsplit",
        "vtrim",
        "vidkit",
        "audio",
        "vplay"
      ]
    },
    {
      "id": "blackbox",
      "label": "黑盒",
      "tools": [
        "vbb",
        "gifbb"
      ]
    },
    {
      "id": "image",
      "label": "图片",
      "tools": [
        "imgpreview",
        "whiteboard",
        "imgkit",
        "imgtrim",
        "textimg",
        "imgtext",
        "sharecard",
        "phlogo",
        "nokiasms",
        "imgb64",
        "qrcode"
      ]
    },
    {
      "id": "convert",
      "label": "换算",
      "tools": [
        "units",
        "coord",
        "numbase"
      ]
    },
    {
      "id": "fun",
      "label": "趣味",
      "tools": [
        "wheel",
        "ruler",
        "muyu",
        "piano",
        "minigames",
        "sandspiel",
        "ambient"
      ]
    },
    {
      "id": "health",
      "label": "健康",
      "tools": [
        "acupoint",
        "healthread"
      ]
    },
    {
      "id": "device",
      "label": "设备",
      "tools": [
        "lanshare",
        "adb",
        "everything",
        "ffbridge",
        "ytdlp",
        "gitbridge"
      ]
    },
    {
      "id": "site",
      "label": "站点",
      "tools": [
        "about",
        "sitenav",
        "setup",
        "envkit"
      ]
    }
  ],
  "meta": {
    "timestamp": {
      "name": "时间戳",
      "aliases": [
        "时间",
        "timestamp",
        "date"
      ]
    },
    "timediff": {
      "name": "时间差",
      "aliases": [
        "时差",
        "diff time"
      ]
    },
    "cron": {
      "name": "Cron",
      "aliases": [
        "定时",
        "crontab"
      ]
    },
    "countdown": {
      "name": "倒计时",
      "aliases": [
        "timer",
        "countdown",
        "计时",
        "闹钟",
        "清单倒计时"
      ]
    },
    "dateremind": {
      "name": "日期提醒",
      "aliases": [
        "remind",
        "calendar",
        "生日",
        "农历",
        "节日",
        "提醒",
        "闹铃"
      ]
    },
    "ahex": {
      "name": "AHEX",
      "aliases": [
        "颜色",
        "alpha"
      ]
    },
    "color": {
      "name": "颜色互转",
      "aliases": [
        "rgb",
        "hex",
        "hsl"
      ]
    },
    "eyedropper": {
      "name": "屏幕取色",
      "aliases": [
        "取色",
        "eyedropper"
      ]
    },
    "password": {
      "name": "密码生成",
      "aliases": [
        "password",
        "随机密码"
      ]
    },
    "base64": {
      "name": "Base64",
      "aliases": [
        "编码",
        "b64"
      ]
    },
    "imgb64": {
      "name": "图片 Base64",
      "aliases": [
        "图片编码"
      ]
    },
    "url": {
      "name": "URL",
      "aliases": [
        "encode",
        "decode"
      ]
    },
    "hash": {
      "name": "Hash",
      "aliases": [
        "md5",
        "sha"
      ]
    },
    "xorenc": {
      "name": "XOR 加解密",
      "aliases": [
        "xor",
        "异或",
        "xorenc",
        "半段加密",
        "jiami"
      ]
    },
    "morse": {
      "name": "摩斯密码",
      "aliases": [
        "摩尔斯",
        "morse",
        "morse code",
        "电码",
        "摩斯"
      ]
    },
    "uuid": {
      "name": "UUID",
      "aliases": [
        "guid"
      ]
    },
    "json": {
      "name": "JSON",
      "aliases": [
        "格式化",
        "压缩"
      ]
    },
    "yaml": {
      "name": "YAML",
      "aliases": [
        "yml"
      ]
    },
    "sharecard": {
      "name": "代码卡片",
      "aliases": [
        "分享",
        "卡片"
      ]
    },
    "phlogo": {
      "name": "P站风 Logo",
      "aliases": [
        "ph",
        "logo",
        "logoly",
        "pornhub",
        "p站",
        "双色logo",
        "黄黑"
      ]
    },
    "nokiasms": {
      "name": "诺基亚短信",
      "aliases": [
        "nokia",
        "zzkia",
        "3310",
        "短信",
        "诺基亚",
        "怀旧"
      ]
    },
    "query": {
      "name": "Query / JWT",
      "aliases": [
        "jwt",
        "token",
        "query"
      ]
    },
    "text": {
      "name": "文本",
      "aliases": [
        "统计",
        "去重"
      ]
    },
    "caseconv": {
      "name": "命名转换",
      "aliases": [
        "驼峰",
        "snake",
        "case"
      ]
    },
    "regex": {
      "name": "正则",
      "aliases": [
        "regexp",
        "正则表达式"
      ]
    },
    "diff": {
      "name": "文本比对",
      "aliases": [
        "对比",
        "差异",
        "diff",
        "compare",
        "比对"
      ]
    },
    "qrcode": {
      "name": "二维码",
      "aliases": [
        "qr",
        "扫码"
      ]
    },
    "gifmaker": {
      "name": "多图合成 GIF",
      "aliases": [
        "gif",
        "动图",
        "合成",
        "拼图"
      ]
    },
    "v2g": {
      "name": "视频转 GIF",
      "aliases": [
        "视频",
        "webp",
        "ffmpeg",
        "转gif"
      ]
    },
    "gifx": {
      "name": "GIF 拆帧",
      "aliases": [
        "拆帧",
        "转webm",
        "逐帧"
      ]
    },
    "gifc": {
      "name": "GIF 压缩",
      "aliases": [
        "压缩gif",
        "缩小体积"
      ]
    },
    "gife": {
      "name": "GIF 编辑",
      "aliases": [
        "裁剪",
        "去黑边",
        "删帧"
      ]
    },
    "gifm": {
      "name": "GIF 合并",
      "aliases": [
        "拼接",
        "合并gif"
      ]
    },
    "vsplit": {
      "name": "视频切分",
      "aliases": [
        "切分",
        "vsplit",
        "视频"
      ]
    },
    "vbb": {
      "name": "黑盒 GIF",
      "aliases": [
        "黑盒",
        "vbb",
        "批量切分",
        "blackbox",
        "6mb",
        "视频转gif"
      ]
    },
    "gifbb": {
      "name": "GIF 压黑盒",
      "aliases": [
        "已有gif",
        "gif压缩",
        "压黑盒",
        "gifbb",
        "6mb gif"
      ]
    },
    "vtrim": {
      "name": "视频修剪",
      "aliases": [
        "修剪",
        "裁剪",
        "vtrim"
      ]
    },
    "vidkit": {
      "name": "视频工具",
      "aliases": [
        "视频转换",
        "视频压缩",
        "转码",
        "vidkit",
        "保画质"
      ]
    },
    "vplay": {
      "name": "视频播放",
      "aliases": [
        "播放",
        "预览",
        "vplay",
        "player"
      ]
    },
    "audio": {
      "name": "音频处理",
      "aliases": [
        "音频",
        "音量",
        "抽音轨",
        "audio"
      ]
    },
    "imgpreview": {
      "name": "图片预览",
      "aliases": [
        "多图",
        "叠图",
        "对比",
        "preview",
        "图层",
        "imgpreview"
      ]
    },
    "whiteboard": {
      "name": "画板",
      "aliases": [
        "白板",
        "涂鸦",
        "手绘",
        "excalidraw",
        "whiteboard",
        "sketch"
      ]
    },
    "imgkit": {
      "name": "图片工具",
      "aliases": [
        "裁剪",
        "压缩",
        "水印",
        "拼接",
        "mozjpeg",
        "avif",
        "oxipng",
        "高质量",
        "批量压缩"
      ]
    },
    "imgtrim": {
      "name": "去色边",
      "aliases": [
        "裁边",
        "去白边",
        "去黑边",
        "trim",
        "纯色边",
        "imgtrim"
      ]
    },
    "textimg": {
      "name": "文字转图片",
      "aliases": [
        "文转图",
        "海报",
        "卡片",
        "carbon",
        "text to image"
      ]
    },
    "imgtext": {
      "name": "图片转文字",
      "aliases": [
        "ocr",
        "识字",
        "图转文",
        "tesseract"
      ]
    },
    "units": {
      "name": "单位换算",
      "aliases": [
        "长度",
        "质量"
      ]
    },
    "coord": {
      "name": "坐标系互转",
      "aliases": [
        "gps",
        "坐标",
        "gcj",
        "wgs"
      ]
    },
    "acupoint": {
      "name": "穴位图",
      "aliases": [
        "穴位",
        "经络",
        "针灸",
        "acupoint",
        "361",
        "奇穴"
      ]
    },
    "healthread": {
      "name": "健康阅读",
      "aliases": [
        "养生",
        "功法",
        "金刚功",
        "长寿功",
        "张至顺",
        "健康文章",
        "阅读"
      ]
    },
    "numbase": {
      "name": "进制转换",
      "aliases": [
        "二进制",
        "十六进制"
      ]
    },
    "wheel": {
      "name": "大转盘",
      "aliases": [
        "转盘",
        "抽奖",
        "wheel",
        "随机",
        "lottery"
      ]
    },
    "markdown": {
      "name": "Markdown",
      "aliases": [
        "md",
        "预览"
      ]
    },
    "memo": {
      "name": "备忘录",
      "aliases": [
        "笔记",
        "剪贴板",
        "memo",
        "note",
        "便签"
      ]
    },
    "ruler": {
      "name": "直尺",
      "aliases": [
        "标尺",
        "刻度",
        "ruler",
        "测量",
        "全屏"
      ]
    },
    "muyu": {
      "name": "木鱼",
      "aliases": [
        "敲木鱼",
        "电子木鱼",
        "功德",
        "muyu",
        "woodfish",
        "冥想"
      ]
    },
    "piano": {
      "name": "在线钢琴",
      "aliases": [
        "钢琴",
        "piano",
        "键盘",
        "弹奏",
        "midi",
        "琴键",
        "电子琴",
        "soundfont"
      ]
    },
    "minigames": {
      "name": "摸鱼 & 解压",
      "aliases": [
        "摸鱼",
        "解压",
        "小游戏",
        "2048",
        "贪吃蛇",
        "flappy",
        "打地鼠",
        "泡泡纸",
        "pop-it",
        "popit",
        "升空气泡",
        "键盘音",
        "minigames",
        "game"
      ]
    },
    "sandspiel": {
      "name": "落沙沙盒",
      "aliases": [
        "sandspiel",
        "落沙",
        "粉末",
        "沙子",
        "powder",
        "sandbox",
        "沙盘",
        "元胞"
      ]
    },
    "ambient": {
      "name": "环境音库",
      "aliases": [
        "环境音",
        "白噪音",
        "ambient",
        "moodist",
        "雨声",
        "自然",
        "专注",
        "放松",
        "soundscape"
      ]
    },
    "adb": {
      "name": "ADB 工具",
      "aliases": [
        "安卓",
        "android",
        "设备",
        "adb"
      ],
      "desktopOnly": true
    },
    "everything": {
      "name": "Everything 搜索",
      "aliases": [
        "everything",
        "voidtools",
        "文件搜索",
        "全盘搜索",
        "找文件"
      ],
      "desktopOnly": true
    },
    "lanshare": {
      "name": "局域网互传",
      "aliases": [
        "互传",
        "传文件",
        "lan",
        "share",
        "webrtc",
        "局域网"
      ]
    },
    "ffbridge": {
      "name": "FFmpeg 本机桥",
      "aliases": [
        "本机桥",
        "ffbridge",
        "批量转码"
      ],
      "desktopOnly": true
    },
    "ytdlp": {
      "name": "yt-dlp",
      "aliases": [
        "ytdlp",
        "youtube-dl",
        "下载视频",
        "b站",
        "youtube",
        "解析"
      ],
      "desktopOnly": true
    },
    "gitbridge": {
      "name": "Git 可视化",
      "aliases": [
        "git",
        "gitbridge",
        "分支",
        "merge",
        "提交图",
        "版本控制"
      ],
      "desktopOnly": true
    },
    "about": {
      "name": "实用小工具合集",
      "aliases": [
        "about",
        "介绍",
        "目录",
        "主题",
        "帮助",
        "总览",
        "关于"
      ]
    },
    "setup": {
      "name": "安装本机工具",
      "aliases": [
        "帮助",
        "安装",
        "nodejs",
        "node",
        "adb",
        "ffmpeg",
        "配置",
        "小白",
        "setup",
        "教程"
      ]
    },
    "envkit": {
      "name": "环境管家",
      "aliases": [
        "envkit",
        "一键安装",
        "升级",
        "环境",
        "bootstrap",
        "依赖"
      ],
      "desktopOnly": true
    },
    "mathedit": {
      "name": "公式编辑",
      "aliases": [
        "math",
        "latex",
        "公式",
        "数学公式",
        "mathlive",
        "tex"
      ]
    },
    "mdslides": {
      "name": "MD 幻灯片",
      "aliases": [
        "ppt",
        "slides",
        "reveal",
        "slidev",
        "演示",
        "幻灯片",
        "markdown ppt"
      ]
    },
    "sitenav": {
      "name": "外链导航",
      "aliases": [
        "导航",
        "nav",
        "外链",
        "收藏夹",
        "站点导航",
        "卡片"
      ]
    }
  },
  "about": {
    "timestamp": "秒/毫秒时间戳与日期互转，支持本地时区与 UTC。",
    "timediff": "计算两个时间点的差值，支持时间戳或日期字符串。",
    "cron": "解析 Cron 表达式并预览接下来的触发时间。",
    "countdown": "多步骤倒计时清单：内容即时保存，可收藏整份列表；到点全屏提醒并可响铃震动。",
    "dateremind": "生日、节日与重要日期提醒：阳历/农历、每年或一次；打开本站时全屏提醒，支持 JSON/ICS 导入导出。",
    "ahex": "Android AARRGGBB 颜色与通道滑块互转。",
    "color": "HEX / RGB / HSL 颜色格式互转与预览。",
    "eyedropper": "屏幕取色（需浏览器 EyeDropper 支持）。",
    "password": "可配置字符集与长度的本地随机密码。",
    "base64": "文本 Base64 编码与解码。",
    "imgb64": "图片与 Base64 Data URL 互转。",
    "url": "URL 编码 / 解码。",
    "hash": "本地计算 MD5、SHA-256。",
    "xorenc": "半段 XOR 加解密：文本与文件，可自定义两个密钥（默认 4/7）。",
    "morse": "摩尔斯电码与文本互转；底部含从零读懂 ·/- 电码的新手教程。",
    "uuid": "生成 UUID / GUID。",
    "json": "JSON 校验、修复、美化与压缩。",
    "yaml": "YAML 与 JSON 互转、校验。",
    "sharecard": "代码/JSON 生成分享卡片图。",
    "phlogo": "P 站风双色 Logo：两段文字 + 圆角色块，可改颜色/字号，导出 PNG 或 SVG。参考 bestony/logoly。",
    "nokiasms": "诺基亚 3310 短信截图生成器：本地 Canvas 绘制，可改运营商/时间/倾斜机身。灵感来自 dcalsky/zzkia。",
    "query": "Query 字符串与 JWT 解析查看。",
    "text": "文本统计、去重、大小写等处理。",
    "caseconv": "驼峰 / snake / kebab 等命名风格转换。",
    "regex": "正则匹配测试、捕获分组；默认可点选的 Regex Vis 可视化编辑，另附本地 Regulex 只读铁路图。",
    "diff": "两段文本并排/合并比对，高亮增删改；可忽略空白、隐藏相同行。",
    "qrcode": "生成与识别二维码。",
    "markdown": "Markdown 预览。",
    "memo": "本地备忘录：按日分组、#标签识别、置顶/归档、搜索高亮、MD 预览、链接卡片、导入导出（ZIP/JSON/Markdown），组内拖拽排序（含大列表）并可拖入临时区。",
    "gifmaker": "多张静态图合成 GIF，可调帧时长、宽度、质量与水印。",
    "v2g": "本地把视频转为 GIF 或动画 WebP，可调帧率、宽度与亮度（≤6MB 黑盒见「黑盒」分类）。",
    "gifx": "GIF 拆成逐帧图片打包下载，或导出为 WebM 视频。",
    "gifc": "上传已有 GIF 按档位压缩体积，可继续压一轮。",
    "gife": "裁剪画面、去黑边、去掉首尾帧，导出为新 GIF。",
    "gifm": "按顺序拼接多条 GIF 为一条长动图（各段宽高需一致）。",
    "vsplit": "预览打点切分视频片段，支持全屏标记与打包下载（黑盒 GIF 见「黑盒」分类）。",
    "vbb": "预制参数一键出 ≤6MB 黑盒 GIF：整段或长视频自动切片，全程本地处理。",
    "gifbb": "多选已有 GIF，按黑盒规则压至 ≤6MB；已符合体积要求的会跳过。",
    "vtrim": "调整片头片尾时长、裁边框；网页 FFmpeg，手机可用。",
    "vidkit": "视频格式转换与高观感压缩；有本机桥走系统 FFmpeg（极致保画质 / H.265），无桥用网页 FFmpeg 保底。",
    "vplay": "本地视频预览：滚轮缩放、拖拽移动、双击暂停/播放，双指捏合缩放。",
    "audio": "修剪、音量、抽音轨；网页 FFmpeg 保底，电脑批量请用本机桥。",
    "imgpreview": "多图叠放预览：拖拽定位、滚轮无极缩放、透明度与层级、边缘吸附对齐；底部缩略图快速选中。",
    "whiteboard": "本地手绘白板（Excalidraw）：无限画布，自动存浏览器，可导出 PNG / SVG / .excalidraw。",
    "imgkit": "图片压缩（mozjpeg/AVIF/oxipng 高质量档）、裁剪、水印、拼接。",
    "imgtrim": "裁掉图片四周纯色边框（白/黑/其它单色），从各边向内直到出现其它颜色；支持多选。",
    "textimg": "文字/Markdown/代码生成分享图。",
    "imgtext": "本地 OCR 图片转文字（Tesseract）。",
    "units": "长度、质量等常用单位换算。",
    "coord": "WGS84 / GCJ-02 / BD-09 等坐标系互转。",
    "numbase": "二、八、十、十六进制互转。",
    "wheel": "大转盘：自定义分块、比例与文字，按权重随机停针；可开关旋转音效与结果语音播报。",
    "ruler": "屏幕直尺：四边刻度、十字准线，可全屏；厘米/毫米按本机 PPI 自动估算，可手动微调。",
    "muyu": "敲木鱼：jwenjian/wooden-fish 造型与音效；次数本机永久累加，可全屏，空格键敲击。",
    "piano": "在线钢琴：88 键 A0–C8；黑键按真实钢琴几何排布。鼠标/触摸/电脑键盘（Z/Q/I 三行约 2.5 个八度）。默认 Web Audio 合成，可选三角钢琴采样。",
    "minigames": "摸鱼 & 解压：2048、贪吃蛇、Flappy、打地鼠、泡泡纸、Pop-it、升空气泡、键盘敲击音；纯本地 Canvas。",
    "sandspiel": "落沙沙盒：沙子/水/火/植物等元胞自动机，本地 WASM+WebGL。移植自 MaxBittker/sandspiel 并中文化，无登录无广告。",
    "ambient": "环境音库：89 条单轨环境音，分类浏览、搜索、收藏与下载；封面为 Openverse 实景图，音效参考 remvze/moodist。",
    "acupoint": "361 经穴 + 51 奇穴：Wellcome 经络参考图可点击放大，搜索列表查看定位与主治。",
    "healthread": "养生功法等文章离线阅读：列表搜索、按需加载动图，记住阅读进度。",
    "adb": "网页侧 ADB：设备、文件、应用、性能/进程/Shell/布局、Logcat、输入与任务等。",
    "everything": "Everything 经本机桥代理（/everything/*）：HTTPS 站点可搜全盘、实时过滤、下载；需同时启动桥与 Everything HTTP。",
    "lanshare": "局域网互传：多机同房间共享文件列表，下载时从上传者手机 WebRTC 直传，不经房主中转；房主可退出或解散，退出时最近加入者接任。",
    "ffbridge": "电脑批量用本机 FFmpeg 桥；手机请直接用视频/GIF 分类里的音频/修剪/动图（网页内处理）。",
    "ytdlp": "本机 yt-dlp 桥：解析/下载视频与播放列表、字幕、封面、直播、Cookies 与 SponsorBlock；含安装教程，文件只保存在电脑。",
    "gitbridge": "分支工作台（切换/合并/删除/ahead·behind）+ 面板内确认 + 大按钮三步；彩色图/diff/冲突；统一桥 /git。",
    "about": "站点总览与能力目录；可分享/复制链接给他人，并进入主题设置。",
    "setup": "小白向：如何下载安装 Node.js、ADB、FFmpeg；手机用网页保底、电脑用桥更优。",
    "envkit": "一键安装或缺省跳过；一键升级会更新 Node/Git/FFmpeg/ADB/yt-dlp 与全部桥文件。",
    "mathedit": "MathLive 在线数学公式编辑：可视化输入，导出 LaTeX / MathML / AsciiMath。",
    "mdslides": "把 Markdown 做成网页幻灯片（Reveal.js）；用 --- 分页，一键全屏演示。",
    "sitenav": "外链导航：PDFCraft、图吧工具箱、昆虫世界、史前博物馆、Slidev 等站外服务；本站已有工具不重复列出。"
  }
};
})();
