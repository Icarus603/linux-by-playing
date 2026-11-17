#!/bin/bash
# 以 root 啟動，整理存檔目錄後降權成 player 進入遊戲。
set -e
mkdir -p /save
# --network none 時 docker 不會把主機名稱寫進 /etc/hosts，sudo 每次都會警告 unable to resolve host
h=$(hostname)
grep -qw "$h" /etc/hosts 2>/dev/null || echo "127.0.0.1 $h" >> /etc/hosts
chown player:player /save
export TERM="${TERM:-xterm-256color}" LANG=C.UTF-8 LC_ALL=C.UTF-8
exec setpriv --reuid=player --regid=player --init-groups \
  env HOME=/home/player USER=player LOGNAME=player SHELL=/bin/bash "$@"
