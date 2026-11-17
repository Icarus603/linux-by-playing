import { loadCatalog, nextLevel } from './levels'
import { readFileSync, writeFileSync } from 'node:fs'
import { asPlayer, asRoot, check, enter, leave } from './runner'
import { newBadges } from './badges'
import { earnedXp, loadState, saveState } from './state'
import { emptyState, type GameEvent, type Level, type State } from './types'

const now = (): number => Date.now()
// 容器是用完即丟的：存檔記得「已進入」某關，但新容器裡 setup 建立的檔案已經不在。
// 用容器內的暫存標記判斷這個容器是否真的進入過該關。
const MARK = '/tmp/.lbp-entered'
const markedEntered = (): string => {
  try {
    return readFileSync(MARK, 'utf8').trim()
  } catch {
    return ''
  }
}

const ev = (type: GameEvent['type'], id: string, xp?: number): GameEvent => ({ type, id, xp, at: now() })

/** 進入關卡：離開舊關 → 重設環境 → 執行 setup。回傳 setup 的錯誤訊息（若有）。 */
function switchTo(s: State, target: Level | null, resume = false): string | null {
  const cat = loadCatalog()
  const prev = s.entered ? cat.byId.get(s.entered) : undefined
  if (prev && !resume) leave(prev)
  if (!resume) {
    s.hintsShown = 0
    s.answer = ''
    s.feedback = ''
    s.startedAt = now()
  }
  if (!target) {
    s.current = null
    s.entered = null
    return null
  }
  s.current = target.id
  const r = enter(target)
  s.entered = target.id
  try {
    writeFileSync(MARK, target.id)
  } catch {}
  return r.code === 0 ? null : `setup 失敗（${target.id}）：${r.err.trim().split('\n').pop()}`
}

/** 確保存檔有「目前關卡」並已建好環境。回傳 true 代表剛切換過關卡。 */
export function ensureEntered(s: State): boolean {
  const cat = loadCatalog()
  if (s.current === null && Object.keys(s.done).length === 0) s.current = cat.levels[0]?.id ?? null
  if (s.current && s.entered === s.current && markedEntered() !== s.current) {
    // 重新開啟遊戲（新容器）：關卡環境要重建，但保留提示、計時與答案進度
    s.answer = '' // 隨機答案會跟著重新產生，舊答案作廢
    switchTo(s, cat.byId.get(s.current) ?? null, true)
    s.event = ev('start', s.current)
    return true
  }
  if (s.current && s.entered !== s.current) {
    switchTo(s, cat.byId.get(s.current) ?? null)
    s.event = ev('start', s.current)
    return true
  }
  return false
}

/** 每次出現提示字元時呼叫：回傳要讓 shell 執行的 `cd:` 指令（若有）。 */
export function tick(last: string, cwd: string, rc = '0'): string {
  const cat = loadCatalog()
  const s = loadState()
  let cd = ''
  const started = ensureEntered(s)
  const lvl = s.current ? cat.byId.get(s.current) : undefined
  if (started && lvl) cd = `cd:${lvl.cwd}`
  if (!lvl) {
    saveState(s)
    return cd
  }
  const r = check(lvl, { last, answer: s.answer, cwd, rc })
  if (r.code === 0 && s.done[lvl.id]) {
    // 複習：不重複計 XP，完成後回到最前面尚未完成的關卡
    const target = cat.levels.find((l) => !s.done[l.id]) ?? nextLevel(cat, lvl.id)
    switchTo(s, target)
    s.event = { ...(target ? ev('pass', lvl.id, 0) : ev('finish', lvl.id, 0)), replay: true }
    cd = target ? `cd:${target.cwd}` : ''
  } else if (r.code === 0) {
    const hints = s.hintsShown
    const base = earnedXp(lvl.xp, hints)
    // 連勝：連續不用提示過關。用過提示就歸零。
    s.streak = hints === 0 ? s.streak + 1 : 0
    s.bestStreak = Math.max(s.bestStreak, s.streak)
    const streakBonus = hints === 0 ? Math.min(20, (s.streak - 1) * 2) : 0
    // 快速通關：在標準秒數內完成
    const par = lvl.par ?? (lvl.kind === 'boss' ? 150 : lvl.kind === 'learn' ? 25 : 60)
    const elapsed = (now() - (s.startedAt || now())) / 1000
    const speedBonus = hints === 0 && elapsed <= par ? 5 : 0
    if (speedBonus) s.speedWins += 1
    // 指令高爾夫：最後一個指令夠短
    const golfOk = lvl.golf !== undefined && last.trim().length > 0 && [...last.trim()].length <= lvl.golf
    const golfBonus = golfOk ? 10 : 0
    if (golfOk) s.golfWins += 1
    let total = base + streakBonus + speedBonus + golfBonus
    let hardBonus = 0
    if (s.hard) {
      hardBonus = Math.ceil(total * 0.5)
      total += hardBonus
    }
    s.xp += total
    s.done[lvl.id] = { xp: total, hints, at: now() }
    const badges = newBadges(s, lvl, { golf: golfOk, hints })
    s.badges.push(...badges)
    if (lvl.reveal) s.lore.push({ id: lvl.id, text: lvl.reveal })
    const nxt = nextLevel(cat, lvl.id)
    switchTo(s, nxt)
    s.event = {
      ...(nxt ? ev('pass', lvl.id, total) : ev('finish', lvl.id, total)),
      bonus: { streak: streakBonus, speed: speedBonus, golf: golfBonus, hard: hardBonus },
      badges,
      reveal: lvl.reveal,
    }
    cd = nxt ? `cd:${nxt.cwd}` : ''
  } else {
    const fb = r.out.trim().split('\n')[0] ?? ''
    if (fb !== s.feedback) s.feedback = fb
  }
  saveState(s)
  return cd
}

