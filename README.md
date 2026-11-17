# Linux 冒險：Kernel-7

在真實的 Linux 終端機裡，邊玩邊學 Linux command line，從入門到精通（11 個階段、229 關）。

你是剛接手 Kernel-7 號空間站的新任管理員。前任管理員 Vega 失蹤了，站上有個不聽話的守護程序 Warden。領航企鵝 **Pip** 會陪你一路解開謎團。每過幾關，Pip 會替你解讀一則「日誌碎片」。


## 安裝

需要 git 與 Docker（macOS 建議 OrbStack）。

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/linux-by-playing/main/install.sh | bash
playnux            # 開始；playnux update 更新；playnux reset 重置進度
```

不想裝指令的話，直接 clone 後執行：

```bash
git clone https://github.com/Icarus603/linux-by-playing.git && cd linux-by-playing && ./playnux
```

第一次執行會在本機建置映像（編譯 llama.cpp、下載約 2.6GB 的 4B 模型，約十幾分鐘），之後秒開。只要精簡版（不含模型）：`docker build --build-arg WITH_LLM=0 -t lbp:dev ~/.local/share/playnux`。預設限制 5GB 記憶體（`LBP_MEM` 可調）。遊戲在容器內執行，預設不連外網，進度存在 `~/.linux-by-playing`。

## 問 Pip（自然語言問答）

直接在輸入框用中文問問題（或 `/ask ...`），Pip 會用內建的離線知識庫（手寫專業條目、man page、tldr-pages、核心文件，共約 3.5 萬個知識塊）檢索，再交給本機的 Qwen3.5-4B 簡短回答；離題問題也會以「Linux 專家」的身分回應。完全離線。資料來源與授權見 [THIRD_PARTY.md](THIRD_PARTY.md)，模型選擇見 [docs/MODELS.md](docs/MODELS.md)。

## 介面

單欄全螢幕：頂部是固定位置的 Pip 與**打字機效果**的對話框，下面是金色任務卡（只顯示目前這一關），再下面是你的指令輸出，最底部是輸入框。輸入框裡打的就是**真正的 bash**，判定看「結果狀態」而不是比對指令字串。

`less`、`man`、`vim`、`top` 這類全螢幕程式會自動接管整個終端，離開後回到遊戲。

## 遊玩

需要 Docker 或 OrbStack。

```bash
scripts/play          # 第一次會自動建置映像
scripts/play build    # 重新建置
scripts/play verify   # 驗證所有關卡（每關：未解 → 失敗，套用解答 → 通過；高爾夫目標也要可達成）
scripts/play shell    # 進入容器除錯
```

存檔在 `~/.linux-by-playing`。預設容器不連外網、不特權、限制資源。

## Slash 指令（由 Pip 回應）

輸入 `/` 會彈出選單：`↑↓` 選擇、`Enter` 確認、`Tab` 填入、`Esc` 關閉。

| 指令 | 說明 |
|---|---|
| `/help` `/quit` | 說明、離開（Ctrl-D 也行，進度每關自動存檔） |
| `/hint` `/skip` `/restart` | 提示、跳過、重來本關 |
| `/reset` | 重置**全部**進度（回到第 1 關，需再輸入 `/reset confirm` 確認）。不進遊戲也能用 `scripts/play reset` |
| `/levels` `/goto [2-03]` | **關卡選單**（↑↓ 選擇、←→ 跳階段、Enter 前往），可重玩已完成的關卡（不重複計 XP） |
| `/prev` `/next` `/continue` | 上一關、下一關、回到最前面還沒完成的關卡 |
| `/explain [指令]` | Pip 解釋指令，並指出在哪一關教過 |
| `/why` | 解釋上一個指令為什麼失敗 |
| `/map` `/stats` `/badges` `/lore` | 進度、等級、徽章、日誌碎片 |
| `/hard` | 困難模式：沒有提示、不顯示指令名稱、XP ×1.5 |
| `/tip` `/joke` `/dance` | 小技巧與彩蛋 |

## 趣味機制

連勝加成（不用提示連續過關）、快速通關、**指令高爾夫**（最後一個指令夠短有額外 XP）、成就徽章、劇情日誌碎片、隨機答案（前期關卡每次不同）、卡關時 Pip 主動關心、會攔下 `rm -rf /` 這類危險指令。

## 新增關卡

在 `levels/<階段>/` 加一個 YAML，欄位見 [src/engine/types.ts](src/engine/types.ts)：

| 欄位 | 說明 |
|---|---|
| `setup` / `check` / `solution` | 建立環境 / 判定（exit 0 通過，stdout 第一行是失敗回饋）/ 參考解答 |
| `cwd` / `cleanup` | 起始目錄 / 離開時清理系統層副作用 |
| `reveal` | 過關後 Pip 揭露的劇情碎片 |
| `golf` + `golf_solution` | 高爾夫字元數目標與證明可達成的最短解答 |

`check` 可用環境變數：`LBP_LAST`（最後指令）、`LBP_CWD`、`LBP_ANSWER`、`LBP_RC`（上一個指令結束碼）。

寫完執行 `scripts/play verify <階段>`。注意：YAML 裡含反斜線的字串請用區塊純量（`|`）；`pgrep -f` 比對自己名字時用 `[s]tubborn` 寫法避免匹配到檢查腳本本身。

## 結構

```
src/engine/   關卡載入、判定、存檔、徽章、驗證
src/shell/    PTY 常駐 bash、輸出緩衝
src/hud/      Ink 介面、Pip、slash 指令（只透過 ink.ts 引用 UI 層）
docker/       玩家 bashrc、入口腳本、模擬 systemctl/journalctl
levels/       229 關（11 個階段）
docs/CURRICULUM.md   課程地圖與指令覆蓋清單
vendor/ink    訂製版 Ink，見 NOTICE.md
```

## 課程階段

1 生存入門 · 2 檔案與目錄 · 3 搜尋與定位 · 4 文字處理與管線 · 5 權限與使用者 · 6 程序與資源 · 7 系統管理 · 8 Shell 腳本 · 9 網路 · 10 編輯器與開發工具 · 11 精通。每個階段結尾是一個 Boss；最後一關是整座站同時出五種故障的總考驗。完整指令清單與未涵蓋項目見 [docs/CURRICULUM.md](docs/CURRICULUM.md)。

## 注意

- `vendor/ink` 來源沒有明確授權，隨本倉庫發布的風險由作者承擔（見 [THIRD_PARTY.md](THIRD_PARTY.md)）；想替換只需改 `src/hud/ink.ts`。
- 本專案原創內容採 MIT 授權；第三方內容（tldr CC BY 4.0、Linux 核心文件 GPL-2.0 等）見 THIRD_PARTY.md。
- 容器內沒有真的 systemd。`systemctl` / `journalctl` 是介面一致的**模擬 init**（`systemctl --version` 會誠實說明）。
