# REA Light MCP

[简体中文](README.md) · 繁體中文 · [English](README.en.md)

讓 Codex 只常駐載入 4 個小工具，需要時才查詢及呼叫完整的 [REA](https://github.com/morluto/rea) 功能。保留同一個後端程序、分析目標與 Evidence；大型結果完整存檔，再按需讀取。

REA 6.8.0 在 Windows 實測工具定義從 3,504,966 字元降到 2,784 字元，減少約 99.92%。這是工具定義大小，實際 token 用量仍包含系統指令、其他工具及歷史。此專案是獨立適配器。

## 安裝

原始碼版本需要 Node.js ^22.23.4、^24.22.1 或 >=26.12.1。REA 6.8.0 會隨依賴安裝，不需先安裝全域 CLI。原生分析所需的引擎仍由使用者自行配置。

以下發佈版指令仍會安裝 v1.0.0（REA 6.4.0）；要使用 REA 6.8.0，請使用下方原始碼安裝方式。

Windows PowerShell：

```powershell
$p = Join-Path $env:TEMP 'rea-light-install.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

macOS / Linux：

```bash
curl -fsSL https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.sh -o /tmp/rea-light-install.sh && bash /tmp/rea-light-install.sh
```

安裝器校驗發布包、安裝到獨立版本目錄、測試 MCP、備份並修改 `[mcp_servers.rea]`，同時加入輕量 skill 指引。其他設定與 REA 環境變數保留。支援自訂 `CODEX_HOME`。

完成後完全退出並重開 Codex，再開新任務。已存在於舊對話的工具定義不會立即消失；MCP 隨 Codex 啟動，不需要常駐 CMD／終端機視窗。若其他名稱或專案配置也掛載完整 REA，請先禁用重複入口。

從原始碼安裝：

```bash
git clone https://github.com/funkeyyou/rea-light-mcp.git
cd rea-light-mcp
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
node install.mjs
```

不要移動或刪除安裝時使用的程式碼目錄。

## 操作與還原

- `rea_search`：英文關鍵字搜尋功能。
- `rea_schema`：讀取指定工具的參數。
- `rea_call`：依實際 Schema 執行，維持呼叫順序。
- `rea_result`：以 JSON pointer 與字元偏移讀取存檔。

執行器可以改資料、連網、啟動程序或操作介面，需遵守使用者授權。後端中斷不會自動重試；重啟後內存分析狀態需要重建或還原快照。

大型結果完整保存在 `$CODEX_HOME/rea-light/results`；`complete_on_disk` 表示檔案完整，摘要仍可能只是部分內容。可透過 `result_refs` 將保存的 Evidence 直接交給後續操作。Unix 使用僅擁有者可讀寫的檔案權限；Windows 使用使用者目錄繼承的 ACL。

在安裝目錄執行 `node install.mjs --uninstall`，可還原原先 REA 連接與未被自行修改的 skill。程式碼、分析結果及分析引擎會保留；手動修改過的配置會停止自動覆蓋。`--dry-run` 可先查看預計變更。

[完整參數、測試及維護說明](README.md) · [第三方授權](THIRD_PARTY.md)
