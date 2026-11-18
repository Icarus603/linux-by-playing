import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ERR, HINT_OK, continueGame, goto, resetProgress, hint, nextLevelCmd, prevLevel, resetLevel, skip, stripMark, tick } from '../engine/game'
import { badgeName, BADGES } from '../engine/badges'
import { loadCatalog, stageOf } from '../engine/levels'
import { SAVE_DIR, loadState, rankOf } from '../engine/state'
import type { GameEvent, State } from '../engine/types'
import { setClipboard } from './ink'
import { type Activity, ask as askPip, resetChat, warmup as warmupLlm } from '../ask/answer'
import { warmKb } from '../ask/kb'
import { isNaturalLanguage } from '../ask/route'
import { OutBuf } from '../shell/outbuf'
import { PtyShell, type PromptInfo } from '../shell/ptyshell'
import type { PipPose } from './Pip'
import { PRAISE } from './theme'
import { SLASH_NAMES, runSlash } from './slash'
import { Store, type Entry } from './store'
import { LANGS, currentLang, setLang, t, tr, trFeedback, type Lang } from '../i18n'

const RC = process.env.LBP_RC ?? '/game/player.bashrc'
const HOME = '/home/player'
const HISTORY_FILE = join(SAVE_DIR, 'history')
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

type CmdEntry = Extract<Entry, { kind: 'cmd' }>

export type Speech = {
  id: number
  text: string
  pose: PipPose
  tone: 'ok' | 'info' | 'plain'
  /** 每個 tick 多打幾個字（長文字加速） */
  step: number
  tickMs: number
  /** 說話開始的時間，以及要跳舞多久（毫秒） */
  startedAt: number
  danceMs: number
  /** 模型仍在串流產生文字：即使打字追上了目前的文字也不要當成講完 */
  streaming?: boolean
}
type Msg = { text: string; pose: PipPose; tone: Speech['tone']; level?: string | null; danceMs?: number }

export class Controller {
  store = new Store()
  shell!: PtyShell
  cwd = HOME
  game: State = loadState()
  history: string[] = []
  running: CmdEntry | null = null
  quit = false
  ready = false
  /** 使用者正在捲動：暫停頂部 Pip 的動畫，把重繪留給捲動 */
  scrolling = false
  private scrollTimer: ReturnType<typeof setTimeout> | null = null
  /** 正在回答自然語言問題（頂部的 Pip 會做出思考／說話的樣子） */
  answering = false
  /** Pip 目前說的話（固定位置、打字機效果） */
  speech: Speech | null = null
  /** 語言選單（第一次啟動一定會出現；之後用 /language） */
  langPickerOpen = false
  langSel = 0
  langFirst = false
  private pendingBoot: (() => void) | null = null
  /** 關卡選單 */
  pickerOpen = false
  /** 短暫的狀態訊息（例如「已複製 N 字」） */
  flashText = ''
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  pickerSel = 0
  /** 任務卡目前顯示的關卡 */
  displayLevel: string | null = null

  private queue: Msg[] = []
  private failCount = 0
  private askAbort: AbortController | null = null
  private levelShownAt = Date.now()
  private lastActivity = Date.now()
  private nudged = new Set<string>()
  private speechTimer: ReturnType<typeof setTimeout> | null = null
  private speechId = 0
  private answerEntry: Extract<Entry, { kind: 'say' }> | null = null
  private booting = true

  private ob: OutBuf | null = null
  private hidden = 0
  private lastEventAt = 0
  private lastFeedback = ''
  private rawActive = false
  private rawBuf: string[] = []
  private endPass: (() => void) | null = null
  private switchWaiters: Array<(r: 'passthrough' | 'quit') => void> = []
  private pendingSwitch: 'passthrough' | 'quit' | null = null
  private listeners = new Set<() => void>()

