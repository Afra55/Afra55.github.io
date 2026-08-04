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

默认地址：`http://127.0.0.1:17888`  
默认 Token：`devtools-adb`（可用环境变量 `ADB_BRIDGE_TOKEN` 覆盖）

## 网页使用

1. 打开 Tools →「ADB 工具」
2. 下载对应系统的完整 ZIP，解压后运行启动脚本（勿只保留脚本、删掉 server.js）
3. 回到网页点击「连接本机桥」
## 接口（P0–P3）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/health` | 健康检查（可不带 token） |
| GET | `/devices` | 设备列表 |
| GET | `/device/info?serial=` | 设备信息 |
| GET | `/fs/list?serial=&path=` | 列目录 |
| POST | `/fs/mkdir` `/fs/delete` `/fs/rename` `/fs/move` `/fs/copy` | 文件操作 |
| POST | `/fs/upload?serial=&path=&name=` | 上传到设备 |
| GET | `/fs/download?serial=&path=` | 从设备下载 |
| POST | `/upload?name=` | 上传 APK 到桥临时区 |
| POST | `/install` | 批量/单设备安装（任务） |
| GET | `/apps?serial=&kind=` | 应用列表 `all/system/third` |
| GET | `/apps/info?serial=&package=` | 已安装应用详情 |
| POST | `/apps/action` | 打开 / 强停 / 清数据 / 卸载 / 停用 / 启用 |
| POST | `/apps/permission` | 授予 / 撤销权限 |
| POST | `/apk/info` | 分析已上传 APK（需本机 aapt/aapt2） |
| POST | `/apps/backup` | 备份 APK（可 `async` 任务） |
| GET/POST | `/network/proxy` | HTTP 代理查询/设置/清除 |
| GET/POST | `/network/forward` | forward/reverse 端口转发 |
| GET/POST | `/developer` | 开发者选项状态与开关 |
| POST | `/media/screenshot` | 多设备截图任务 |
| POST | `/media/record` | 当前设备录屏任务 |
| GET | `/logcat?serial=&lines=&package=&query=` | 拉取 logcat |
| POST | `/logcat/clear` | 清空 logcat 缓冲 |
| POST | `/input` | 点击 / 滑动 / 按键 / 文本 |
| POST | `/clipboard` | 推送剪贴板（机型相关） |
| GET | `/device/snapshot?serial=` | 状态快照 |
| POST | `/device/control` | 常亮 / 开发者选项 / USB 安装等 |
| GET | `/jobs` `/jobs/:id` `/jobs/:id/artifact/:name` | 任务与产物下载 |

除 `/health` 外均需请求头：`X-Adb-Token: devtools-adb`  
文件访问范围仅限 `/sdcard` 与 `/storage/emulated/0`。
