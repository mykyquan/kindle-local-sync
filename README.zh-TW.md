# Kindle Local Sync

適用於 Obsidian 的僅本機 Kindle 標註與筆記匯入工具。

Languages:
- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

Kindle Local Sync 是一個僅適用於桌面端的 Obsidian 外掛。它會讀取透過 USB 連接的 Kindle 上的本機 `My Clippings.txt` 檔案，並將 Kindle 標註與筆記寫入你的 Obsidian 資料庫中的 Markdown 檔案。

## 截圖

![Kindle Local Sync demo](docs/assets/demo.gif)

示範：設定本機 `My Clippings.txt` 路徑，同步 Kindle 標註，並查看產生的 Markdown 筆記輸出。

## 它能做什麼

- 從已連接的 Kindle 或手動設定的路徑偵測 `My Clippings.txt`。
- 以 UTF-8 文字讀取本機 clipping 檔案。
- 解析 Kindle 標註與筆記。
- 略過 Kindle bookmark 項目。
- 依書籍分組 clipping。
- 在可設定的 Obsidian 資料庫資料夾中，為每本書寫入一個 Markdown 筆記。
- 保留外掛管理的同步區域之外的使用者自寫內容。
- 當同一個 clipping 出現多次時，避免輸出重複內容。

## 為什麼僅本機很重要

Kindle Local Sync 是為了想把閱讀筆記放進 Obsidian、但不想經過雲端服務的讀者而設計。

它不需要：

- Amazon login
- Readwise
- Cloud sync
- Telemetry
- External services
- Network requests

外掛會從本機 Kindle 檔案讀取內容，並寫入你的本機 Obsidian 資料庫。

## 最適合的使用者

如果你符合以下情況，這個外掛會特別適合你：

- 閱讀 Kindle 側載書籍。
- 使用 Obsidian 管理筆記。
- 偏好 local-first 工具。
- 想避免第三方標註服務。
- 可以透過 USB 連接 Kindle。

## 功能

- 桌面端 Obsidian 外掛。
- USB-first Kindle clipping 匯入。
- 支援手動設定 `My Clippings.txt` 路徑。
- 支援 macOS、Windows 和 Linux 路徑偵測。
- 在 Obsidian 資料庫中輸出 Markdown。
- 每本書一個筆記。
- 具備穩定 clipping ID 的生成同步區域。
- 安全的檔名與資料夾路徑清理。
- parser 和 vault writer 有測試覆蓋。

## 運作方式

1. 透過 USB 連接 Kindle。
2. 從 ribbon 圖示或 command palette 執行 **Sync local kindle highlights**。
3. 外掛尋找 `My Clippings.txt`。
4. 外掛讀取並解析本機 Kindle 標註與筆記。
5. 如有需要，外掛會建立已設定的 highlights 資料夾。
6. 外掛在你的 Obsidian 資料庫中寫入或更新 Markdown 筆記。

外掛只管理這些 marker 之間的內容：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

這些 marker 之外的內容會被保留。

## 安裝 / 手動安裝

在正式提交到 Obsidian Community Plugin 之前，目前最建議透過 BRAT 安裝此外掛進行 beta testing。

### A. 建議的 beta 安裝方式：BRAT

1. 從 Obsidian Community Plugins 安裝 BRAT。
2. 開啟 Command Palette。
3. 執行 `BRAT: Add a beta plugin for testing`。
4. 貼上 `https://github.com/mykyquan/kindle-local-sync`。
5. 在 **Settings -> Community plugins** 啟用 **Kindle Local Sync**。

### B. 從 GitHub Release 手動安裝

1. 從 GitHub Releases 下載最新 release zip。
2. 解壓縮到：

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

3. 確認資料夾包含：
   - `main.js`
   - `manifest.json`
   - `styles.css` 如果存在
4. 重新載入 Obsidian。
5. 在 **Settings -> Community plugins** 啟用 **Kindle Local Sync**。

### C. 給開發者：從原始碼建置

1. Clone 此 repository。
2. 執行 `npm ci`。
3. 執行 `npm run build`。
4. 將 `main.js` 和 `manifest.json` 複製到：

```text
<Vault>/.obsidian/plugins/kindle-local-sync/
```

5. 如果存在，也複製 `styles.css`。
6. 重新載入 Obsidian 並啟用外掛。

## 使用方式

1. 用 USB 連接 Kindle。
2. 開啟 Obsidian。
3. 選取 ribbon 中的書本圖示，或從 command palette 執行 **Sync local kindle highlights**。
4. 查看同步摘要 Notice。
5. 開啟已設定的 highlights 資料夾，檢查產生的筆記。

## 設定

- **My clippings.txt path**：可選的 `My Clippings.txt` 絕對路徑。如果留空，外掛會檢查常見的 Kindle USB 掛載位置。
- **Highlights folder**：寫入生成書籍筆記的 Obsidian 資料庫資料夾。預設值：`Kindle Highlights`。
- **Strict local only**：讓外掛維持僅本機行為定位。目前外掛不會執行 network sync。

## 輸出範例

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

## 隱私聲明

Kindle Local Sync 從設計上就是僅本機。

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- 此外掛不會讓你的 Obsidian 資料庫內容離開本機。

外掛會從本機檔案系統讀取 `My Clippings.txt`，並在你的 Obsidian 資料庫中寫入 Markdown 檔案。

## 目前限制

- 從 Kindle 刪除某個標註，可能不會自動從 Obsidian 中移除對應內容。Kindle 的 `My Clippings.txt` 可能像 append-style log 一樣運作，因此此外掛被設計為安全的本機匯入/同步工具，不會自動刪除 Obsidian 中既有內容。
- 不同 locale 的 Kindle clipping 格式可能需要隨時間增加更多 parser 覆蓋。
- 這個外掛僅適用於桌面端，因為它依賴本機檔案系統存取。
- 產生的筆記以簡單 Markdown 為優先。

## 開發指令

```bash
npm install
npm run build
npm run lint
npm test
```

開發 watch 模式：

```bash
npm run dev
```

## Roadmap

- 增加來自真實 Kindle clipping 變體的 parser fixtures。
- 在 macOS、Windows 和 Linux 上進行更多 manual QA。
- 為社群外掛提交準備 release packaging checklist。
- 根據使用者回饋選擇性改進筆記格式。

## 回饋與 bug 回報

請使用 GitHub Issues 提交 bug 和 feature request。sync、安裝或 parsing 問題請使用 bug report template；新想法請使用 feature request template。

分享 log 或 `My Clippings.txt` 範例前，請先移除私人標註、個人筆記和敏感閱讀資料。如果已啟用 GitHub Discussions，也可以用於一般問題。

## 貢獻

如果貢獻能保留外掛的僅本機隱私模型，我們歡迎參與。

請避免添加：

- Cloud sync
- Telemetry
- Amazon login
- 外部標註服務
- Network-based APIs

開啟 pull request 前，請執行：

```bash
npm run build
npm run lint
npm test
```

## 授權

本專案採用 MIT License 授權。請參閱 [LICENSE](LICENSE)。
