# 玩家的 shell 設定（由遊戲的 PTY 常駐啟動）。
# 輸入框由遊戲 UI 提供，所以這裡關掉回顯與提示字元，改在每次指令結束時送出一個不可見的標記，
# 讓遊戲知道「指令結束了」以及結束碼與目前目錄。
[[ $- != *i* ]] && return

export LBP_SAVE=/save
export EDITOR=nano
export HISTSIZE=10000
shopt -s histappend checkwinsize
HISTCONTROL=

alias ls='ls --color=auto'
alias grep='grep --color=auto'

__lbp_marker() {
  printf '\033]777;lbp;rc=%s;cwd=%s\007' "$?" "$PWD"
}
PROMPT_COMMAND=__lbp_marker
PS1=''
PS2=''
stty -echo 2>/dev/null

cd ~
