<div align="center">

# 🐧 Linux 冒險：Kernel-7

**在真實的 Linux 終端機裡，用玩的學會 Linux 命令列，從入門到精通。**

![關卡](https://img.shields.io/badge/關卡-230-2ea043) ![階段](https://img.shields.io/badge/階段-11-1f6feb) ![離線 AI](https://img.shields.io/badge/離線_AI-Qwen3.5--4B-8957e5) ![Docker](https://img.shields.io/badge/需要-Docker-2496ed?logo=docker&logoColor=white) ![Bun](https://img.shields.io/badge/Bun-TypeScript-f9f1e1?logo=bun&logoColor=black) ![License](https://img.shields.io/badge/license-MIT-lightgrey) ![語言](https://img.shields.io/badge/語言-繁體中文-e34c26)

`linux` · `cli` · `terminal` · `shell` · `bash` · `learn-linux` · `game` · `tui` · `docker` · `rag` · `offline-llm` · `繁體中文`

</div>

你是剛接手 **Kernel-7 號空間站**的新任管理員。前任管理員 Vega 失蹤了，站上的守護程序 Warden 開始做出怪事。
領航企鵝 **Pip** 陪你一路追查：每一個線索，都是你親手用 `cat`、`grep`、`find` 從真實的檔案、日誌與程序裡挖出來的。

## ✨ 特色

- **真的 bash，不是模擬**：輸入框裡打的就是真實 shell，判定看「結果狀態」而不是比對指令字串。
- **230 關、11 個階段**：`pwd` 到 `strace`、`iptables`、`git`、shell 腳本，每階段結尾一場 Boss；難度靠「撤除鷹架、技能組合、環境變複雜」遞增。
- **有劇情的推理故事**：失蹤的前任、不肯說實話的 AI、一個幽靈帳號。通關後還有隱藏終章。
- **Pip 會聊天**：輸入 `!` 進入聊天模式，本機 4B 模型搭配約 3.5 萬個知識塊（man page、tldr-pages、核心文件、手寫條目）回答，**完全離線**。
- **安全**：遊戲在容器內執行，預設不連外網、不特權、限制資源，並會攔下 `rm -rf /`。
- **遊戲化**：連勝加成、快速通關、指令高爾夫、徽章、困難模式。

## 🚀 安裝與開始

### 你需要什麼

| 需要 | 不需要 |
|---|---|
| **Docker**（macOS 建議 [OrbStack](https://orbstack.dev)）、**git** | Bun / Node / 編譯器 / Python，都不用裝 |
| **7GB 以上**的可用磁碟、足夠的記憶體（遊戲預設限制容器 5GB） | 帳號、API key、網路（建置完成後） |

### ⚠️ 這個專案是「從原始碼建置」，沒有預先編好的映像

你 clone 下來之後，**第一次執行會在你自己的電腦上用 Docker 建置整個遊戲**。原因是我沒有發布預建映像，所以每個人都得自己建一次：

- **耗時不一定，從十幾分鐘到更久都有可能**（取決於網速與 CPU，下載模型通常是最慢的一段）：編譯 llama.cpp、下載約 2.6GB 的 Qwen3.5-4B 模型、抓取 tldr 與核心文件、建立知識庫。
- **建置時需要網路**；建好之後遊戲本身預設不連外網。
- 建好的映像約 **6.5GB**（在作者的 Apple Silicon Mac 上的實測值，其他平台可能不同）。
- **只建一次**，之後啟動是秒開。
- 想省時間與空間？只要精簡版（不含模型，Pip 退回離線知識庫，不能自然語言聊天）：
  ```bash
  docker build --build-arg WITH_LLM=0 -t lbp:dev .
  ```

### 方式一：一行安裝（推薦）

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/linux-by-playing/main/install.sh | bash
playnux
```

它會把倉庫 clone 到 `~/.local/share/playnux`，並在 `~/.local/bin` 建立 `playnux` 指令（請確認該目錄在 `PATH` 裡）。第一次執行 `playnux` 時開始建置。

### 方式二：自己 clone

```bash
git clone https://github.com/Icarus603/linux-by-playing.git
cd linux-by-playing
./playnux
```

### 日常指令

```bash
playnux            # 開始 / 繼續遊戲（沒有映像時自動建置）
playnux update     # git pull 並重建映像（更新後新關卡與劇情才會出現）
playnux build      # 強制重建映像
playnux reset      # 重置全部進度（需輸入 yes 確認）
playnux verify     # 驗證所有關卡可通（開發用）
playnux shell      # 進入容器除錯
```

預設限制 5GB 記憶體（環境變數 `LBP_MEM` 可調）。存檔在 `~/.linux-by-playing`，與映像分開，重建不會丟進度。

## 💬 問 Pip（自然語言問答）

在輸入框行首輸入 `!` 進入**聊天模式**（輸入框會變藍色），之後每一句都是自然語言對話，Pip 會記得最近幾輪的上下文；`Esc` 或在空白時按退格回到指令模式。一般模式只執行 shell 與 `/` 指令，兩者不會混在一起。

也可以用 `/ask ...` 單次提問，或 `/explain 指令` 請 Pip 詳細解釋。Pip 會先檢索離線知識庫，再交給本機的 Qwen3.5-4B 回答；問到劇情時，只會依你「已經查到的線索」回答，不劇透。資料來源與授權見 [THIRD_PARTY.md](THIRD_PARTY.md)，模型選擇見 [docs/MODELS.md](docs/MODELS.md)，劇情設計見 [docs/STORY.md](docs/STORY.md)。

## 🖥️ 介面

單欄全螢幕：頂部是金色任務卡（只顯示目前這一關），中間是可捲動的紀錄區，最底部是輸入框，輸入框左上方是企鵝 Pip。輸入框裡打的就是**真正的 bash**，判定看「結果狀態」而不是比對指令字串。指令前面是 `$`，自然語言對話（你和 Pip）前面是 `●`；Pip 說的話、提示與劇情都寫在紀錄區，不會消失，往上捲就能回看。

`less`、`man`、`vim`、`top` 這類全螢幕程式會自動接管整個終端，離開後回到遊戲。

## ⌨️ Slash 指令（由 Pip 回應）

輸入 `/` 會彈出選單：`↑↓` 選擇、`Enter` 確認、`Tab` 填入、`Esc` 關閉。

| 指令 | 說明 |
|---|---|
| `/help` `/quit` | 說明、離開（Ctrl-D 也行，進度每關自動存檔） |
| `/hint` `/skip` `/restart` | 提示、跳過、重來本關 |
| `/reset` | 重置**全部**進度（回到第 1 關，需再輸入 `/reset confirm` 確認）。不進遊戲也能用 `playnux reset` |
| `/levels` `/goto [2-03]` | **關卡選單**（↑↓ 選擇、←→ 跳階段、Enter 前往），可重玩已完成的關卡（不重複計 XP） |
| `/prev` `/next` `/continue` | 上一關、下一關、回到最前面還沒完成的關卡 |
| `/explain [指令]` | Pip 解釋指令，並指出在哪一關教過 |
| `/why` | 解釋上一個指令為什麼失敗 |
| `/map` `/stats` `/badges` `/lore` | 進度、等級、徽章、日誌碎片 |
| `/hard` | 困難模式：沒有提示、不顯示指令名稱、XP ×1.5 |
| `/tip` `/joke` `/dance` | 小技巧與彩蛋 |

## 🎮 趣味機制

連勝加成（不用提示連續過關）、快速通關、**指令高爾夫**（最後一個指令夠短有額外 XP）、成就徽章、劇情日誌碎片、隨機答案（前期關卡每次不同）、卡關時 Pip 主動關心、會攔下 `rm -rf /` 這類危險指令。

## 🧩 新增關卡

在 `levels/<階段>/` 加一個 YAML，欄位見 [src/engine/types.ts](src/engine/types.ts)：

| 欄位 | 說明 |
|---|---|
| `setup` / `check` / `solution` | 建立環境 / 判定（exit 0 通過，stdout 第一行是失敗回饋）/ 參考解答 |
| `cwd` / `cleanup` | 起始目錄 / 離開時清理系統層副作用 |
| `reveal` | 過關後 Pip 揭露的劇情碎片 |
| `golf` + `golf_solution` | 高爾夫字元數目標與證明可達成的最短解答 |

`check` 可用環境變數：`LBP_LAST`（最後指令）、`LBP_CWD`、`LBP_ANSWER`、`LBP_RC`（上一個指令結束碼）。

寫完執行 `playnux verify <關卡 id>`。注意：YAML 裡含反斜線的字串請用區塊純量（`|`）；`pgrep -f` 比對自己名字時用 `[s]tubborn` 寫法避免匹配到檢查腳本本身。

## 🗂️ 結構

```
src/engine/   關卡載入、判定、存檔、徽章、驗證
src/shell/    PTY 常駐 bash、輸出緩衝
src/hud/      Ink 介面、Pip、slash 指令（只透過 ink.ts 引用 UI 層）
docker/       玩家 bashrc、入口腳本、模擬 systemctl/journalctl
levels/       230 關（11 個階段）
docs/CURRICULUM.md   課程地圖與指令覆蓋清單
vendor/ink    訂製版 Ink，見 NOTICE.md
```

## 📚 課程階段

1 生存入門 · 2 檔案與目錄 · 3 搜尋與定位 · 4 文字處理與管線 · 5 權限與使用者 · 6 程序與資源 · 7 系統管理 · 8 Shell 腳本 · 9 網路 · 10 編輯器與開發工具 · 11 精通。每個階段結尾是一個 Boss；最後一關是整座站同時出五種故障的總考驗。完整指令清單與未涵蓋項目見 [docs/CURRICULUM.md](docs/CURRICULUM.md)。

## 📝 注意

- `vendor/ink` 來源沒有明確授權，隨本倉庫發布的風險由作者承擔（見 [THIRD_PARTY.md](THIRD_PARTY.md)）；想替換只需改 `src/hud/ink.ts`。
- 本專案原創內容採 MIT 授權；第三方內容（tldr CC BY 4.0、Linux 核心文件 GPL-2.0 等）見 THIRD_PARTY.md。
- 容器內沒有真的 systemd。`systemctl` / `journalctl` 是介面一致的**模擬 init**（`systemctl --version` 會誠實說明）。
