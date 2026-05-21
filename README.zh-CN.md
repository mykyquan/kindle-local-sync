# Kindle Local Sync

面向 Obsidian 的仅本地 Kindle 标注和笔记导入工具。

Kindle Local Sync 是一个仅适用于桌面端的 Obsidian 插件。它会读取通过 USB 连接的 Kindle 上的本地 `My Clippings.txt` 文件，并将 Kindle 标注和笔记写入你的 Obsidian 库中的 Markdown 文件。

## 演示

![Kindle Local Sync demo](docs/assets/demo.gif)

演示：设置本地 `My Clippings.txt` 路径，同步 Kindle 标注，并查看生成的 Markdown 笔记输出。

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

## Languages

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## 从 Obsidian Community Plugins 安装

从社区插件目录安装（通过审核后）：

Settings → Community plugins → Browse → 搜索 "Kindle Local Sync" → Install → Enable。

## 快速开始

1. 用 USB 连接 Kindle。
2. 打开 Obsidian。
3. 安装并启用 **Kindle Local Sync**。
4. 如果插件没有自动检测到 Kindle，请设置 **My clippings.txt path**。
5. 点击 ribbon 中的书本图标，或从 command palette 运行 **Sync local kindle highlights**。
6. 打开已配置的 highlights 文件夹，检查生成的笔记。

## 工作方式

1. 插件从已连接的 Kindle 或手动配置的路径中检测 `My Clippings.txt`。
2. 插件以 UTF-8 文本读取本地 clipping 文件。
3. 插件解析 Kindle 标注和笔记，并跳过 bookmark 条目。
4. 插件按书籍对 clipping 分组。
5. 如有需要，插件会创建已配置的 highlights 文件夹。
6. 插件为每本书写入或更新一个 Markdown 笔记。

插件只管理这些标记之间的内容：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

这些标记之外的内容会被保留。

## 隐私

Kindle Local Sync 从设计上就是仅本地的。

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- 此插件不会让你的 Obsidian 库内容离开本机。

插件会从本地文件系统读取 `My Clippings.txt`，并在你的 Obsidian 库中写入 Markdown 文件。

## 故障排查

- **插件尚未出现在目录中**：通过审核后，请从 Obsidian Community Plugins 安装。在此之前，如果你在测试 beta 版本，可以使用 BRAT 或 GitHub Release ZIP。
- **找不到 My Clippings.txt**：用 USB 连接 Kindle，然后在插件设置中手动填写 **My clippings.txt path** 的绝对路径。
- **没有导入任何标注**：确认 Kindle 上存在本地 `My Clippings.txt` 文件，并且文件中包含 highlight 或 note，而不只是 bookmark。
- **第二次 sync 看起来没有变化**：如果这些 clipping 已经导入，这是正常的。插件会避免重复 highlight 和重复文件。
- **你在生成的文件中添加了自己的笔记**：请把个人内容放在 `kindle-local-sync` marker 之外，这样后续 sync 会保留这些内容。

## Roadmap

- 增加来自真实 Kindle clipping 变体的 parser fixtures。
- 在 macOS、Windows 和 Linux 上进行更多 manual QA。
- 为社区插件提交准备 release packaging checklist。
- 根据用户反馈选择性改进笔记格式。
