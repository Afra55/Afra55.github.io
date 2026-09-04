# DevTools ADB Bridge（P0）

本地 ADB 桥接服务。网页无法直接调用 `adb`，需要先在本机启动本服务。

## 前置条件

- 已安装 [Node.js](https://nodejs.org/)
- 已安装 Android `platform-tools`，终端可执行 `adb devices`
- 手机已开启 USB 调试并授权

## 启动

任选其一：

```bash
# 推荐：从网页下载「完整 ZIP 包」解压后运行（ZIP 内含 server.js）
# macOS
chmod +x start-adb-bridge.command && ./start-adb-bridge.command

# Windows：双击 start-adb-bridge.bat

# Linux
chmod +x start-adb-bridge.sh && ./start-adb-bridge.sh

# 或在本仓库目录直接
node server.js
```

启动脚本会优先使用**同目录**的 `server.js`；若缺失则尝试从 GitHub Pages / raw 下载。若仍失败，请重新下载完整 ZIP。

双击后窗口一闪而过时：
- 查看启动脚本**同目录**下的 `last-start.log`（Windows / macOS / Linux 均不再写入用户主目录缓存）
- Windows 请重新下载「完整 ZIP」；启动脚本为 ASCII+CRLF，避免中文编码导致秒退
- macOS 可先执行 `chmod +x start-adb-bridge.command`，或用 `bash start-adb-bridge.command`
- 确认已安装 Node.js 与 adb，且在终端中可运行 `node -v` / `adb devices`
默认地址：`http://127.0.0.1:17888`  
默认 Token：`devtools-adb`（可用环境变量 `ADB_BRIDGE_TOKEN` 覆盖）
若端口被占用，桥会自动尝试下一个端口并在窗口提示。
## 网页使用

1. 打开 Tools →「ADB 工具」
2. 下载对应系统的完整 ZIP，解压后运行启动脚本（勿只保留脚本、删掉 server.js）
3. 回到网页点击「连接本机桥」
## 接口（统一本机桥 0.8.0 · ADB + 镜像 + FFmpeg）

默认 Token：`devtools-bridge`（兼容 `devtools-adb` / `devtools-ffmpeg`）  
FFmpeg 接口前缀：`/ff/*`（例如 `GET /ff/ops`、`POST /ff/jobs/run`）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（可不带 token；含本机 adb/keytool/apksigner 探测与配置提示） |
| GET | `/devices` | 设备列表 |
| GET | `/device/info?serial=` | 设备信息 |
| GET | `/fs/list?serial=&path=` | 列目录（默认 `/`；无权限时 su / run-as；`/data/data` 可虚拟列包名；含 `writable`） |
| GET | `/fs/roots?serial=` | 探测常用根目录是否可读 |
| GET | `/local/roots` | 本机可浏览根目录（Home / Temp；Windows 含盘符） |
| GET | `/local/list?path=` | 列本机目录（仅允许 `/local/roots` 下路径） |
| POST | `/local/push` | 本机路径 `adb push` 到设备目录 `{ serial, paths[], remoteDir }` |
| POST | `/local/pull` | 设备路径 `adb pull` 到本机目录 `{ serial, remotePath, localDir, name? }` |
| GET/POST | `/fs/zip` | 服务端拉取远程目录/文件并打包 zip 下载 |
| POST | `/fs/mkdir` `/fs/delete` `/fs/rename` `/fs/move` `/fs/copy` | 文件操作（默认可写：sdcard / tmp） |
| POST | `/fs/upload?serial=&path=&name=&forcePush=` | 上传到设备；`forcePush=1` 才可写系统 APK 路径 |
| GET | `/fs/download?serial=&path=` | 从设备下载（pull 失败时尝试 run-as / su） |
| POST | `/upload?name=` | 上传 APK 到桥临时区 |
| POST | `/install` | 批量/单设备安装（任务；`allowDowngrade` → `adb install -d`） |
| POST | `/install/push-system` | 系统/临时区 APK 推送覆盖 `{ serial, uploadId, packageName?, remoteDir? }` |
| GET | `/apps?serial=&kind=` | 应用列表 `all/system/third` |
| GET | `/apps/info?serial=&package=` | 已安装应用详情 |
| POST | `/apps/action` | 打开 / 强停 / 清数据 / 卸载 / 停用 / 启用 |
| POST | `/apps/permission` | 授予 / 撤销权限 |
| POST | `/apk/info` | 分析已上传 APK（aapt/aapt2 解析包信息；keytool/openssl/apksigner 解析签名：别名/CN/SHA1/SHA256 等） |
| POST | `/apps/backup` | 备份 APK（可 `async` 任务） |
| GET/POST | `/network/proxy` | HTTP 代理查询/设置/清除 |
| GET/POST | `/network/forward` | forward/reverse 端口转发 |
| GET/POST | `/developer` | 开发者选项（含 stay_on / show_touches / force_rtl 等） |
| POST | `/media/screenshot` | 多设备截图任务 |
| GET | `/media/screencap?serial=` | 同步 PNG 截图（`image/png`） |
| POST | `/media/record` | 录屏任务；`seconds: 0` 无时限，需 `/jobs/:id/cancel` |
| GET | `/logcat?serial=&lines=&package=&query=&tag=&since=` | 拉取 logcat（无流式接口，请轮询） |
| POST | `/logcat/clear` | 清空 logcat 缓冲 |
| POST | `/input` | 点击 / 长按 / 双击 / 滑动 / 按键 / 文本 |
| POST | `/clipboard` | 推送剪贴板（机型相关） |
| GET | `/device/snapshot?serial=` | 状态快照 |
| GET | `/device/perf?serial=` | CPU / 内存 / FPS 采样（≥0.9.0） |
| GET | `/device/processes?serial=` | 进程列表（≥0.9.0） |
| POST | `/device/process/kill` | 结束进程 / force-stop（≥0.9.0） |
| GET | `/device/layout?serial=` | uiautomator 布局 dump（≥0.9.0） |
| POST | `/shell/exec` | 单次 shell 命令（≥0.9.0） |
| WS | `/shell/ws?serial=&token=` | 交互式 shell（≥0.9.0，需 `device-inspect.js`） |
| POST | `/device/control` | 常亮 / 开发者选项 / USB 安装等 |
| GET | `/mirror/status?serial=` | scrcpy-server 镜像状态（jar / 会话） |
| POST | `/mirror/prepare` | 确保本机已缓存 scrcpy-server（可首次联网下载） |
| POST | `/mirror/stop` | 停止某设备镜像 `{ serial }` |
| WS | `/mirror/ws?serial=&token=&quality=&audio=&show_touches=` | H.264 镜像 + 全 control（触控/键/滚轮/剪贴板/熄屏）+ 可选 Opus 音频；≥0.9.15 |
| GET | `/jobs` `/jobs/:id` `/jobs/:id/artifact/:name` | 任务与产物下载 |
| POST | `/jobs/:id/cancel` | 取消任务（录屏：SIGINT screenrecord 并尝试拉取片段） |

除 `/health` 外均需请求头：`X-Adb-Token: devtools-adb`  

**路径策略：** 类似 Android Studio Device File Explorer / [Adbrowser](https://github.com/BetterAndroid/Adbrowser)——默认从 `/` 浏览；无权限时回退 `su` / `run-as`；`/data/data` 无 root 时按已安装包名虚拟列出。写入同样透传 `adb`；系统 APK 覆盖请用 `/install/push-system`。
