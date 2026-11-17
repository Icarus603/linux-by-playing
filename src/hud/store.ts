// 紀錄區的資料模型。與 React 解耦：控制器寫入，UI 以 useSyncExternalStore 訂閱。

export type Entry =
  | {
      id: number
      kind: 'cmd'
      cwd: string
      cmd: string
      lines: string[]
      dropped: number
      stdin: string[]
      done: boolean
      rc: number | null
    }
  | { id: number; kind: 'note'; text: string; tone: 'dim' | 'warn' | 'err' | 'ok' }
  | { id: number; kind: 'list'; text: string }
  /** 自然語言對話：who = 使用者 / Pip；Pip 的串流回答會就地更新 text */
  | { id: number; kind: 'say'; who: 'you' | 'pip'; text: string; tone: 'ok' | 'info' | 'plain'; streaming: boolean }

export type NewEntry = Entry extends infer E ? (E extends { id: number } ? Omit<E, 'id'> : never) : never

export class Store {
  entries: Entry[] = []
  version = 0
  private nextId = 1
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | null = null

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  getVersion = (): number => this.version

  push(e: NewEntry): Entry {
    const entry = { ...e, id: this.nextId++ } as Entry
    this.entries.push(entry)
    this.touch()
    return entry
  }

  clear(): void {
    this.entries = []
    this.touch()
  }

  /** 合併高頻更新（指令輸出），最多每 ~16ms 通知一次。 */
  touch(): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.version++
      for (const l of this.listeners) l()
    }, 16)
  }
}
