import type { Level, State } from './types'

export type Badge = { id: string; name: string; desc: string }

export const BADGES: Badge[] = [
  { id: 'first', name: '初次登艙', desc: '完成第一個任務' },
  { id: 'streak5', name: '五連勝', desc: '連續 5 關不用提示' },
  { id: 'streak10', name: '十連勝', desc: '連續 10 關不用提示' },
  { id: 'golfer', name: '指令高爾夫', desc: '第一次用極短的指令解題' },
  { id: 'golf5', name: '高爾夫老手', desc: '累計 5 次高爾夫成功' },
  { id: 'sprinter', name: '閃電手', desc: '累計 5 次快速通關' },
  { id: 'plumber', name: '管線水電工', desc: '通過第一個教管線 | 的關卡' },
  { id: 'root', name: '借用 Root', desc: '通過第一個教 sudo 的關卡' },
  { id: 'hard', name: '硬派玩家', desc: '在困難模式通過一關' },
  { id: 'boss1', name: '階段 1 通關', desc: '擊敗「失落的密碼」' },
  { id: 'boss2', name: '階段 2 通關', desc: '擊敗「整理下載區」' },
  { id: 'boss3', name: '階段 3 通關', desc: '擊敗「外洩的金鑰」' },
  { id: 'boss4', name: '階段 4 通關', desc: '擊敗「伺服器日誌分析」' },
  { id: 'boss5', name: '階段 5 通關', desc: '擊敗「團隊共用目錄」' },
  { id: 'boss6', name: '階段 6 通關', desc: '擊敗「暴走的引擎室」' },
  { id: 'boss7', name: '階段 7 通關', desc: '完成最後的維運值班' },
  { id: 'purist', name: '一塵不染', desc: '整個階段都沒有用過提示' },
]

export const badgeName = (id: string): string => BADGES.find((b) => b.id === id)?.name ?? id

/** 過關後檢查有哪些徽章剛解鎖。state 已包含本關的結果。 */
export function newBadges(s: State, lvl: Level, ctx: { golf: boolean; hints: number }): string[] {
  const have = new Set(s.badges)
  const out: string[] = []
  const grant = (id: string, ok: boolean): void => {
    if (ok && !have.has(id)) out.push(id)
  }
  grant('first', Object.keys(s.done).length >= 1)
  grant('streak5', s.streak >= 5)
  grant('streak10', s.streak >= 10)
  grant('golfer', ctx.golf)
  grant('golf5', s.golfWins >= 5)
  grant('sprinter', s.speedWins >= 5)
  grant('plumber', lvl.teaches.includes('|'))
  grant('root', lvl.teaches.includes('sudo'))
  grant('hard', s.hard)
  if (lvl.kind === 'boss') grant(`boss${lvl.id.split('-')[0]}`, true)
  if (lvl.kind === 'boss') {
    const st = lvl.id.split('-')[0]!
    const ids = Object.keys(s.done).filter((k) => k.startsWith(st + '-'))
    grant('purist', ids.length > 3 && ids.every((k) => (s.done[k]?.hints ?? 0) === 0))
  }
  return out
}
