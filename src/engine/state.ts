import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyState, type State } from './types'
import { T } from '../i18n'

export const SAVE_DIR = process.env.LBP_SAVE ?? '/save'
export const STATE_FILE = join(SAVE_DIR, 'state.json')

export function loadState(): State {
  try {
    if (!existsSync(STATE_FILE)) return emptyState()
    return { ...emptyState(), ...JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
  } catch {
    return emptyState()
  }
}

/** 原子寫入：先寫暫存檔再 rename，HUD 不會讀到半截的 JSON。 */
export function saveState(s: State): void {
  mkdirSync(SAVE_DIR, { recursive: true })
  s.seq += 1
  const tmp = `${STATE_FILE}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(s))
  renameSync(tmp, STATE_FILE)
}

/** 提示越多，XP 越少，但至少保留一半。 */
export const earnedXp = (base: number, hints: number): number =>
  Math.max(Math.ceil(base / 2), base - 3 * hints)

export const RANKS: { at: number; name: string }[] = [
  { at: 0, name: T('實習生') },
  { at: 100, name: T('見習船員') },
  { at: 300, name: T('技術員') },
  { at: 700, name: T('工程師') },
  { at: 1400, name: T('資深工程師') },
  { at: 2400, name: T('輪機長') },
  { at: 3600, name: T('艦長') },
  { at: 5000, name: T('Root 大師') },
]

export function rankOf(xp: number): { name: string; next: number | null; floor: number } {
  let i = 0
  for (let k = 0; k < RANKS.length; k++) if (xp >= RANKS[k]!.at) i = k
  return { name: RANKS[i]!.name, floor: RANKS[i]!.at, next: RANKS[i + 1]?.at ?? null }
}
