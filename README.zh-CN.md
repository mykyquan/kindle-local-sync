# Kindle Local Sync

将 Kindle 标注和笔记导入 Obsidian，阅读数据不会发送到外部。

Kindle Local Sync 是仅适用于桌面端的 Obsidian 插件。它读取通过 USB 连接的 Kindle 上的本地 `My Clippings.txt`，并把你批准的标注写入库中的 Markdown 笔记。

## 演示

![Kindle Local Sync demo](docs/assets/demo.gif)

## 功能

- 本地、USB-first 导入，无需 Amazon 或 Readwise 账户。
- 在 macOS、Windows 和 Linux 上自动检测 Kindle 路径，也支持手动路径。
- 每本书一个 Markdown 笔记。
- 首次同步和发现新标注时提供审核。
- 临时 Skip 与持久化 Ignore 选择。
- 保存的同步数据缺失时，可重新连接已有 Kindle Local Sync 笔记。
- 已导入标注在预期 Obsidian 笔记中缺失时，可进行恢复审核。
- 保护插件管理区块之外的个人内容。
- 防止重复 clipping，并安全处理文件名。

## 语言

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## 从 Obsidian Community Plugins 安装

插件通过社区目录审核后：

Settings → Community plugins → Browse → 搜索 **Kindle Local Sync** → Install → Enable。

在此之前，仅在测试 beta 版本时使用 BRAT 或 GitHub Release ZIP。

## 快速开始

1. 用 USB 连接 Kindle。
2. 打开 Obsidian 并启用 **Kindle Local Sync**。
3. 如果没有检测到 Kindle，请在插件设置中填写 **My clippings.txt path**。
4. 点击 ribbon 中的书本图标，或从 command palette 运行 **Sync local kindle highlights**。
5. 审核需要选择的标注。
6. 选择 **Finish Sync**，然后打开已配置的 highlights 文件夹查看结果。

## Kindle Local Sync 如何工作

1. 插件从 Kindle 或你配置的本地路径读取 `My Clippings.txt`。
2. 它解析标注和笔记，跳过 bookmark 与格式损坏的条目，并按书分组。
3. 需要审核时，你可以选择 Import、仅本次 Skip 或 Ignore。
4. 在你选择 **Finish Sync** 前，审核中的选择都不会应用。
5. 获批准的标注会写入匹配的 Obsidian 书籍笔记。只有获批准的 Import 确实需要时，才会创建新笔记。
6. 后续同步会比较当前 Kindle 文件、已保存的选择和现有笔记中的插件管理区块。
7. 插件管理区块之外的个人内容会保留。

`My Clippings.txt` 是导入来源，不是可靠的删除记录。某条标注未出现在当前 Kindle 文件中，并不表示插件可以自动删除 Obsidian 中的副本。

## 新用户

如果没有可信的同步历史，也没有已有 Kindle Local Sync 笔记，首次同步会打开 **First Sync Preview**。每条标注最初都没有选择，由你决定哪些内容进入 Obsidian。

- **Import**：完成同步时添加标注。
- **Skip This Sync**：本次不改动，下次可能再次出现。
- **Ignore**：在你从 Ignore 列表移除前，不再参加后续同步。

仅打开审核或选择临时操作不会创建书籍笔记。插件只会在 **Finish Sync** 后写入内容并保存选择。未审核的标注会按本次临时 Skip 处理，下次可能再次出现。

## 回访用户

### 有已保存的同步历史

当 `data.json` 包含可信的 Import 或 Ignore 历史时，已导入且 marker 仍存在的标注会自动刷新；已 Ignore 的标注不参与同步。通常只有新标注，以及已导入但在预期笔记中缺失的标注需要处理。

插件不会把 `My Clippings.txt` 当作删除 Obsidian 旧标注的授权。如果无法在保留现有 managed 内容的前提下安全刷新某本书，插件会保持该笔记不变，并在结果摘要中说明。

### 有现有笔记，但没有可信的 `data.json`

如果已配置的 highlights 文件夹中存在有效 Kindle Local Sync managed 区块，但缺少可信同步历史，插件会显示 **Existing Kindle notes found**。

选择 **Continue with existing notes** 进行重新连接：

