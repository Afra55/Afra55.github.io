---
layout: post
title:  "Cursor iOS 客户端与桌面远程控制指南"
date:   2026-6-29 12:00:00
categories: Efficiency
comments: true
description: 介绍 Cursor for iOS 是什么、能做什么，以及如何通过 Remote Control 用手机控制桌面版 Cursor Agent。
---

* content
{:toc}

## 前言

Cursor 除了桌面端的 AI 代码编辑器，还推出了 iPhone 原生应用。本文记录 Cursor for iOS 的定位、核心能力，以及官方 **Remote Control** 功能的使用方法——让你不在电脑前，也能继续指挥本机上的开发 Agent。

App Store 地址：[Cursor for iOS](https://apps.apple.com/us/app/cursor/id6767085653?l=zh-Hans-CN)

官方文档：[Cursor for iOS](https://cursor.com/docs/cloud-agent/mobile)

---

## Cursor for iOS 是什么？

这是由 Anysphere 开发的 **iPhone 原生移动客户端**，目前处于公开测试阶段。它和桌面上的 **Cursor IDE** 不是同一种产品：

| | **Cursor 桌面版** | **Cursor iOS App** |
|---|---|---|
| 定位 | 完整 AI 代码编辑器（基于 VS Code） | 远程启动、管理、审查 Agent 的移动端控制台 |
| 主要场景 | 在本地写代码、调试、改文件 | 出门在外用手机派活、看进度、审 PR |
| 是否自带完整 IDE | 是 | 否，不提供完整文件系统编辑体验 |

App 免费下载，完整 Agent 能力需要 **付费订阅**（Pro / Pro+ / Ultra 等），与桌面端账号体系打通。

**系统要求**：iPhone，iOS 26.0 及以上；界面目前主要为英文。Android 版本官方称正在计划中。

---

## iOS 客户端能做什么？

核心思路：**不在电脑前，也能让 AI Agent 继续写代码、测代码、提 PR，你在手机上审批和指挥。**

### 随时随地启动 Agent

- 选择仓库，像桌面端一样发起 Cloud Agent
- 实现功能、查 Bug、回答代码库相关问题
- 支持多种前沿模型（OpenAI、Anthropic、Google 等）以及 Cursor 自研的 Composer

### Cloud Agent（云端代理）

- Agent 在独立云虚拟机里运行，带完整开发环境
- 可自动测试、迭代，直到验证通过
- 产出视频、截图、日志等产物，方便远程验收
- 笔记本合上也能继续跑；本地会话可通过「移到云端」继续

### Remote Control（远程控制桌面 Agent）

- 电脑上已开的 Agent，可用手机继续指挥
- Agent 循环在云端，工具仍在你本机执行（读文件、跑测试等）
- 桌面端需 **Cursor 3.9.8+** 才支持

### 移动端审查与合并代码

- 查看 PR、浏览 diff（针对手机优化的阅读体验）
- 理解改动后可直接合并
- 支持在锁屏 / 灵动岛用 Live Activities 跟踪 Agent 进度，完成后推送通知

### 可视化反馈

- 截图后圈选标注，把 UI 问题或设计意见直接传给 Agent
- 缩小「你看到的」和「Agent 理解的」之间的差距

### 语音交互

- 用语音描述需求、讲 Bug、规划功能，不用打字
- 适合走路、通勤时快速记录想法

---

## 与桌面 Cursor 的关系

两者共用同一套 **Agent 后端**（与 [cursor.com/agents](https://cursor.com/agents) 和桌面 Agents 面板同步）：

- 手机上开的 Agent → 桌面 / 网页也能看到
- 桌面开的 Agent → 手机收件箱里也会出现

更准确地说：**桌面 Cursor = 写代码的主战场；iOS App = 移动端的 Agent 指挥台 + 代码审查台。**

---

## 如何控制桌面版 Cursor？

若目标是「人不在电脑前，但继续用我电脑上的环境和代码」，首选官方 **Remote Control** 功能。

### 工作原理

```mermaid
flowchart LR
    Phone[手机 Cursor App] --> Cloud[Cursor 云端 Agent 循环]
    Cloud --> Desktop[你的电脑]
    Desktop -->|读文件 / 跑测试 / 改代码| Local[本地项目]
```

- Agent 的「思考循环」在云端
- **终端、改文件、跑测试** 都在你电脑上
- 仓库、密钥、构建缓存留在本机，不会整盘上传

### 前提条件

1. **桌面 Cursor ≥ 3.9.8**（旧版本没有该功能）
2. **付费账号**：Pro / Pro+ / Ultra / Teams / Enterprise，且包含 Cloud Agents
3. **工作区必须是 Git 仓库**（有 remote；本地目录和 Remote SSH 都支持）
4. **隐私设置**不能关闭云端数据存储
5. **电脑要保持开机、联网、不睡眠**（工具调用在本机跑）
6. **团队版**：管理员需在 Dashboard → Cloud Agents → Self-Hosted 里开启 Remote Control

### 设置步骤

**第一步：在桌面 Cursor 开启**

1. 打开 **Settings → Agents**
2. 打开 **Remote Control**
3. 建议同时打开 **Keep this computer awake**（插电时不休眠，方便外出时继续用）

**第二步：把当前 Agent 会话交出去**

1. 在桌面 Agent 输入框输入 `/remote-control`
2. 发送下一条消息，会话会挂到你本机的 worker 上，并同步到云端

**第三步：在手机上接管**

1. iPhone 安装 [Cursor iOS App](https://apps.apple.com/us/app/cursor/id6767085653)
2. 用同一 Cursor 账号登录
3. 在 App 收件箱里找到该 Agent，点进去继续发指令、看实时进度、审 diff

### 最短路径

桌面升级到 3.9.8+ → Settings → Agents 开 Remote Control → Agent 里输入 `/remote-control` → iPhone 同账号打开 App 收件箱继续指挥。

---

## 其他官方相关方式

| 方式 | 能做什么 | 和「控制桌面」的关系 |
|------|----------|----------------------|
| [cursor.com/agents](https://cursor.com/agents) 网页 | 启动/管理 Cloud Agent、看进度、合 PR | 控制的是云端 Agent，不是本机 IDE |
| 手机直接开 Cloud Agent | 选仓库派活，云端虚拟机里写代码 | 不依赖桌面开着，但跑在云上 |
| My Machines | 把手机任务指定到你注册的 Mac 上跑 | 类似 Remote Control，需先注册本机 |
| Move to Cloud | 把本地会话迁到云端继续 | 之后主要在云端/手机管，不再依赖本机工具 |

---

## 常见问题

**能远程操作整个 Cursor 编辑器界面吗？**

不能。官方移动端是 Agent 控制台，不是完整 IDE，不能像在电脑上那样随便点文件树、开终端面板。

**电脑合盖 / 休眠了还能用吗？**

不能。Remote Control 要求电脑在线且可执行工具调用。

**Android 可以吗？**

官方 Remote Control 目前主要通过 iOS App；也可用网页 [cursor.com/agents](https://cursor.com/agents) 管理 Agent。Android 原生 App 官方说在计划中。

**没有 iPhone 怎么办？**

- 用浏览器打开 [cursor.com/agents](https://cursor.com/agents) 管理会话（需先 `/remote-control` 交出去）
- 或用手机开 Cloud Agent（跑在云端，不依赖桌面）

---

## 参考链接

- [Cursor for iOS - App Store](https://apps.apple.com/us/app/cursor/id6767085653?l=zh-Hans-CN)
- [Cursor for iOS 官方文档](https://cursor.com/docs/cloud-agent/mobile)
- [Build from anywhere with Cursor for iOS](https://cursor.com/blog/ios-mobile-app)
- [Cursor Agents 网页端](https://cursor.com/agents)

---

*本文基于 2026 年 6 月官方公开资料整理，功能处于 Beta 阶段，后续可能有变动。*