export function hint(): string {
  const cat = loadCatalog()
  const s = loadState()
  const lvl = s.current ? cat.byId.get(s.current) : undefined
  if (!lvl) return '目前沒有進行中的關卡。'
  if (s.hard) return '困難模式沒有提示。想要提示可以輸入 /hard 關閉困難模式。'
  if (lvl.hints.length === 0) return '這關沒有提示，靠你自己了。'
  if (s.hintsShown >= lvl.hints.length) return '提示已經全部用完。'
  s.hintsShown += 1
  s.event = ev('hint', lvl.id)
  saveState(s)
  return `提示 ${s.hintsShown}/${lvl.hints.length}（已顯示在右側面板）`
}

export function skip(): string {
  const cat = loadCatalog()
  const s = loadState()
  const lvl = s.current ? cat.byId.get(s.current) : undefined
  if (!lvl) return '目前沒有進行中的關卡。'
  const nxt = nextLevel(cat, lvl.id)
  s.streak = 0
  const err = switchTo(s, nxt)
  s.event = ev('skip', lvl.id)
  saveState(s)
  return err ?? `已跳過 ${lvl.id}。之後可用 goto ${lvl.id} 回來。`
}

export function goto(id: string): string {
  const cat = loadCatalog()
  const target = cat.byId.get(id)
  if (!target) return `找不到關卡 ${id}。輸入 levels 看清單。`
  const s = loadState()
  const err = switchTo(s, target)
  s.event = ev('start', id)
  saveState(s)
  return err ?? `前往 ${id}：${target.title}`
}

export function resetLevel(): string {
  const cat = loadCatalog()
  const s = loadState()
  const lvl = s.current ? cat.byId.get(s.current) : undefined
  if (!lvl) return '目前沒有進行中的關卡。'
  const err = switchTo(s, lvl)
  s.event = ev('start', lvl.id)
  saveState(s)
  return err ?? `已重設 ${lvl.id}。`
}

export function setAnswer(text: string): void {
  const s = loadState()
  s.answer = text
  saveState(s)
}

export function listLevels(): string {
  const cat = loadCatalog()
  const s = loadState()
  const lines: string[] = []
  let stage = -1
  for (const l of cat.levels) {
    const st = Number(l.id.split('-')[0])
    if (st !== stage) {
      stage = st
      const meta = cat.stages.find((x) => x.id === st)
      lines.push('', `階段 ${st}　${meta?.title ?? ''}`)
    }
    const mark = s.done[l.id] ? '✔' : l.id === s.current ? '▶' : '·'
    lines.push(`  ${mark} ${l.id}  ${l.title}`)
  }
  return lines.join('\n').trim()
}

/** 高爾夫目標必須真的可達成：重設環境後執行最短解答，需通過檢查且字元數 ≤ golf。 */
function golfReachable(l: Level): boolean {
  const sol = l.golf_solution ?? l.solution
  const last = sol.trim().split('\n').filter((x) => x.trim() && !x.trim().startsWith('#')).pop()?.trim() ?? ''
  if ([...last].length > (l.golf ?? 0)) return false
  const e = enter(l)
  if (e.code !== 0) return false
  setAnswer('')
  asPlayer(sol, { LBP_SAVE: process.env.LBP_SAVE ?? '/save' }, l.cwd)
  let endCwd = l.cwd
  try { endCwd = readFileSync('/tmp/.lbp_cwd', 'utf8') || l.cwd } catch {}
  const r = check(l, { last, answer: loadState().answer, cwd: endCwd })
  leave(l)
  return r.code === 0
}

