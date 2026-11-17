// 常駐的真實 bash（跑在 PTY 裡）。
//
// 做法：bash 以 --noediting 啟動、關閉 tty 回顯、PS1/PS2 清空，並在每次回到提示字元前
// 印出一個不可見的 OSC 標記 `ESC ] 777 ; lbp ; rc=<狀態碼> ; cwd=<目錄> BEL`。
// 我們靠這個標記知道「指令結束了」以及結束後的 cwd 與結束碼。
//
// 兩種模式：
//   capture     — 輸出被擷取進紀錄區（可上色、可換行）
//   passthrough — 偵測到全螢幕程式（less/vim/top…，會進入 alt screen）時，
//                 原始位元組直接轉給真實終端，直到下一個標記出現為止。

const MARK_START = '\x1b]777;lbp;'
const MARK_END = '\x07'
const ALT_ENTER = /\x1b\[\?(?:1049|1047|47)h/

export type PromptInfo = { rc: number; cwd: string }

export type ShellHandlers = {
  /** capture 模式：一段輸出（含 ANSI） */
  output(text: string): void
  /** passthrough 模式：原始輸出，直接寫到真實終端 */
  raw(text: string): void
  /** 指令結束，shell 回到提示字元 */
  prompt(info: PromptInfo): void
  /** 模式切換 */
  mode(m: 'capture' | 'passthrough'): void
  exit(code: number): void
}

export class PtyShell {
  private proc: ReturnType<typeof Bun.spawn> | null = null
  private dec = new TextDecoder()
  private buf = ''
  mode: 'capture' | 'passthrough' = 'capture'

  constructor(
    private h: ShellHandlers,
    private opts: { rcfile: string; cwd: string; cols: number; rows: number },
  ) {}

  start(): void {
    const self = this
    this.proc = Bun.spawn(['bash', '--noediting', '--rcfile', this.opts.rcfile, '-i'], {
      cwd: this.opts.cwd,
      env: { ...process.env, TERM: 'xterm-256color', COLUMNS: String(this.opts.cols), LINES: String(this.opts.rows) },
      terminal: {
        cols: this.opts.cols,
        rows: this.opts.rows,
        data(_t: unknown, d: Uint8Array) {
          self.onData(self.dec.decode(d, { stream: true }))
        },
      },
      onExit: (_p: unknown, code: number | null) => this.h.exit(code ?? 0),
    } as never)
  }

  private get term(): { write(s: string | Uint8Array): void; resize(c: number, r: number): void } {
    return (this.proc as unknown as { terminal: never }).terminal
  }

  write(s: string): void {
    this.term.write(s)
  }

  resize(cols: number, rows: number): void {
    this.term.resize(cols, rows)
  }

  kill(): void {
    try {
      this.proc?.kill()
    } catch {}
  }

  /** 找出 buf 尾端「可能是標記開頭、但還不完整」的位置，先留著等下一塊資料。 */
  private holdFrom(s: string): number {
    const i = s.lastIndexOf('\x1b')
    if (i < 0) return s.length
    const tail = s.slice(i)
    if (MARK_START.startsWith(tail)) return i // 只收到標記的前半段
    if (tail.startsWith(MARK_START) && !tail.includes(MARK_END)) return i // 標記內容還沒收完
    return s.length
  }

  private onData(chunk: string): void {
    this.buf += chunk
    for (;;) {
      const mk = this.buf.indexOf(MARK_START)
      const end = mk >= 0 ? this.buf.indexOf(MARK_END, mk) : -1
      const complete = mk >= 0 && end >= 0
      const body = complete ? this.buf.slice(mk + MARK_START.length, end) : ''

      if (this.mode === 'capture') {
        const alt = ALT_ENTER.exec(this.buf)
        const altAt = alt ? alt.index : -1
        if (complete && (altAt < 0 || mk < altAt)) {
          this.emit(this.buf.slice(0, mk))
          this.buf = this.buf.slice(end + 1)
          this.h.prompt(parseMark(body))
          continue
        }
        if (altAt >= 0) {
          this.emit(this.buf.slice(0, altAt))
          this.buf = this.buf.slice(altAt)
          this.mode = 'passthrough'
          this.h.mode('passthrough')
          continue
        }
        const cut = this.holdFrom(this.buf)
        this.emit(this.buf.slice(0, cut))
        this.buf = this.buf.slice(cut)
        return
      }

      // passthrough：原樣轉給真實終端，直到下一個標記
      if (complete) {
        this.h.raw(this.buf.slice(0, mk))
        this.buf = this.buf.slice(end + 1)
        this.mode = 'capture'
        this.h.mode('capture')
        this.h.prompt(parseMark(body))
        continue
      }
      const cut = this.holdFrom(this.buf)
      this.h.raw(this.buf.slice(0, cut))
      this.buf = this.buf.slice(cut)
      return
    }
  }

  private emit(text: string): void {
    if (text) this.h.output(text)
  }
}

export function parseMark(body: string): PromptInfo {
  const rc = /rc=(-?\d+)/.exec(body)
  const cwd = /cwd=(.*)$/.exec(body)
  return { rc: rc ? Number(rc[1]) : 0, cwd: cwd ? cwd[1]! : '' }
}
