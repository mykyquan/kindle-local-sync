# Kindle Local Sync

面向 Obsidian 的仅本地 Kindle 标注和笔记导入工具。

Languages:
- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

Kindle Local Sync 是一个仅适用于桌面端的 Obsidian 插件。它会读取通过 USB 连接的 Kindle 上的本地 `My Clippings.txt` 文件，并将 Kindle 标注和笔记写入你的 Obsidian 库中的 Markdown 文件。

## 它能做什么

- 从已连接的 Kindle 或手动配置的路径中检测 `My Clippings.txt`。
- 以 UTF-8 文本读取本地 clipping 文件。
- 解析 Kindle 标注和笔记。
- 跳过 Kindle bookmark 条目。
- 按书籍对 clipping 分组。
- 在可配置的 Obsidian 库文件夹中为每本书写入一个 Markdown 笔记。
- 保留插件管理的同步区域之外的用户自写内容。
- 当同一个 clipping 出现多次时，避免输出重复内容。

## 为什么仅本地很重要

Kindle Local Sync 面向希望把阅读笔记放进 Obsidian、但不想经过云服务的读者。

它不需要：

- Amazon login
- Readwise
- Cloud sync
- Telemetry
- External services
- Network requests

插件会从本地 Kindle 文件读取内容，并写入你的本地 Obsidian 库。

## 最适合的用户

如果你符合以下情况，这个插件会特别适合你：

- 阅读 Kindle 侧载书籍。
- 使用 Obsidian 管理笔记。
- 偏好 local-first 工具。
- 希望避免第三方标注服务。
- 可以通过 USB 连接 Kindle。

## 功能

- 桌面端 Obsidian 插件。
- USB-first Kindle clipping 导入。
- 支持手动配置 `My Clippings.txt` 路径。
- 支持 macOS、Windows 和 Linux 路径检测。
- 在 Obsidian 库中输出 Markdown。
- 每本书一个笔记。
- 带稳定 clipping ID 的生成同步区域。
- 安全的文件名和文件夹路径清理。
- parser 和 vault writer 有测试覆盖。

## 工作方式

1. 通过 USB 连接 Kindle。
2. 从 ribbon 图标或 command palette 运行 **Sync local kindle highlights**。
3. 插件查找 `My Clippings.txt`。
4. 插件读取并解析本地 Kindle 标注和笔记。
5. 如有需要，插件会创建已配置的 highlights 文件夹。
6. 插件在你的 Obsidian 库中写入或更新 Markdown 笔记。

插件只管理这些标记之间的内容：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

这些标记之外的内容会被保留。

## 安装 / 手动安装

在正式提交到 Obsidian Community Plugin 之前，当前最推荐通过 BRAT 安装本插件进行 beta testing。

### A. 推荐的 beta 安装方式：BRAT

1. 从 Obsidian Community Plugins 安装 BRAT。
2. 打开 Command Palette。
3. 运行 `BRAT: Add a beta plugin for testing`。
4. 粘贴 `https://github.com/mykyquan/kindle-local-sync`。
5. 在 **Settings -> Community plugins** 中启用 **Kindle Local Sync**。

### B. 从 GitHub Release 手动安装

1. 从 GitHub Releases 下载最新 release zip。
2. 解压到：

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

3. 确保该文件夹包含：
   - `main.js`
   - `manifest.json`
   - `styles.css` 如果存在
4. 重新加载 Obsidian。
5. 在 **Settings -> Community plugins** 中启用 **Kindle Local Sync**。

### C. 面向开发者：从源码构建

1. Clone 此 repository。
2. 运行 `npm ci`。
3. 运行 `npm run build`。
4. 将 `main.js` 和 `manifest.json` 复制到：

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

5. 如果存在，也复制 `styles.css`。
6. 重新加载 Obsidian 并启用插件。

## 使用方式

1. 用 USB 连接 Kindle。
2. 打开 Obsidian。
3. 点击 ribbon 中的书本图标，或从 command palette 运行 **Sync local kindle highlights**。
4. 查看同步摘要 Notice。
5. 打开已配置的 highlights 文件夹，检查生成的笔记。

## 设置

- **My clippings.txt path**：可选的 `My Clippings.txt` 绝对路径。如果留空，插件会检查常见的 Kindle USB 挂载位置。
- **Highlights folder**：写入生成书籍笔记的 Obsidian 库文件夹。默认值：`Kindle Highlights`。
- **Strict local only**：保持插件围绕仅本地行为定位。当前插件不会执行 network sync。

## 输出示例

```markdown
---
title: "Atomic Habits"
author: "James Clear"
source: "kindle"
sync: "kindle-local-sync"
---

# Atomic Habits

Author: James Clear

## Kindle Highlights & Notes

<!-- kindle-local-sync:start -->

### Highlight - Location 154

> Small habits make a big difference.

Added: Thursday, May 14, 2026 2:44 PM

<!-- kindle-local-sync-id: kls-example -->

<!-- kindle-local-sync:end -->
```

## 截图

![Kindle Local Sync demo](docs/assets/demo.gif)

演示：安装并启用插件，设置 `My Clippings.txt`，同步 Kindle 标注，并查看生成的 Markdown 笔记输出。

## 隐私声明

Kindle Local Sync 从设计上就是仅本地的。

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- 此插件不会让你的 Obsidian 库内容离开本机。

插件会从本地文件系统读取 `My Clippings.txt`，并在你的 Obsidian 库中写入 Markdown 文件。

## 当前限制

- 从 Kindle 删除某条标注，可能不会自动从 Obsidian 中删除对应内容。Kindle 的 `My Clippings.txt` 可能像 append-style log 一样工作，因此本插件被设计为安全的本地导入/同步工具，不会自动删除 Obsidian 中已有内容。
- 不同 locale 的 Kindle clipping 格式可能需要随着时间增加更多 parser 覆盖。
- 该插件是桌面端专用，因为它依赖本地文件系统访问。
- 生成的笔记以简单 Markdown 为优先。

## 开发命令

```bash
npm install
npm run build
npm run lint
npm test
```

开发 watch 模式：

```bash
npm run dev
```

## Roadmap

- 增加来自真实 Kindle clipping 变体的 parser fixtures。
- 在 macOS、Windows 和 Linux 上进行更多 manual QA。
- 为社区插件提交准备 release packaging checklist。
- 根据用户反馈选择性改进笔记格式。

## 反馈和 bug 报告

请使用 GitHub Issues 提交 bug 和 feature request。sync、安装或 parsing 问题请使用 bug report template；新想法请使用 feature request template。

分享日志或 `My Clippings.txt` 示例前，请先移除私人标注、个人笔记和敏感阅读数据。如果已启用 GitHub Discussions，也可以用于一般问题。

## 贡献

如果贡献能保持插件的仅本地隐私模型，我们欢迎参与。

请避免添加：

- Cloud sync
- Telemetry
- Amazon login
- 外部标注服务
- Network-based APIs

打开 pull request 前，请运行：

```bash
npm run build
npm run lint
npm test
```

## 许可证

本项目基于 MIT License 授权。请参阅 [LICENSE](LICENSE)。
