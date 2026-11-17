import { z } from 'zod'

/** 單一關卡。以 YAML 撰寫，載入時以 zod 驗證。 */
export const LevelSchema = z.object({
  id: z.string().regex(/^\d{1,2}-\d{2}$/, '格式需為 <階段>-<序號>，例如 1-03'),
  title: z.string().min(1),
  kind: z.enum(['learn', 'practice', 'combine', 'boss']).default('practice'),
  /** Pip 的台詞：劇情與情境 */
  story: z.string().min(1),
  /** 明確的任務目標（一到兩句） */
  goal: z.string().min(1),
  /** 這關涵蓋的指令，用於顯示與課程覆蓋率檢查 */
  teaches: z.array(z.string()).default([]),
  xp: z.number().int().positive().default(10),
  /** 由淺入深的提示；使用越多，XP 越少 */
  hints: z.array(z.string()).default([]),
  /** 以 root 執行，建立關卡環境（需可重複執行） */
  setup: z.string().default(''),
  /** 以 root 執行；exit 0 = 通過。stdout 第一行會作為失敗時的回饋 */
  check: z.string().min(1),
  /** 參考解答，以 player 身分執行。CI 用它驗證關卡可解 */
  solution: z.string().min(1),
  /** 關卡開始時玩家 shell 所在的目錄 */
  cwd: z.string().default('/home/player'),
  /** 過關後 Pip 揭露的「日誌碎片」（劇情主線） */
  reveal: z.string().optional(),
  /** 指令高爾夫：最後一個指令的字元數 ≤ 此值，有額外獎勵 */
  golf: z.number().int().positive().optional(),
  /** 證明高爾夫目標可達成的最短解答（驗證時會實際執行） */
  golf_solution: z.string().optional(),
  /** 快速通關的標準秒數（預設依關卡類型） */
  par: z.number().int().positive().optional(),
  /** 離開關卡時以 root 執行，清除 setup 造成的系統層副作用 */
  cleanup: z.string().default(''),
})
export type Level = z.infer<typeof LevelSchema>

export const StageSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  subtitle: z.string(),
  intro: z.string(),
})
export type Stage = z.infer<typeof StageSchema>

export type Done = { xp: number; hints: number; at: number }

export type Bonus = { streak: number; speed: number; golf: number; hard: number }

export type GameEvent = {
  type: 'start' | 'pass' | 'skip' | 'hint' | 'finish' | 'fail'
  id: string
  xp?: number
  at: number
  bonus?: Bonus
  badges?: string[]
  reveal?: string
  /** 重玩已完成的關卡：不計 XP */
  replay?: boolean
}

export type State = {
  v: 1
  /** 目前關卡 id；全部完成為 null */
  current: string | null
  /** 已執行過 setup 的關卡 */
  entered: string | null
  xp: number
  done: Record<string, Done>
  hintsShown: number
  answer: string
  feedback: string
  event: GameEvent | null
  /** 每次寫入遞增，HUD 以此偵測變更 */
  seq: number
  /** 連續不用提示過關的數量 */
  streak: number
  bestStreak: number
  /** 本關開始時間（毫秒） */
  startedAt: number
  badges: string[]
  /** 已收集的日誌碎片 */
  lore: { id: string; text: string }[]
  hard: boolean
  speedWins: number
  golfWins: number
}

export const emptyState = (): State => ({
  v: 1,
  current: null,
  entered: null,
  xp: 0,
  done: {},
  hintsShown: 0,
  answer: '',
  feedback: '',
  event: null,
  seq: 0,
  streak: 0,
  bestStreak: 0,
  startedAt: 0,
  badges: [],
  lore: [],
  hard: false,
  speedWins: 0,
  golfWins: 0,
})
