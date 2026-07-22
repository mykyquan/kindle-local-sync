# Kindle Local Sync

将 Kindle 标注带入 Obsidian，而无需把阅读数据发送到任何地方。

Kindle Local Sync 是仅适用于桌面端的 Obsidian 插件。它读取 Kindle 上本地的 `My Clippings.txt` 文件，并为你选择保留的标注创建整洁的 Markdown 笔记。

## 演示

![Kindle Local Sync demo](docs/assets/demo.gif)

## 📖 为什么使用它？

- 将 Kindle 标注留在你实际使用的 Obsidian 笔记和项目旁。
- 在标注加入库之前先审核新标注。
- 每本书使用一份 Markdown 笔记。
- 更新后或插件数据缺失时，重新连接现有的 Kindle Local Sync 笔记。
- 将个人写作与插件更新的部分分开。

## 语言

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## 开始前需要准备

- 桌面端 Obsidian。
- 含有本地 `My Clippings.txt` 文件的 Kindle；通常用 USB 连接 Kindle 后即可访问。
- 一个用于保存书籍笔记的 Obsidian 库。

## 安装

当插件可在 Obsidian Community Plugins 中使用后：

1. 打开 **Settings** → **Community plugins** → **Browse**。
2. 搜索 **Kindle Local Sync**。
3. 选择 **Install**，然后选择 **Enable**。

如需测试 beta 版本，只在你主动测试预发布构建时使用 BRAT 或 GitHub Release ZIP。

## 🧭 快速开始

1. 用 USB 连接 Kindle。
2. 在插件设置中确认 **My clippings.txt path**。如果没有检测到 Kindle，请自行选择本地 `My Clippings.txt` 文件。
3. 为 Markdown 笔记选择 **Highlights folder**。
4. 从命令面板运行 **Sync local kindle highlights**，或使用功能区中的书本图标。
5. 审核需要选择的标注，然后选择 **Finish Sync**。

插件会读取文件、按书分组标注，并将已批准的标注写入所选文件夹。只有获批准的导入确实需要时，才会创建笔记。

## 同步时会发生什么

首次同步时，**First Sync Preview** 会让你决定哪些标注要进入 Obsidian。之后的同步通常会识别已经导入的标注，只询问新的或缺失的项目。

| 选择 | 现在会发生什么 | 下次同步会发生什么 |
| --- | --- | --- |
| **Import** | 选择 **Finish Sync** 后添加所选标注。 | 它们会被识别为已导入。 |
| **Skip This Sync** | 今天不添加该标注。 | 它可能再次出现供你审核。 |
| **Ignore** | 不导入该标注。 | 它会保持忽略状态，直到你从 Ignore 列表中移除它。 |

审核较多项目时，也可以使用 **Import All**、**Ignore All** 或 **Import All Books**。在选择 **Finish Sync** 前，所有审核选择都只是临时的。

如果标注之后从 `My Clippings.txt` 中消失，插件不会将此视为删除 Obsidian 副本的许可。Kindle 设备可能仍会在该文件中保留已经删除的标注，因此插件不能把它当作可靠的删除列表。

## 现有 Kindle 笔记

如果你已有 Kindle Local Sync 笔记，但插件找不到保存的历史记录，它会显示 **Existing Kindle notes found**。

选择 **Continue with existing notes** 来重新连接。插件会保留这些笔记，识别能够匹配的标注，并只要求你审核无法匹配的项目。你不需要重新批准每一条旧标注。

如果之前导入的标注不再出现在预期笔记中，**Missing Highlights** 可以提供 **Import Again**、**Ignore Going Forward** 或 **Skip This Time**。如果插件无法安全检查笔记，它会保持该书不变，并在同步摘要中说明原因。

## 保护个人笔记

Kindle Local Sync 只更新它在以下标记之间创建的部分：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

请将自己的文字放在这一部分之前或之后。标记外的内容会被保留。如果插件无法安全更新书籍笔记，它会保持笔记不变，而不是猜测如何处理。

## 🔒 隐私

你的标注始终保留在本地。Kindle Local Sync 从电脑读取 `My Clippings.txt`，并在库中写入 Markdown 笔记和插件设置。它不会上传你的标注或库内容，也没有云同步、遥测、Amazon 或 Readwise 连接。

## 🛠️ 故障排查

| 你看到的情况 | 通常表示什么 | 可以尝试什么 |
| --- | --- | --- |
| **Could not find My Clippings.txt** | 未检测到 Kindle，或文件路径已改变。 | 连接 Kindle，然后手动设置 **My clippings.txt path**。 |
| 找不到标注 | 文件可能只有书签或不支持的条目。 | 检查文件是否包含 Kindle Highlight 或 Note 条目。 |
| 后续同步没有变化 | 相同标注已经被识别。 | 这是正常情况；新标注会提供给你审核。 |
| 一本书保持不变 | 插件无法证明更新它是安全的。 | 保留备份，检查插件区域，解决笔记问题后再试。 |
| **Existing Kindle notes found** | 找到了现有笔记，但没有可用的保存历史。 | 选择 **Continue with existing notes** 重新连接。 |

## 高级文档和支持

- [技术架构](docs/ARCHITECTURE.md)为维护者和高级用户说明同步行为、迁移、兼容性和安全规则。
- [发布清单](docs/release-checklist.md)涵盖测试和发布工作。
- [Support](SUPPORT.md)说明如何在不分享私人阅读数据的情况下报告问题。

Kindle Local Sync 使用 [MIT License](LICENSE) 发布。
