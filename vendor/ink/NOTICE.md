# vendor/ink — 非本專案原創程式碼

此目錄是從 ~/projects/archive/claude-code/packages/@ant/ink 複製而來的訂製版 Ink
（解決終端機 resize 時輸入框斷裂的問題）。其上游為從 Claude Code sourcemap 還原的衍生碼，
**沒有明確授權**（見來源專案的 ATTRIBUTION.md）。

- 已依專案作者的決定連同本倉庫公開發布，**授權風險由作者自行承擔**；使用者請自行評估。若權利人要求，將立即移除並改用上游 Ink。
- 專案其餘部分只透過 `src/hud/ink.ts` 一個轉接檔引用它，替換只需改該檔。
- 已移除：vim/、search/（依賴外部 monorepo 模組）；observability 與 bun:bundle 以空實作取代。
