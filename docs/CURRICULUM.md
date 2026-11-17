# 課程地圖：從入門到精通

目標：覆蓋日常工作會用到的絕大多數 Linux 指令。每個階段由「教學關 → 練習關 → 綜合關 → Boss 關」組成。

難度曲線（Progressive Overload）靠四個維度遞增：

1. **撤除鷹架**：前期告訴你用哪個指令 → 中期只給目標 → 後期只給症狀。
2. **技能組合**：後面的關卡必須混用前面學過的指令（間隔重複）。
3. **環境複雜度**：單一目錄 → 大型檔案樹 → 多使用者 → 多服務 → 壞掉的系統。
4. **限制條件**：不能用某指令、一行解決、限時、Command Golf。

標記：`[教]` 第一次出現（會手把手），`[練]` 練習，`[合]` 綜合，`[B]` Boss。

---

## 階段 1　生存入門 — 「迷航的新人」
`pwd ls cd clear echo cat less head tail man --help type which whoami hostname date uname history`
快捷鍵：`Tab` `↑` `Ctrl-C` `Ctrl-L` `Ctrl-R` `Ctrl-A/E`
- 路徑：絕對 / 相對、`.` `..` `~` `-`
- `ls -l -a -h -R -t`，隱藏檔
- 讀檔：`cat less head -n tail -n tail -f`
- 查說明：`man`、`--help`、`type`、`which`
- Boss：在陌生目錄樹中找到並讀出被藏起來的密碼

## 階段 2　檔案與目錄 — 「整理艙房」
`touch mkdir -p cp -r mv rm -r rmdir ln -s ln file stat tree du df`
- 萬用字元 `* ? [] {}`、brace expansion、引號（單 / 雙 / 跳脫）
- 硬連結與軟連結
- `du -sh`、`df -h`
- Boss：把一團混亂的下載資料夾，依副檔名整理成規範結構

## 階段 3　搜尋與定位 — 「尋找失物」
`find grep egrep which whereis locate xargs`
- `find`：`-name -iname -type -size -mtime -newer -maxdepth -exec -delete -print0`
- `grep`：`-r -i -n -v -c -l -w -E -o -A -B -C --include`
- `xargs`（含 `-I{}` `-0` `-P`）、`find | xargs`
- Boss：在 10 萬行日誌與巢狀專案中定位洩漏的 API key

## 階段 4　文字處理與管線 — 「Unix 的靈魂」
`wc sort uniq cut tr paste join tee column nl rev fold diff comm sed awk jq`
- 重導向 `> >> < 2> 2>&1 &> /dev/null`、管線 `|`、`tee`、here-doc / here-string
- `sort -n -r -k -t -u`、`uniq -c -d`、`cut -d -f`、`tr -d -s`
- `sed`：`s///g`、`-n 'p'`、`-i`、行定址、`d`、`y`
- `awk`：欄位、`-F`、`BEGIN/END`、條件、累加、`printf`
- `jq` 取 JSON、`diff -u`、`comm`
- 正規表達式：BRE / ERE
- Boss：分析 web access log，找出最常訪問的 IP、錯誤率、每小時流量

## 階段 5　權限與使用者 — 「誰能進哪間艙」
`id whoami groups chmod chown chgrp umask sudo su useradd usermod userdel groupadd passwd getent getfacl setfacl visudo`
- `rwx` 符號與八進位，目錄的 `x` 的意義
- setuid / setgid / sticky bit
- `/etc/passwd`、`/etc/group`、`/etc/shadow`、`/etc/sudoers`
- ACL
- Boss：為一個多人團隊配置共享目錄（新檔案自動繼承群組、他人不可刪除）

## 階段 6　程序與資源 — 「引擎室」
`ps pgrep pkill kill killall top htop jobs bg fg & nohup nice renice lsof time watch uptime free vmstat sleep wait timeout disown`
- 訊號：`SIGTERM SIGKILL SIGHUP SIGSTOP SIGCONT`，`trap`
- 前景 / 背景 / 工作控制
- `/proc` 初探
- Boss：一個暴走的程序吃光 CPU 並擋住 port，找出並優雅處理

## 階段 7　系統管理 — 「維運值班」
`tar gzip gunzip bzip2 xz zip unzip rsync dd mount umount lsblk blkid fdisk(唯讀) cron crontab at systemctl journalctl dmesg apt dpkg env export printenv source alias ulimit logrotate lsmod`
- 打包壓縮：`tar -czf / -xzf / -tf`、`zip`、`xz`
- 環境變數、`PATH`、`~/.bashrc` vs `~/.profile`、`alias`
- 套件管理：`apt` / `dpkg`
- 排程：`cron` 語法、`at`
- 服務：`systemctl status/start/stop/enable`、`journalctl -u -f --since`（容器內使用**模擬 init**，指令介面與真實一致）
- 日誌：`/var/log`、`dmesg`、`logrotate`
- Boss：還原一台「昨晚備份失敗」的伺服器：修 cron、修權限、補備份、驗證