- 在预期书籍笔记中找到的精确 marker 会记录为已有导入。
- 无法匹配的标注会进入 **Review New Highlights**。
- 现有笔记保持原位，managed 区块之外的个人内容会保留。
- 仅凭 Markdown 无法恢复旧 Ignore 选择，因此插件不会猜测。

因此，正常情况下你只需审核无法匹配的标注，而不是重新批准所有旧标注。

### 从旧版本更新后

旧版本可能保存了插件设置，但没有保存标注历史。更新后，你可能会看到 **Existing Kindle notes found**。选择 **Continue with existing notes** 重新连接：插件会保留现有笔记，识别 marker 匹配的标注，并且只要求你审核无法匹配的标注。

如果没有找到有效的现有 Kindle Local Sync 笔记，插件会改用 **First Sync Preview**。

## 每个选择的含义

| 选择 | 实际行为 | 示例 |
| --- | --- | --- |
| **Import** | 临时选中一条标注，在选择 **Finish Sync** 时写入。 | 导入项目笔记中要引用的一段话。 |
| **Skip This Sync** | 本次跳过一条标注；在书籍卡片上使用时，会跳过该书所有标注。下次可能再次出现。 | 把一段长文留到下次再决定。 |
| **Ignore** | 在 **Finish Sync** 后保存持久 Ignore；从 Ignore 列表移除前不再参与后续同步。 | 隐藏无用 clipping。 |
| **Import All** | 把该书所有当前临时选择改为 Import。 | 导入一本书的全部当前 clipping。 |
| **Ignore All** | 把该书所有当前临时选择改为 Ignore。 | 让一本书的当前标注不再参与后续同步。 |
| **Import All Books** | 把当前审核中的所有选择（包括被筛选隐藏的书）改为 Import。已有 Skip 或 Ignore 时会先确认；以前保存的 Ignore 不受影响。 | 一次批准整个首次审核。 |
| **Finish Sync** | 应用当前选择、保存已确认状态，并打开 **Sync complete** 或 **Sync finished**。未审核标注本次会被 Skip。 | 今天只审核关心的书后完成同步。 |
| **Cancel** | 没有改变选择时直接关闭；存在未保存选择时，询问继续审核还是放弃。搜索、筛选、滚动和导航不会触发该警告。 | 不保存误选并退出。 |

后执行的批量操作会覆盖先前的临时选择。例如，先 Ignore 一条标注，再为该书选择 **Import All**，该书当前所有标注都会变为 Import。确认后，**Import All Books** 会对整个审核做同样的事。任何审核选择都不会在 **Finish Sync** 前保存。

### 查找和审核

- **Search books...** 按书名和作者搜索，不改变选择；它不会搜索标注正文。
- **All Books**、**Needs Review** 和 **Reviewed** 只筛选书籍列表，并保留完整审核状态。
- **How choices work** 与 `?` 按钮显示同一份简短帮助。
- **Review Highlights** 打开某本书的逐条选择。

## Sync Summary 和后续操作

同步完成后，摘要会报告 Import、Ignore、Skip、未审核、重复和 missing 的数量。根据结果，可能提供：

- **Review Skipped This Sync**：查看临时 Skip。可以继续暂时跳过，也可以选择 **Ignore Going Forward**；书籍级 **Ignore All Highlights** 需要确认。
- **Manage Ignored Highlights**：按书查看 Ignore 项目，使用 **Remove From Ignore List** 或 **Remove All From Ignore List**。移除 Ignore 不会立即重写笔记；如果 clipping 仍在 `My Clippings.txt`，后续同步会按 new 或 missing 重新处理。
- **Review Missing Highlights**：处理以前已导入、现在却不在预期笔记中的标注。
- **View Books Left Unchanged**：查看因无法安全更新而保持不变的书籍。
- **Review Note Update Issues**：查看 Ignore 清理失败或无法确认的结果。

## Missing Highlights

只有同时满足以下条件，标注才会被视为 missing：

1. 当前 `My Clippings.txt` 仍包含它。
2. `data.json` 中存在本次同步可信任的匹配 imported-highlight 记录。
3. 在预期书籍笔记路径的有效 managed 区块中找不到它的精确 marker。

此检查在回访用户同步中、解析 Kindle 文件后运行。如果无法安全读取预期笔记，插件不会自动把标注判定为 missing。

你可以为每条 missing 标注选择：