  // ---- 狀態訂閱（輸入框的「忙碌」狀態、cwd、XP 等） ----
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private changed(): void {
    this.snapshotVersion++
    for (const l of this.listeners) l()
  }
  snapshotVersion = 0
  getSnapshot = (): number => this.snapshotVersion

  get busy(): boolean {
    return !this.ready || this.running !== null || this.hidden > 0
  }

  // ---- 啟動 ----
  start(): void {
    this.loadHistory()
    setInterval(() => this.checkStuck(), 5000).unref?.()
    const cols = process.stdout.columns || 100
    const rows = process.stdout.rows || 30
    this.shell = new PtyShell(
      {
        output: (t) => this.onOutput(t),
        raw: (t) => this.onRaw(t),
        prompt: (i) => this.onPrompt(i),
        mode: (m) => this.onMode(m),
        exit: () => this.shutdown(),
      },
      { rcfile: RC, cwd: HOME, cols: Math.max(20, cols - 4), rows },
    )
    this.shell.start()
  }

  flash(text: string, ms = 2200): void {
    this.flashText = text
    this.changed()
    if (this.flashTimer) clearTimeout(this.flashTimer)
    this.flashTimer = setTimeout(() => {
      this.flashText = ''
      this.flashTimer = null
      this.changed()
    }, ms)
  }

  /** 以 OSC 52 寫入系統剪貼簿（終端機需允許，Ghostty / iTerm2 / kitty 預設支援）。 */
  async copyToClipboard(text: string): Promise<void> {
    const raw = await setClipboard(text)
    if (raw) process.stdout.write(raw)
  }

  refresh(): void {
    this.game = loadState()
    this.changed()
  }

  /** 卡關偵測：很久沒進展，或連續答錯多次，Pip 主動關心一次。 */
  private checkStuck(): void {
    const id = this.game.current
    if (!this.ready || this.quit || this.running || !id || this.nudged.has(id) || this.speechTimer) return
    const idle = Date.now() - Math.max(this.lastActivity, this.levelShownAt)
    if (idle < 100_000 && this.failCount < 3) return
    this.nudged.add(id)
    this.speak([
      {
        text: this.game.hard
          ? t('卡住了嗎？困難模式沒有提示，不過 /explain 還是可以問我，實在不行就 /skip。')
          : t('卡住了嗎？別急。輸入 /hint 看提示（會少拿一點 XP），或 /explain 讓我解釋這關用到的指令。'),
        pose: 'worry',
        tone: 'plain',
      },
    ])
  }

  shutdown(): void {
    if (this.quit) return
    this.quit = true
    this.shell?.kill()
    this.flushSwitch('quit')
    this.changed()
  }

  setSize(cols: number, rows: number): void {
    if (this.shell && this.shell.mode === 'capture') this.shell.resize(Math.max(20, cols - 4), rows)
  }

  // ---- shell 事件 ----
  private onOutput(text: string): void {
    if (this.hidden > 0 || !this.running || !this.ob) return
    this.ob.write(text)
    this.running.lines = this.ob.snapshot()
    this.running.dropped = this.ob.dropped
    this.store.touch()
  }

  private onRaw(text: string): void {
    if (this.rawActive) process.stdout.write(text)
    else this.rawBuf.push(text)
  }

  private onMode(m: 'capture' | 'passthrough'): void {
    if (m === 'passthrough') this.flushSwitch('passthrough')
    else this.endPass?.()
  }

