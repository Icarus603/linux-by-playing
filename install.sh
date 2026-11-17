#!/usr/bin/env bash
# 安裝「Linux 冒險：Kernel-7」：需要 Docker（建議 OrbStack / Docker Desktop）。
#   curl -fsSL https://raw.githubusercontent.com/Icarus603/linux-by-playing/main/install.sh | bash
set -euo pipefail
REPO=Icarus603/linux-by-playing
DEST="${LBP_BIN_DIR:-$HOME/.local/bin}"
command -v docker >/dev/null 2>&1 || { echo "找不到 docker。請先安裝 Docker（macOS 建議 OrbStack：https://orbstack.dev）。" >&2; exit 1; }
docker info >/dev/null 2>&1 || { echo "docker 沒有在執行，請先啟動 Docker。" >&2; exit 1; }
mkdir -p "$DEST"
curl -fsSL "https://raw.githubusercontent.com/$REPO/main/scripts/play" -o "$DEST/lbp-play"
chmod +x "$DEST/lbp-play"
echo "下載遊戲映像（約 3GB，含本機小模型）…"
docker pull "ghcr.io/icarus603/linux-by-playing:latest"
echo
echo "安裝完成：$DEST/lbp-play"
case ":$PATH:" in *":$DEST:"*) ;; *) echo "提示：把 $DEST 加進 PATH 後即可直接輸入 lbp-play。" ;; esac
echo "開始遊玩：lbp-play    更新：lbp-play update    重置進度：lbp-play reset"