- **Import Again**：尝试恢复。只有 writer 确认结果安全后，该项目才会从 missing 列表消失；否则仍可重试。
- **Ignore Going Forward**：保存 Ignore 并让它不再参与后续同步。旧 imported 记录仍保留，但 Ignore 优先；以后移除 Ignore 且 marker 仍缺失时，它可能再次成为 missing。
- **Skip This Time**：只从当前摘要移除，不保存任何决定，因此下次可能再次出现。

书籍级对应操作为 **Import All Again**、**Ignore All Going Forward** 和 **Skip All This Time**。

限制：missing 检测依赖已保存的 imported metadata、当前文件中仍有该 clipping、预期笔记路径以及可读取的 managed 区块。手动移动笔记可能产生 missing；如果标注同时从当前 Kindle 文件和可信身份数据中消失，则无法检查。

## 如果标注被删除

### 从 Obsidian 笔记中删除

如果你手动删除插件管理的标注，但 marker 结构和笔记其余部分仍有效，那么在已保存 Import 记录和 Kindle 文件条目仍存在时，它会在下次同步出现在 **Missing Highlights**。删除整个 managed 区块可能使该笔记中所有受跟踪标注都显示为 missing。

之后可以再次 Import、以后 Ignore，或本次 Skip。managed marker 之外的个人内容不属于此检查。

### 从 Kindle 删除

Kindle Local Sync 没有 Kindle 删除 API，只能读取 `My Clippings.txt`；Kindle 设备可能继续把已删除标注保留在该文件中。

- 如果标注已不在 `My Clippings.txt`，插件不会把这种缺失视为删除 Obsidian 副本的授权。
- 如果它仍在 `My Clippings.txt`，插件仍会把它看作普通 clipping。根据已保存状态和笔记，它可能被刷新、审核、Ignore 或显示为 missing。

因此，插件无法保证检测到 Kindle 设备上的每一次删除。

## 保护个人笔记

Kindle Local Sync 只管理以下 marker 之间的区块：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

managed 区块可能在同步时刷新。请把个人内容放在 marker 之前或之后；marker 之外的内容会保留。

如果 marker 结构损坏，或更新会在没有明确授权的情况下移除现有 managed 标注，插件会让该书笔记保持不变，而不会猜测。

## 重复处理

同一 clipping 的重复副本只写一次。身份还包括精确书名和作者，因此两个不同书籍即使生成相同 ID，也不会混用已保存选择。

已知限制：ID 使用 32 位哈希。同一精确书名和作者下的两个不同 clipping 仍可能碰撞并被当作同一条。此问题尚未解决；在发布版本声称完整碰撞安全前，必须测试或修复。

## 隐私

所有标注处理都在本地完成。运行时源码没有网络请求、云同步、analytics、telemetry、Amazon API 或 Readwise API 路径。插件不会通过网络发送标注文字或库内容。

插件从本地文件系统读取 `My Clippings.txt`，并在 Obsidian 库内写入 Markdown 和插件状态。**Strict local only** 设置会保存，但当前运行时即使更改该开关仍保持本地，因为不存在网络功能。

## 故障排查

- **找不到 My Clippings.txt**：用 USB 连接 Kindle，然后手动填写绝对 **My clippings.txt path**。
- **找不到标注**：确认文件包含 Highlight 或 Note，而不只是 bookmark。
- **后续同步没有变化**：当相同的已导入 marker 仍存在时，这是正常行为。
- **某本书保持不变**：插件无法证明替换 managed 区块是安全的。检查 marker，并在编辑 managed 区块前备份。
- **更新后出现 Existing Kindle notes found**：这是[从旧版本更新后](#从旧版本更新后)所述的正常重新连接步骤。现有笔记会保留。
- **个人内容在生成的笔记中**：将它移到 `kindle-local-sync` marker 之外，避免后续 managed 刷新替换。

## 技术文档

架构、同步状态、持久化、安全约束、已知限制以及源码/测试映射请参阅[技术架构](docs/ARCHITECTURE.md)。

## Roadmap

- 解决同书 ID 碰撞阻塞项。
- 在干净库中完成 new、returning、reconnect、missing、Ignore、Skip、cancel 和 managed-region 手动 QA。
- 用经验证的隐私安全录屏替换当前 demo。
- 发布前验证可复现、可安装的 release artifact。
