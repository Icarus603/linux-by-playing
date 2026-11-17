import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { continueGame, goto, resetProgress, hint, nextLevelCmd, prevLevel, resetLevel, skip, tick } from '../engine/game'
import { badgeName, BADGES } from '../engine/badges'
import { loadCatalog, stageOf } from '../engine/levels'
import { SAVE_DIR, loadState, rankOf } from '../engine/state'
import type { GameEvent, State } from '../engine/types'
import { setClipboard } from './ink'
import { type Activity, ask as askPip, warmup as warmupLlm } from '../ask/answer'
import { isNaturalLanguage } from '../ask/route'
import { OutBuf } from '../shell/outbuf'
import { PtyShell, type PromptInfo } from '../shell/ptyshell'
import type { PipPose } from './Pip'
import { PRAISE } from './theme'
import { SLASH_NAMES, runSlash } from './slash'
import { Store, type Entry } from './store'

const RC = process.env.LBP_RC ?? '/game/player.bashrc'
const HOME = '/home/player'
const HISTORY_FILE = join(SAVE_DIR, 'history')
const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`

type CmdEntry = Extract<Entry, { kind: 'cmd' }>

type Tone = 'ok' | 'info' | 'plain'
/** Pip 吉祥物的狀態：姿勢、最近一次說話的時間、跳舞時間、是否仍在串流。 */
export type Mood = { pose: PipPose; at: number; danceMs: number; streaming: boolean }
type Msg = { text: string; pose: PipPose; tone: Tone; level?: string | null; danceMs?: number }

export class Controller {
  store = new Store()
  shell!: PtyShell
  cwd = HOME
  game: State = loadState()
  history: string[] = []
  running: CmdEntry | null = null
  quit = false
  ready = false
  /** 使用者正在捲動：此時暫停吉祥物動畫，把整個畫面的重繪留給捲動 */
  scrolling = false
  private scrollTimer: ReturnType<typeof setTimeout> | null = null
  /** 輸入框上方吉祥物的狀態 */
  mood: Mood = { pose: 'wave', at: 0, danceMs: 0, streaming: false }
  /** 關卡選單 */
  pickerOpen = false
  /** 短暫的狀態訊息（例如「已複製 N 字」） */
  flashText = ''
  private flashTimer: ReturnType<typeof setTimeout> | null = null
  pickerSel = 0
  /** 任務卡目前顯示的關卡 */
  displayLevel: string | null = null

  private failCount = 0
  private askAbort: AbortController | null = null
  private levelShownAt = Date.now()
  private lastActivity = Date.now()
  private nudged = new Set<string>()
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
    if (!this.ready || this.quit || this.running || !id || this.nudged.has(id) || Date.now() - this.mood.at < 5000) return
    const idle = Date.now() - Math.max(this.lastActivity, this.levelShownAt)
    if (idle < 100_000 && this.failCount < 3) return
    this.nudged.add(id)
    this.speak([
      {
        text: this.game.hard
          ? '卡住了嗎？困難模式沒有提示，不過 /explain 還是可以問我，實在不行就 /skip。'
          : '卡住了嗎？別急。輸入 /hint 看提示（會少拿一點 XP），或 /explain 讓我解釋這關用到的指令。',
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
      this.welcome()
      this.afterCommand('', info)
      this.changed()
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
      this.speak([{ text: '看起來你是想跟我聊天？先輸入 ! 進入聊天模式（輸入框會變藍色），再用自然語言問我；Esc 回到指令模式。', pose: 'think', tone: 'info' }])
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
      this.store.push({ kind: 'note', text: `✋ Pip 攔下了：${line}`, tone: 'warn' })
      this.speak([
        {
          text: '等等等等！！這個指令會把整個空間站（的檔案系統）一起刪光。我先幫你攔下來了。\n真正的管理員會先 ls 看清楚、再動手。',
          pose: 'worry',
          tone: 'plain',
        },
      ])
      return true
    }
    if (/^\s*sudo\s+make\s+me\s+a\s+sandwich/i.test(line)) {
      this.speak([{ text: '好吧，這次有 sudo，我破例！（企鵝遞來一個三明治）', pose: 'happy', tone: 'ok' }])
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
        if (!/^提示 \d/.test(msg)) this.speak([{ text: msg, pose: 'idle', tone: 'plain' }])
        this.afterCommand('', null)
        return
      }
      case 'ask':
        if (!arg) this.speak([{ text: '想問什麼？直接輸入問題就好，例如：怎麼找檔案？或 /ask grep 怎麼用。我會根據我的資料庫回答。', pose: 'idle', tone: 'plain' }])
        else this.ask(arg)
        return
      case 'levels':
        this.openPicker()
        return
      case 'reset': {
        if (arg.toLowerCase() !== 'confirm') {
          this.speak([
            {
              text: '這會清除所有進度：經驗值、等級、徽章、日誌碎片、連勝，並回到第 1 關。這個動作無法復原。\n確定的話，請輸入 /reset confirm。',
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
        if (/^setup 失敗/.test(msg)) this.speak([{ text: msg, pose: 'worry', tone: 'plain' }])
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
        if (/^(找不到|目前沒有|setup 失敗|已經是|所有關卡|你已經在)/.test(msg)) this.speak([{ text: msg, pose: 'worry', tone: 'plain' }])
        else this.afterCommand('', null, true)
        return
      }
    }
    if (runSlash(this, name, arg)) return
    const near = SLASH_NAMES.filter((n) => n.startsWith(name.slice(0, 2)))[0]
    this.speak([
      {
        text: `我不認識 /${name}。${near ? `你是想輸入 /${near} 嗎？` : ''}輸入 /help 可以看我會的所有指令。`,
        pose: 'worry',
        tone: 'plain',
      },
    ])
  }

  // ---- 關卡選單 ----
  openPicker(): void {
    const cat = loadCatalog()
    const i = cat.levels.findIndex((l) => l.id === this.game.current)
    this.pickerSel = Math.max(0, i)
    this.pickerOpen = true
    this.speak([{ text: '想去哪一關？用 ↑↓ 選擇，←→ 跳階段，Enter 前往。已完成的關卡可以重玩，不會重複計 XP。', pose: 'idle', tone: 'plain' }])
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
  private showAnswer(text: string, pose: PipPose, tone: Tone, fresh: boolean, streaming = false): void {
    if (fresh || !this.answerEntry) {
      this.answerEntry = this.store.push({ kind: 'say', who: 'pip', text, tone, streaming }) as Extract<Entry, { kind: 'say' }>
    } else {
      this.answerEntry.text = text
      this.answerEntry.tone = tone
      this.answerEntry.streaming = streaming
      this.store.touch()
    }
    this.mood = { pose, at: Date.now(), danceMs: 0, streaming }
    this.changed()
  }

  ask(q: string): void {
    this.askAbort?.abort()
    const ac = new AbortController()
    this.askAbort = ac
    this.store.push({ kind: 'say', who: 'you', text: q, tone: 'plain', streaming: false })
    void askPip(
      q,
      {
        begin: (t) => this.showAnswer(t, 'think', 'info', true, true),
        update: (t) => !ac.signal.aborted && this.showAnswer(t, 'think', 'info', false, true),
        done: (t, src) => {
          if (ac.signal.aborted) return
          this.showAnswer(t, src === 'unsure' ? 'worry' : 'happy', src === 'unsure' ? 'plain' : 'info', false)
        },
      },
      ac.signal,
      this.recentActivity(),
    ).catch((e) => {
      if (!ac.signal.aborted) this.showAnswer(`查資料時出了點問題：${String(e).slice(0, 60)}`, 'worry', 'plain', false)
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
    const text = '下次見！你的進度已經自動存好了，隨時回來繼續。'
    this.speak([{ text, pose: 'wave', tone: 'plain' }])
    setTimeout(() => this.shutdown(), [...text].length * 34 + 900)
  }

  nudgeQuit(): void {
    this.speak([{ text: '想離開的話，輸入 /quit 或按 Ctrl-D 就可以囉。', pose: 'idle', tone: 'plain' }])
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
      this.store.push({ kind: 'note', text: `↳ ${next.feedback}`, tone: 'warn' })
    }
    this.lastFeedback = next.feedback
    if (cd.startsWith('cd:')) this.hiddenCd(cd.slice(3))
    else if (forceCd && next.current) this.hiddenCd(loadCatalog().byId.get(next.current)?.cwd ?? HOME)
  }

  private hiddenCd(path: string): void {
    this.hidden++
    this.shell.write(`cd ${shq(path)}\n`)
  }

  // ---- Pip 說話：直接寫進下方紀錄區（前面一個「●」），會留著、可捲動回看 ----
  speak(msgs: Msg[], _mode: 'replace' | 'append' = 'replace'): void {
    for (const m of msgs) {
      if (m.level !== undefined) this.applyLevel(m.level)
      this.answerEntry = null
      this.store.push({ kind: 'say', who: 'pip', text: m.text, tone: m.tone, streaming: false })
      this.mood = { pose: m.pose, at: Date.now(), danceMs: m.danceMs ?? 0, streaming: false }
    }
    this.changed()
  }

  private applyLevel(id: string | null): void {
    this.displayLevel = id
    this.failCount = 0
    this.levelShownAt = Date.now()
    // 換關不再清空紀錄：對話與指令都留著，往上捲就能回看
    this.changed()
  }

  private levelMsg(id: string | null): Msg | null {
    if (!id) return null
    const cat = loadCatalog()
    const lvl = cat.byId.get(id)
    if (!lvl) return null
    const st = stageOf(lvl)
    const first = cat.levels.find((l) => stageOf(l) === st)
    const meta = cat.stages.find((x) => x.id === st)
    const intro = first?.id === lvl.id && meta ? `【階段 ${st}　${meta.title}】${meta.intro}\n\n` : ''
    return { text: intro + lvl.story, pose: 'wave', tone: 'plain', level: lvl.id }
  }

  private onEvent(ev: GameEvent, prev: State, next: State): void {
    const cat = loadCatalog()
    switch (ev.type) {
      case 'pass':
      case 'finish': {
        if (ev.replay) {
          const t = cat.byId.get(ev.id)?.title ?? ev.id
          const msgs: Msg[] = [{ text: `複習完成：「${t}」。重玩不會重複計 XP。`, pose: 'happy', tone: 'ok' }]
          if (ev.type === 'finish') msgs.push({ text: '所有關卡你都完成了！想再練習，輸入 /levels 選一關。', pose: 'happy', tone: 'ok', level: null })
          else {
            const lm = this.levelMsg(next.current)
            if (lm) msgs.push({ ...lm, text: `回到你的進度。\n${lm.text}` })
          }
          this.speak(msgs)
          return
        }
        const title = cat.byId.get(ev.id)?.title ?? ev.id
        const praise = PRAISE[ev.at % PRAISE.length]!
        let text = `${praise}\n「${title}」完成，+${ev.xp} XP`
        const b = ev.bonus
        const extra: string[] = []
        if (b?.streak) extra.push(`連勝 ×${next.streak}（+${b.streak}）`)
        if (b?.speed) extra.push(`快速通關 +${b.speed}`)
        if (b?.golf) extra.push(`指令高爾夫 +${b.golf}`)
        if (b?.hard) extra.push(`困難模式 +${b.hard}`)
        if (extra.length) text += `\n${extra.join(' · ')}`
        const r0 = rankOf(prev.xp).name
        const r1 = rankOf(next.xp).name
        if (r0 !== r1) text += `\n★ 晉升為「${r1}」`
        const msgs: Msg[] = [{ text, pose: 'happy', tone: 'ok', danceMs: 1400 }]
        for (const id of ev.badges ?? []) {
          const d = BADGES.find((x) => x.id === id)
          msgs.push({ text: `★ 解鎖徽章「${badgeName(id)}」\n${d?.desc ?? ''}`, pose: 'happy', tone: 'ok', danceMs: 1800 })
        }
        if (ev.reveal) msgs.push({ text: `日誌碎片 #${next.lore.length}\n${ev.reveal}`, pose: 'think', tone: 'info' })
        if (ev.type === 'finish') {
          msgs.push({ text: '全部通關了！你現在是真正的 Root 大師。去真實世界大顯身手吧。', pose: 'happy', tone: 'ok', level: null })
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
        if (lvl && text) this.speak([{ text: `提示 ${next.hintsShown}/${lvl.hints.length}：${text}`, pose: 'think', tone: 'info' }])
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
        text: '嗨，我是 Pip，Kernel-7 號空間站的領航員！下面的輸入框就是真正的 Linux 終端機，輸入 help 可以看操作說明。',
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