## 階段 8　Shell 腳本 — 「自動化」
`bash [[ ]] if/elif/for/while/until/case function read getopts local declare set shift source printf test`
- shebang、`chmod +x`、`$? $# $@ $* $$ $!`
- 參數展開 `${var:-d} ${var#pat} ${var%pat} ${var//a/b} ${#var}`
- 陣列、關聯陣列、command / process substitution
- `set -euo pipefail`、`trap ... EXIT`、`getopts`、`shellcheck`
- Boss：寫出一支具備選項解析、錯誤處理、日誌輸出的備份腳本

## 階段 9　網路 — 「通訊官」
`ip addr/route/link ping traceroute ss netstat curl wget dig nslookup host nc ssh ssh-keygen scp rsync iptables nft tcpdump openssl telnet /etc/hosts /etc/resolv.conf`
- 位址、路由、DNS 解析流程
- `ss -tulpn`、誰在聽哪個 port
- `curl`：`-I -L -o -X -H -d -s -w`、REST 與 JSON（搭 `jq`）
- SSH：金鑰、`~/.ssh/config`、`-L/-R/-D` 隧道、`scp`、`rsync`
- 防火牆基礎、`tcpdump` 抓封包
- Boss：網站打不開——DNS？路由？防火牆？服務沒起？逐層排查

## 階段 10　編輯器與開發工具 — 「工匠」
`nano vim tmux screen git make diff patch watch bc python3 -c`
- `vim`：模式、移動、編輯、搜尋取代、儲存離開（自動檢查檔案結果）
- `tmux`：session / window / pane
- `git`：`init add commit status log diff branch checkout merge stash`
- `make`、`patch`
- Boss：從零建立專案、提交、分支、解決衝突

## 階段 11　精通 — 「大師之路」
`strace ltrace lsof perf-lite ldd nm objdump od hexdump xxd strings /proc /sys cgroups unshare chroot namespaces`
- 效能排查：誰在吃 CPU / 記憶體 / I/O / 檔案描述符
- `strace` 追系統呼叫，找出「為什麼打不開那個檔案」
- `/proc` 與 `/sys` 探索
- 進階管線、`xargs -P`、`parallel`、process substitution
- 安全強化：SSH 加固、最小權限、審計
- Command Golf、速通、**整座壞掉的伺服器**
- 最終 Boss：多重故障事故應變（資源耗盡 + 權限錯誤 + 服務掛掉 + 磁碟滿 + 網路異常）

---

## 指令覆蓋檢查表

每個指令至少有一關「必用」。`bun src/cli.ts coverage` 讀取所有關卡的 `teaches` 欄位，列出課程地圖裡尚未覆蓋的指令。

目前 **173 個指令已覆蓋 154 個**。其餘 19 個刻意不做，原因都是學習容器的限制，而不是遺漏：

| 指令 | 原因 |
|---|---|
| `dig` `host` `nslookup` | 容器沒有外網，也沒有 DNS 伺服器可查。名稱解析改用 `/etc/hosts` 與 `getent` 練習 |
| `unshare` `chroot` `namespaces` `cgroups` | 需要 `CAP_SYS_ADMIN` 等高權限，而學習容器刻意不給特權 |
| `mount`（寫入）`umount` `blkid` `lsmod` `dmesg` | 同上，且容器沒有真實的區塊裝置與核心模組。`mount` 與 `df -T` 的查詢用法已涵蓋 |
| `nft` | 容器使用 `iptables` 後端，已涵蓋防火牆概念 |
| `perf-lite` `ltrace` | 沒有穩定可驗證的輸出；`strace` 已涵蓋系統呼叫追蹤 |
| `screen` | 功能與 `tmux` 重疊，已用 `tmux` 涵蓋 |
| `telnet` | 以 `nc` 涵蓋（用途相同：手動連到 TCP 埠） |
| `egrep` `disown` `watch` | 互動式或已被取代的用法（`grep -E`、工作控制的 `bg`/`fg`/`nohup`），無法用結果狀態可靠判定 |

## 關於模擬的部分

- `systemctl` 與 `journalctl` 是介面一致的**模擬 init**（容器內沒有真的 systemd）。執行 `systemctl --version` 會誠實說明。
- 所有網路練習都在 `localhost`（本機迴路）完成，包含本機 `sshd`（127.0.0.1:2222）、`iptables`、`tcpdump`。