/** 驗證每一關：setup 後 check 必須失敗；套用解答後 check 必須通過。 */
export function verify(filter?: string): { ok: boolean; report: string[] } {
  const cat = loadCatalog()
  const report: string[] = []
  let ok = true
  asRoot('mkdir -p "${LBP_SAVE:-/save}" && chmod 777 "${LBP_SAVE:-/save}"', { LBP_SAVE: process.env.LBP_SAVE ?? '/save' })
  const lastLine = (sol: string): string =>
    sol.trim().split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).pop()?.trim() ?? ''
  for (const l of cat.levels) {
    if (filter && !l.id.startsWith(filter)) continue
    const fail = (msg: string): void => {
      ok = false
      report.push(`✘ ${l.id} ${l.title}: ${msg}`)
    }
    const e = enter(l)
    if (e.code !== 0) {
      fail(`setup 失敗: ${e.err.trim().split('\n').pop()}`)
      leave(l)
      continue
    }
    const before = check(l, { last: '', answer: '', cwd: l.cwd })
    if (before.code === 0) {
      fail('尚未作答就通過了（check 太寬鬆）')
      leave(l)
      continue
    }
    setAnswer('')
    const sol = asPlayer(l.solution, { LBP_SAVE: process.env.LBP_SAVE ?? '/save' }, l.cwd)
    let endCwd = l.cwd
    try { endCwd = readFileSync('/tmp/.lbp_cwd', 'utf8') || l.cwd } catch {}
    const answer = loadState().answer
    const after = check(l, { last: lastLine(l.solution), answer, cwd: endCwd })
    if (after.code !== 0) {
      fail(`套用解答後仍未通過（solution exit=${sol.code}）${sol.err.trim() ? ' stderr: ' + sol.err.trim().split('\n')[0] : ''}${after.out.trim() ? ' check: ' + after.out.trim().split('\n')[0] : ''}`)
    } else if (l.golf !== undefined && !golfReachable(l)) {
      fail(`高爾夫目標 ${l.golf} 無法被（golf_solution 或參考解答）達成`)
    } else report.push(`✔ ${l.id} ${l.title}`)
    leave(l)
  }
  asRoot('true')
  return { ok, report }
}

/** 切換困難模式：沒有提示、不顯示指令名稱，XP ×1.5。 */
export function toggleHard(): boolean {
  const s = loadState()
  s.hard = !s.hard
  saveState(s)
  return s.hard
}

/** 回上一關。 */
export function prevLevel(): string {
  const cat = loadCatalog()
  const s = loadState()
  const i = s.current ? cat.levels.findIndex((l) => l.id === s.current) : cat.levels.length
  const t = cat.levels[i - 1]
  return t ? goto(t.id) : '已經是第一關了。'
}

/** 到下一關（不扣分，也不算跳過；會中斷連勝以外沒有懲罰）。 */
export function nextLevelCmd(): string {
  const cat = loadCatalog()
  const s = loadState()
  const i = s.current ? cat.levels.findIndex((l) => l.id === s.current) : -1
  const t = cat.levels[i + 1]
  return t ? goto(t.id) : '已經是最後一關了。'
}

/** 回到最前面還沒完成的關卡。 */
export function continueGame(): string {
  const cat = loadCatalog()
  const s = loadState()
  const t = cat.levels.find((l) => !s.done[l.id])
  if (!t) return '所有關卡都完成了！想複習的話用 /levels 選一關。'
  if (t.id === s.current) return `你已經在最前面的未完成關卡 ${t.id} 了。`
  return goto(t.id)
}

/** 重置全部進度：清掉 XP、徽章、日誌碎片、連勝，回到第 1 關。 */
export function resetProgress(): string {
  const cat = loadCatalog()
  const old = loadState()
  const prev = old.entered ? cat.byId.get(old.entered) : undefined
  if (prev) leave(prev)
  const s = emptyState()
  s.seq = old.seq + 1
  const first = cat.levels[0] ?? null
  const err = switchTo(s, first)
  s.event = ev('start', first?.id ?? '')
  saveState(s)
  return err ?? '已重置所有進度。'
}
