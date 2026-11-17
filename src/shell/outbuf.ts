import { stringWidth } from '../hud/ink'

// 輕量的終端輸出緩衝：把 PTY 吐出的位元組流整理成「行」，保留 SGR 顏色碼，
// 處理 \r（覆寫同一行，進度條常用）、\t、清行；其餘控制序列一律丟棄。

const MAX_LINES = 4000

const stripSgr = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

export class OutBuf {
  lines: string[] = []
  cur = ''
  dropped = 0
  private pendingCR = false
  private esc = '' // 尚未收完的跳脫序列

  write(text: string): void {
    const t = this.esc + text
    this.esc = ''
    for (let i = 0; i < t.length; i++) {
      const c = t[i]!
      if (c === '\x1b') {
        const rest = t.slice(i)
        const n = this.consumeEscape(rest)
        if (n === 0) {
          this.esc = rest // 序列被切斷，留到下一塊
          return
        }
        i += n - 1
        continue
      }
      if (c === '\n') {
        this.pushLine()
        continue
      }
      if (c === '\r') {
        this.pendingCR = true
        continue
      }
      if (c === '\x07' || c < ' ') {
        if (c === '\t') this.putChar(' '.repeat(8 - (stringWidth(stripSgr(this.cur)) % 8)))
        continue
      }
      this.putChar(c)
    }
  }

  private putChar(s: string): void {
    if (this.pendingCR) {
      this.cur = ''
      this.pendingCR = false
    }
    this.cur += s
  }

  private pushLine(): void {
    this.lines.push(this.cur)
    this.cur = ''
    this.pendingCR = false
    if (this.lines.length > MAX_LINES) {
      const over = this.lines.length - MAX_LINES
      this.lines.splice(0, over)
      this.dropped += over
    }
  }

  /** 回傳消耗的字元數；0 代表序列不完整。 */
  private consumeEscape(s: string): number {
    if (s.length < 2) return 0
    const k = s[1]!
    if (k === '[') {
      const m = /^\x1b\[[0-?]*[ -/]*[@-~]/.exec(s)
      if (!m) return s.length > 32 ? 1 : 0
      const seq = m[0]
      const final = seq[seq.length - 1]
      if (final === 'm') {
        this.cur += seq
      } else if (final === 'K') {
        const p = seq.slice(2, -1)
        if (p === '2' || (p === '' && this.pendingCR)) {
          this.cur = ''
          this.pendingCR = false
        }
      }
      return seq.length
    }
    if (k === ']') {
      const m = /^\x1b\][^\x07\x1b]*(\x07|\x1b\\)/.exec(s)
      if (!m) return s.length > 512 ? 1 : 0
      return m[0].length
    }
    if (k === '(' || k === ')') return s.length >= 3 ? 3 : 0
    return 2
  }

  /** 目前所有行（含尚未換行的最後一行）。 */
  snapshot(): string[] {
    return this.cur ? [...this.lines, this.cur] : [...this.lines]
  }
}
