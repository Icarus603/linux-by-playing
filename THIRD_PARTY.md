# 第三方內容與授權

本專案原創程式碼與關卡內容採 MIT 授權（見 LICENSE）。以下內容來自第三方，**不適用該授權**。

| 內容 | 用途 | 授權 |
|---|---|---|
| `vendor/ink/` | 訂製版 Ink（終端機 UI 渲染） | **授權不明**：衍生自從 Claude Code sourcemap 還原的程式碼，沒有明確授權。見 `vendor/ink/NOTICE.md`。若權利人要求，將立即移除並改用上游 Ink。 |
| tldr-pages | 建置映像時下載，匯入為 RAG 範例（https://github.com/tldr-pages/tldr） | CC BY 4.0 |
| Linux kernel Documentation v6.8 | 建置映像時下載，匯入為 RAG 參考（`ip-sysctl`、`cgroup-v2` 等） | GPL-2.0 |
| 系統 man page | 建置映像時由 Ubuntu 套件擷取 | 各套件自身授權 |
| llama.cpp | 本機推論伺服器（編譯進映像） | MIT |
| Qwen3.5-4B（GGUF，unsloth 轉換版） | 本機語言模型（建置映像時下載並驗證 SHA256） | Apache-2.0 |
| Ink、React、chalk 等 npm 套件 | 由 `bun install` 安裝 | 各自的 MIT 等授權 |

映像檔內的 `ref.json` 是上述 tldr-pages、核心文件與 man page 的衍生資料；散布映像時請一併保留本文件。


## 其他

- [opencc-js](https://github.com/nk2028/opencc-js)（MIT）：簡繁轉換，用於簡體中文顯示。
