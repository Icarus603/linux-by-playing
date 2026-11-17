#!/usr/bin/env bash
# 安裝「Linux 冒險：Kernel-7」，之後輸入 playnux 就能開玩。需要 git 與 Docker（macOS 建議 OrbStack）。
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/linux-by-playing/main/install.sh | bash
set -euo pipefail
REPO=https://github.com/Icarus603/linux-by-playing.git
DIR="${LBP_HOME:-$HOME/.local/share/playnux}"
BIN="${LBP_BIN_DIR:-$HOME/.local/bin}"
command -v git >/dev/null 2>&1 || { echo "找不到 git。" >&2; exit 1; }
command -v docker >/dev/null 2>&1 || { echo "找不到 docker。請先安裝 Docker（macOS 建議 OrbStack：https://orbstack.dev）。" >&2; exit 1; }
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull --ff-only; else git clone --depth 1 "$REPO" "$DIR"; fi
mkdir -p "$BIN"
ln -sf "$DIR/scripts/play" "$BIN/playnux"
echo "安裝完成：$BIN/playnux"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "提示：請把 $BIN 加進 PATH。" ;; esac
echo "輸入 playnux 開始（第一次會自動建置映像，約十幾分鐘）；playnux update 更新；playnux reset 重置進度。"
