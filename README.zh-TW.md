# Kindle Local Sync

適用於 Obsidian 的僅本機 Kindle 標註與筆記匯入工具。

Kindle Local Sync 是一個僅適用於桌面端的 Obsidian 外掛。它會讀取透過 USB 連接的 Kindle 上的本機 `My Clippings.txt` 檔案，並將 Kindle 標註與筆記寫入你的 Obsidian 資料庫中的 Markdown 檔案。

## 示範

![Kindle Local Sync demo](docs/assets/demo.gif)

示範：設定本機 `My Clippings.txt` 路徑，同步 Kindle 標註，並查看產生的 Markdown 筆記輸出。

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

## Languages

- [English](README.md)
- [Tiếng Việt](README.vi.md)
- [简体中文](README.zh-CN.md)
- [繁體中文](README.zh-TW.md)

## 從 Obsidian Community Plugins 安裝

從社群外掛目錄安裝（通過審核後）：

Settings → Community plugins → Browse → 搜尋 "Kindle Local Sync" → Install → Enable。

## 快速開始

1. 用 USB 連接 Kindle。
2. 開啟 Obsidian。
3. 安裝並啟用 **Kindle Local Sync**。
4. 如果外掛沒有自動偵測到 Kindle，請設定 **My clippings.txt path**。
5. 選取 ribbon 中的書本圖示，或從 command palette 執行 **Sync local kindle highlights**。
6. 開啟已設定的 highlights 資料夾，檢查產生的筆記。

## 運作方式

1. 外掛從已連接的 Kindle 或手動設定的路徑偵測 `My Clippings.txt`。
2. 外掛以 UTF-8 文字讀取本機 clipping 檔案。
3. 外掛解析 Kindle 標註與筆記，並略過 bookmark 項目。
4. 外掛依書籍分組 clipping。
5. 如有需要，外掛會建立已設定的 highlights 資料夾。
6. 外掛為每本書寫入或更新一個 Markdown 筆記。

外掛只管理這些 marker 之間的內容：

```markdown
<!-- kindle-local-sync:start -->
<!-- kindle-local-sync:end -->
```

這些 marker 之外的內容會被保留。

## 隱私

Kindle Local Sync 從設計上就是僅本機。

- No Amazon login.
- No Readwise integration.
- No cloud sync.
- No telemetry.
- No external APIs.
- No network requests.
- 此外掛不會讓你的 Obsidian 資料庫內容離開本機。

外掛會從本機檔案系統讀取 `My Clippings.txt`，並在你的 Obsidian 資料庫中寫入 Markdown 檔案。

## 疑難排解

- **外掛尚未出現在目錄中**：通過審核後，請從 Obsidian Community Plugins 安裝。在此之前，如果你在測試 beta 版本，可以使用 BRAT 或 GitHub Release ZIP。
- **找不到 My Clippings.txt**：用 USB 連接 Kindle，然後在外掛設定中手動填寫 **My clippings.txt path** 的絕對路徑。
- **沒有匯入任何標註**：確認 Kindle 上存在本機 `My Clippings.txt` 檔案，且檔案中包含 highlight 或 note，而不只是 bookmark。
- **第二次 sync 看起來沒有變化**：如果這些 clipping 已經匯入，這是正常的。外掛會避免重複 highlight 和重複檔案。
- **你在產生的檔案中加入了自己的筆記**：請把個人內容放在 `kindle-local-sync` marker 之外，這樣後續 sync 會保留這些內容。

## Roadmap

- 增加來自真實 Kindle clipping 變體的 parser fixtures。
- 在 macOS、Windows 和 Linux 上進行更多 manual QA。
- 為社群外掛提交準備 release packaging checklist。
- 根據使用者回饋選擇性改進筆記格式。