  private onPrompt(info: PromptInfo): void {
    this.cwd = info.cwd || this.cwd
    if (this.hidden > 0) {
      this.hidden--
      this.changed()
      return
    }
    if (!this.ready) {
      this.ready = true
      setTimeout(() => void warmupLlm(), 6000).unref?.()
      setTimeout(() => warmKb(), 2500).unref?.()
      const boot = (): void => {
        this.welcome()
        this.afterCommand('', info)
        this.changed()
      }
      if (currentLang() === null) {
        // 第一次啟動：先選語言，選完才開始遊戲
        this.pendingBoot = boot
        this.openLangPicker(true)
        return
      }
      boot()
      return
    }
    const e = this.running
    if (!e) return
    const lines = this.ob?.snapshot() ?? []
    while (lines.length && lines[lines.length - 1]!.replace(/\x1b\[[0-9;]*m/g, '').trim() === '') lines.pop()
    e.lines = lines
    e.done = true
    e.rc = info.rc
    this.running = null
    this.ob = null
    this.store.touch()
    this.afterCommand(e.cmd, info)
    this.changed()
  }

  // ---- 提交 ----
  submit(raw: string): void {
    if (this.quit) return
    if (this.running) {
      this.running.stdin.push(raw)
      this.shell.write(raw + '\n')
      this.store.touch()
      return
    }
    const line = raw.trim()
    if (!line || !this.ready) return
    this.addHistory(raw)

    this.lastActivity = Date.now()
    if (this.guard(line)) return

    // 以 / 開頭且第一段不含 /（避免誤吃 /bin/ls 這類絕對路徑）的是遊戲指令
    const multi = line.includes('\n')
    const sl = multi ? null : /^\/([A-Za-z]+)(?:\s+(.*))?$/.exec(line)
    if (sl) return this.slash(sl[1]!.toLowerCase(), (sl[2] ?? '').trim())
    // 沿用的裸字指令
    const bare = multi ? null : /^(hint|skip|restart|levels|help|clear|exit|quit|goto\s+\S+)$/.exec(line)
    if (bare) {
      const [c, ...r] = line.split(/\s+/)
      return this.slash(c!, r.join(' '))
    }
    // 一般模式一律是 shell 指令；自然語言要先輸入 ! 進入聊天模式。看起來像在聊天時，Pip 提醒一下
    if (!multi && isNaturalLanguage(line)) {
      this.speak([{ text: t('看起來你是想跟我聊天？先輸入 ! 進入聊天模式（輸入框會變藍色），再用自然語言問我；Esc 回到指令模式。'), pose: 'think', tone: 'info' }])
      return
    }

    this.ob = new OutBuf()
    this.running = this.store.push({
      kind: 'cmd',
      cwd: this.cwd,
      cmd: raw,
      lines: [],
      dropped: 0,
      stdin: [],
      done: false,
      rc: null,
    }) as CmdEntry
    // 多行輸入當成「一次完整的執行」：寫進暫存檔再 source，
    // 這樣只會產生一個「指令結束」標記，heredoc / cd / 函式定義也都照常運作。
    let toSend = raw
    if (raw.includes('\n')) {
      const f = '/tmp/.lbp-paste'
      writeFileSync(f, raw + '\n')
      toSend = `. ${f}`
    }
    this.shell.write(toSend + '\n')
    this.changed()
  }

  /** 攔下會毀掉容器的指令，並對幾個彩蛋有反應。回傳 true 代表已攔截。 */
  private guard(line: string): boolean {
    const danger =
      (/(^|[\s;&|])rm\s/.test(line) && /\s-[a-zA-Z]*[rR]/.test(line) && /\s(\/|\/\*|~\/?|\$HOME\/?\*?|--no-preserve-root)(\s|$)/.test(line)) ||
      /:\(\)\s*\{/.test(line) ||
      /\bdd\b.*of=\/dev\/(sd|nvme|vd|mmc)/.test(line) ||
      /\bmkfs/.test(line) ||
      /chmod\s+-R\s+\S+\s+\/(\s|$)/.test(line)
    if (danger) {
      this.store.push({ kind: 'note', text: t`✋ Pip 攔下了：${line}`, tone: 'warn' })
      this.speak([
        {
          text: t('等等等等！！這個指令會把整個空間站（的檔案系統）一起刪光。我先幫你攔下來了。\n真正的管理員會先 ls 看清楚、再動手。'),
          pose: 'worry',
          tone: 'plain',
        },
      ])
      return true
    }
    if (/^\s*sudo\s+make\s+me\s+a\s+sandwich/i.test(line)) {
      this.speak([{ text: t('好吧，這次有 sudo，我破例！（企鵝遞來一個三明治）'), pose: 'happy', tone: 'ok' }])
    }
    return false
  }

  interrupt(): void {
    if (this.running) this.shell.write('\x03')
  }
  eof(): void {
    if (this.running) this.shell.write('\x04')
    else this.farewell()
  }
  suspend(): void {
    if (this.running) this.shell.write('\x1a')
  }

  // ---- 遊戲指令（在程序內處理，不經過 bash；回應都由 Pip 說出）----
  private slash(name: string, arg: string): void {
    const s = this.store
    switch (name) {
      case 'exit':
      case 'quit':
        this.farewell()
        return
      case 'clear':
        s.clear()
        return
      case 'hint': {
        const msg = hint()
        if (!msg.startsWith(HINT_OK)) this.speak([{ text: stripMark(msg), pose: 'idle', tone: 'plain' }])
        this.afterCommand('', null)
        return
      }
      case 'ask':
        if (!arg) this.speak([{ text: t('想問什麼？直接輸入問題就好，例如：怎麼找檔案？或 /ask grep 怎麼用。我會根據我的資料庫回答。'), pose: 'idle', tone: 'plain' }])
        else this.ask(arg)
        return
      case 'levels':
        this.openPicker()
        return
      case 'reset': {
        if (arg.toLowerCase() !== 'confirm') {
          this.speak([
            {
              text: t('這會清除所有進度：經驗值、等級、徽章、日誌碎片、連勝，並回到第 1 關。這個動作無法復原。\n確定的話，請輸入 /reset confirm。'),
              pose: 'worry',
              tone: 'plain',
            },
          ])
          return
        }
        const msg = resetProgress()
        this.nudged.clear()
        this.lastEventAt = 0
        this.lastFeedback = ''
        this.booting = false
        if (msg.startsWith(ERR)) this.speak([{ text: stripMark(msg), pose: 'worry', tone: 'plain' }])
        else this.afterCommand('', null, true)
        return
      }
      case 'prev':
      case 'next':
      case 'continue':
      case 'skip':
      case 'restart':
      case 'goto': {
        if (name === 'goto' && !arg) {
          this.openPicker()
          return
        }
        const msg =
          name === 'skip' ? skip()
          : name === 'restart' ? resetLevel()
          : name === 'prev' ? prevLevel()
          : name === 'next' ? nextLevelCmd()
          : name === 'continue' ? continueGame()
          : goto(arg)
        if (msg.startsWith(ERR)) this.speak([{ text: stripMark(msg), pose: 'worry', tone: 'plain' }])
        else this.afterCommand('', null, true)
        return
      }
    }
    if (runSlash(this, name, arg)) return
    const near = SLASH_NAMES.filter((n) => n.startsWith(name.slice(0, 2)))[0]
    this.speak([
      {
        text: t`我不認識 /${name}。${near ? t`你是想輸入 /${near} 嗎？` : ''}輸入 /help 可以看我會的所有指令。`,
        pose: 'worry',
        tone: 'plain',
      },
    ])
  }

  // ---- 語言選單 ----
  openLangPicker(first = false): void {
    this.langFirst = first
    this.langSel = Math.max(0, LANGS.findIndex((l) => l.code === currentLang()))
    this.langPickerOpen = true
    this.changed()
  }
  moveLang(d: number): void {
    this.langSel = (this.langSel + d + LANGS.length) % LANGS.length
    this.changed()
  }
  closeLang(): void {
    if (this.langFirst) return // 第一次啟動必須選一個
    this.langPickerOpen = false
    this.changed()
  }
  pickLang(): void {
    this.setLanguage(LANGS[this.langSel]!.code)
  }
  /** 切換語言：存檔、清掉對話歷史、讓模型預熱新語言的提示詞，Pip 用新語言確認。 */
  setLanguage(code: Lang): void {
    const first = this.langFirst
    setLang(code)
    resetChat()
    void warmupLlm()
    this.langPickerOpen = false
    this.langFirst = false
    const ok = code === 'en' ? 'Switched to English.' : code === 'zh-CN' ? '已切换为简体中文。' : '已切換為繁體中文。'
    if (first && this.pendingBoot) {
      const b = this.pendingBoot
      this.pendingBoot = null
      b()
      return
    }
    this.speak([{ text: ok, pose: 'happy', tone: 'ok' }])
    this.changed()
  }

  // ---- 關卡選單 ----
  openPicker(): void {
    const cat = loadCatalog()
    const i = cat.levels.findIndex((l) => l.id === this.game.current)
    this.pickerSel = Math.max(0, i)
    this.pickerOpen = true
    this.speak([{ text: t('想去哪一關？用 ↑↓ 選擇，←→ 跳階段，Enter 前往。已完成的關卡可以重玩，不會重複計 XP。'), pose: 'idle', tone: 'plain' }])
    this.changed()
  }
  closePicker(): void {
    this.pickerOpen = false
    this.changed()
  }
  movePicker(d: number): void {
    const n = loadCatalog().levels.length
    this.pickerSel = Math.max(0, Math.min(n - 1, this.pickerSel + d))
    this.changed()
  }
  /** 跳到上一個／下一個階段的第一關。 */
  movePickerStage(dir: 1 | -1): void {
    const cat = loadCatalog()
    const cur = cat.levels[this.pickerSel]
    if (!cur) return
    const st = stageOf(cur)
    const target = dir === 1 ? st + 1 : this.pickerSel > cat.levels.findIndex((l) => stageOf(l) === st) ? st : st - 1
    const idx = cat.levels.findIndex((l) => stageOf(l) === target)
    if (idx >= 0) {
      this.pickerSel = idx
      this.changed()
    }
  }
  pickPicker(): void {
    const l = loadCatalog().levels[this.pickerSel]
    this.pickerOpen = false
    this.changed()
    if (l) this.slash('goto', l.id)
  }

  // ---- 問 Pip：RAG 檢索 + 本機小模型，答案串流顯示在 Pip 的對話框 ----
  private showAnswer(text: string, tone: Speech['tone'], fresh: boolean, streaming = false): void {
    if (fresh || !this.answerEntry) {
      this.answerEntry = this.store.push({ kind: 'say', who: 'pip', text, tone, streaming }) as Extract<Entry, { kind: 'say' }>
    } else {
      this.answerEntry.text = text
      this.answerEntry.tone = tone
      this.answerEntry.streaming = streaming
      this.store.touch()
    }
    this.answering = streaming
    this.changed()
  }

  ask(q: string): void {
    this.askAbort?.abort()
    // 上一個被中止的回答不會再收到 done：在這裡停掉它的閃爍
    if (this.answerEntry) this.answerEntry.streaming = false
    this.answerEntry = null
    const ac = new AbortController()
    this.askAbort = ac
    this.store.push({ kind: 'say', who: 'you', text: q, tone: 'plain', streaming: false })
    void askPip(
      q,
      {
        begin: (t) => this.showAnswer(t, 'info', true, true),
        update: (t) => !ac.signal.aborted && this.showAnswer(t, 'info', false, true),
        done: (t, src) => {
          if (ac.signal.aborted) return
          this.showAnswer(t, src === 'unsure' ? 'plain' : 'info', false)
        },
      },
      ac.signal,
      this.recentActivity(),
    ).catch((e) => {
      if (!ac.signal.aborted) this.showAnswer(t`查資料時出了點問題：${String(e).slice(0, 60)}`, 'plain', false)
    })
  }

  noteScroll(): void {
    if (!this.scrolling) {
      this.scrolling = true
      this.changed()
    }
    if (this.scrollTimer) clearTimeout(this.scrollTimer)
    this.scrollTimer = setTimeout(() => {
      this.scrolling = false
      this.scrollTimer = null
      this.changed()
    }, 350)
  }

  /** 最近執行過的指令與輸出（供 Pip 回答時當上下文）。 */
  private recentActivity(): Activity[] {
    const out: Activity[] = []
    for (const e of this.store.entries) {
      if (e.kind === 'cmd' && (e.done || e === this.running)) out.push({ cwd: e.cwd, cmd: e.cmd, out: e.lines, rc: e.rc })
    }
    return out.slice(-12)
  }

  lastCmd(): CmdEntry | undefined {
    for (let i = this.store.entries.length - 1; i >= 0; i--) {
      const e = this.store.entries[i]!
      if (e.kind === 'cmd' && e.done) return e
    }
    return undefined
  }

  private quitting = false
  /** 離開：Pip 先道別，等打完字才真正結束。進度每過一關都已自動存檔。 */
  farewell(): void {
    if (this.quitting) return
    this.quitting = true
    const text = t('下次見！你的進度已經自動存好了，隨時回來繼續。')
    this.speak([{ text, pose: 'wave', tone: 'plain' }])
    setTimeout(() => this.shutdown(), [...text].length * 34 + 900)
  }

  nudgeQuit(): void {
    this.speak([{ text: t('想離開的話，輸入 /quit 或按 Ctrl-D 就可以囉。'), pose: 'idle', tone: 'plain' }])
  }

  // ---- 引擎同步 ----
  private afterCommand(last: string, info: PromptInfo | null, forceCd = false): void {
    let cd = ''
    if (info) cd = tick(last, info.cwd, String(info.rc))
    this.syncGame(cd, forceCd)
  }

  private syncGame(cd: string, forceCd: boolean): void {
    const prev = this.game
    const next = loadState()
    this.game = next
    const ev = next.event
    if (ev && ev.at !== this.lastEventAt) {
      this.lastEventAt = ev.at
      this.onEvent(ev, prev, next)
    } else if (next.feedback && next.feedback !== this.lastFeedback) {
      this.failCount++
      this.store.push({ kind: 'note', text: `↳ ${trFeedback(next.feedback)}`, tone: 'warn' })
    }
    this.lastFeedback = next.feedback
    if (cd.startsWith('cd:')) this.hiddenCd(cd.slice(3))
    else if (forceCd && next.current) this.hiddenCd(loadCatalog().byId.get(next.current)?.cwd ?? HOME)
  }

  private hiddenCd(path: string): void {
    this.hidden++
    this.shell.write(`cd ${shq(path)}\n`)
  }

  // ---- Pip 說話：固定位置、逐字打出，換訊息就原地重打 ----
  speak(msgs: Msg[], mode: 'replace' | 'append' = 'replace'): void {
    if (mode === 'replace') {
      // 被丟掉的佇列裡若有換關訊息，先套用最後一個，避免任務卡停在舊關卡
      const lastLevel = [...this.queue].reverse().find((m) => m.level !== undefined)
      if (lastLevel) this.applyLevel(lastLevel.level ?? null)
      this.queue = []
      if (this.speechTimer) {
        clearTimeout(this.speechTimer)
        this.speechTimer = null
      }
    }
    this.queue.push(...msgs)
    if (!this.speechTimer) this.pump()
  }

  private applyLevel(id: string | null): void {
    this.displayLevel = id
    this.failCount = 0
    this.levelShownAt = Date.now()
    // 換關不清空紀錄：你和 Pip 的對話要留著，往上捲就能回看
    this.changed()
  }

  private pump(): void {
    const m = this.queue.shift()
    if (!m) {
      this.speechTimer = null
      return
    }
    if (m.level !== undefined) this.applyLevel(m.level)
    const len = [...m.text].length
    const step = len > 110 ? Math.max(2, Math.ceil(len / 117)) : 1 // 長說明也控制在約 4 秒內打完
    const tickMs = 34
    this.speech = { id: ++this.speechId, text: m.text, pose: m.pose, tone: m.tone, step, tickMs, startedAt: Date.now(), danceMs: m.danceMs ?? 0 }
    this.changed()
    // 先保護這一則的打字時間。打完字「之後」才看有沒有下一則：有的話，依字數留足閱讀時間
    // （每字約 0.12 秒，至少 2.8 秒、最多 9 秒）再接續；沒有就保持不動。
    // （不能在這裡就決定，因為下一則常常是稍後才排進佇列的。）使用者可按 Enter 立刻跳到下一則。
    const typeMs = Math.ceil(len / step) * tickMs
    const hold = Math.min(9000, Math.max(2800, len * 120))
    this.speechTimer = setTimeout(() => {
      if (this.queue.length === 0) {
        this.speechTimer = null
        return
      }
      this.speechTimer = setTimeout(() => {
        this.speechTimer = null
        this.pump()
      }, hold)
    }, typeMs)
  }

  /** 還有幾則 Pip 的話在排隊。 */
  get pendingSpeech(): number {
    return this.queue.length
  }

  /** 跳到下一則訊息（輸入框空白時按 Enter）。回傳是否有跳。 */
  advanceSpeech(): boolean {
    if (this.speechTimer && this.queue.length) {
      clearTimeout(this.speechTimer)
      this.speechTimer = null
      this.pump()
      return true
    }
    return false
  }

  private levelMsg(id: string | null): Msg | null {
    if (!id) return null
    const cat = loadCatalog()
    const lvl = cat.byId.get(id)
    if (!lvl) return null
    const st = stageOf(lvl)
    const first = cat.levels.find((l) => stageOf(l) === st)
    const meta = cat.stages.find((x) => x.id === st)
    const intro = first?.id === lvl.id && meta ? t`【階段 ${st}　${meta.title}】${meta.intro}\n\n` : ''
    return { text: intro + lvl.story, pose: 'wave', tone: 'plain', level: lvl.id }
  }

  private onEvent(ev: GameEvent, prev: State, next: State): void {
    const cat = loadCatalog()
    switch (ev.type) {
      case 'pass':
      case 'finish': {
        if (ev.replay) {
          const title = cat.byId.get(ev.id)?.title ?? ev.id
          const msgs: Msg[] = [{ text: t`複習完成：「${title}」。重玩不會重複計 XP。`, pose: 'happy', tone: 'ok' }]
          if (ev.type === 'finish') msgs.push({ text: t('所有關卡你都完成了！想再練習，輸入 /levels 選一關。'), pose: 'happy', tone: 'ok', level: null })
          else {
            const lm = this.levelMsg(next.current)
            if (lm) msgs.push({ ...lm, text: t`回到你的進度。\n${lm.text}` })
          }
          this.speak(msgs)
          return
        }
        const title = cat.byId.get(ev.id)?.title ?? ev.id
        const praise = tr(PRAISE[ev.at % PRAISE.length]!)
        let text = t`${praise}\n「${title}」完成，+${ev.xp} XP`
        const b = ev.bonus
        const extra: string[] = []
        if (b?.streak) extra.push(t`連勝 ×${next.streak}（+${b.streak}）`)
        if (b?.speed) extra.push(t`快速通關 +${b.speed}`)
        if (b?.golf) extra.push(t`指令高爾夫 +${b.golf}`)
        if (b?.hard) extra.push(t`困難模式 +${b.hard}`)
        if (extra.length) text += `\n${extra.join(' · ')}`
        const r0 = tr(rankOf(prev.xp).name)
        const r1 = tr(rankOf(next.xp).name)
        if (r0 !== r1) text += t`\n★ 晉升為「${r1}」`
        const msgs: Msg[] = [{ text, pose: 'happy', tone: 'ok', danceMs: 1400 }]
        for (const id of ev.badges ?? []) {
          const d = BADGES.find((x) => x.id === id)
          msgs.push({ text: t`★ 解鎖徽章「${badgeName(id)}」\n${tr(d?.desc ?? '')}`, pose: 'happy', tone: 'ok', danceMs: 1800 })
        }
        if (ev.reveal) msgs.push({ text: t`日誌碎片 #${next.lore.length}\n${ev.reveal}`, pose: 'think', tone: 'info' })
        if (ev.type === 'finish') {
          msgs.push({ text: t('全部通關了！你現在是真正的 Root 大師。去真實世界大顯身手吧。'), pose: 'happy', tone: 'ok', level: null })
        } else {
          const lm = this.levelMsg(next.current)
          if (lm) msgs.push(lm)
        }
        this.speak(msgs)
        return
      }
      case 'hint': {
        const lvl = next.current ? cat.byId.get(next.current) : undefined
        const text = lvl?.hints[next.hintsShown - 1]
        if (lvl && text) this.speak([{ text: t`提示 ${next.hintsShown}/${lvl.hints.length}：${text}`, pose: 'think', tone: 'info' }])
        return
      }
      case 'skip':
      case 'start': {
        const lm = this.levelMsg(next.current)
        if (lm) this.speak([lm], this.booting ? 'append' : 'replace')
        this.booting = false
        return
      }
    }
  }

  private welcome(): void {
    this.speak([
      {
        text: t('嗨，我是 Pip，Kernel-7 號空間站的領航員！下面的輸入框就是真正的 Linux 終端機，輸入 help 可以看操作說明。'),
        pose: 'wave',
        tone: 'plain',
      },
    ])
  }

  // ---- 全螢幕程式交接 ----
  /** 解析：下一次需要「交出終端」或「離開」時。 */
  waitForSwitch(): Promise<'passthrough' | 'quit'> {
    if (this.pendingSwitch) {
      const r = this.pendingSwitch
      if (r === 'passthrough') this.pendingSwitch = null
      return Promise.resolve(r)
    }
    return new Promise((res) => this.switchWaiters.push(res))
  }
  private flushSwitch(r: 'passthrough' | 'quit'): void {
    const w = this.switchWaiters.splice(0)
    if (w.length === 0) this.pendingSwitch = r
    for (const f of w) f(r)
  }

  /** Ink 已卸載後呼叫：把真實終端交給 PTY，直到程式結束。 */
  async passthrough(): Promise<void> {
    const stdin = process.stdin
    const stdout = process.stdout
    this.rawActive = true
    const onData = (d: Buffer): void => this.shell.write(d.toString('utf8'))
    const onResize = (): void => this.shell.resize(stdout.columns || 80, stdout.rows || 24)
    stdin.setRawMode?.(true)
    stdin.resume()
    stdin.on('data', onData)
    stdout.on('resize', onResize)
    onResize()
    for (const c of this.rawBuf.splice(0)) stdout.write(c)
    if (this.shell.mode === 'capture') {
      // 程式在我們卸載 Ink 之前就結束了
    } else {
      await new Promise<void>((res) => (this.endPass = res))
    }
    this.endPass = null
    this.rawActive = false
    stdin.off('data', onData)
    stdout.off('resize', onResize)
    onResize()
  }

  // ---- 歷史 ----
  private loadHistory(): void {
    try {
      if (existsSync(HISTORY_FILE)) this.history = readFileSync(HISTORY_FILE, 'utf8').split('\n').filter(Boolean).slice(-500)
    } catch {}
  }
  private addHistory(line: string): void {
    if (this.history[this.history.length - 1] !== line) this.history.push(line)
    try {
      mkdirSync(SAVE_DIR, { recursive: true })
      appendFileSync(HISTORY_FILE, line.replace(/\n/g, ' ') + '\n')
    } catch {}
  }
}
