import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LevelSchema, StageSchema, type Level, type Stage } from './types'

export const LEVELS_DIR =
  process.env.LBP_LEVELS ??
  (existsSync('/game/levels') ? '/game/levels' : join(import.meta.dir, '../../levels'))

const parseYaml = (text: string): unknown => Bun.YAML.parse(text)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else if (/\.ya?ml$/.test(e.name)) out.push(p)
  }
  return out
}

const order = (id: string): number => {
  const [s, n] = id.split('-').map(Number)
  return s! * 1000 + n!
}

export type Catalog = { levels: Level[]; stages: Stage[]; byId: Map<string, Level> }

let cache: Catalog | null = null

/** 載入並驗證全部關卡；任何格式錯誤都會丟出含檔名的錯誤。 */
export function loadCatalog(dir = LEVELS_DIR): Catalog {
  if (cache && dir === LEVELS_DIR) return cache
  const levels: Level[] = []
  const stages: Stage[] = []
  for (const file of walk(dir).sort()) {
    let raw: unknown
    try {
      raw = parseYaml(readFileSync(file, 'utf8'))
    } catch (e) {
      throw new Error(`${file}: ${(e as Error).message}`)
    }
    if (file.endsWith('stages.yaml')) {
      for (const s of raw as unknown[]) stages.push(StageSchema.parse(s))
      continue
    }
    const r = LevelSchema.safeParse(raw)
    if (!r.success) throw new Error(`${file}: ${r.error.message}`)
    levels.push(r.data)
  }
  levels.sort((a, b) => order(a.id) - order(b.id))
  const byId = new Map<string, Level>()
  for (const l of levels) {
    if (byId.has(l.id)) throw new Error(`關卡 id 重複：${l.id}`)
    byId.set(l.id, l)
  }
  stages.sort((a, b) => a.id - b.id)
  const c = { levels, stages, byId }
  if (dir === LEVELS_DIR) cache = c
  return c
}

export const stageOf = (l: Level): number => Number(l.id.split('-')[0])

export function nextLevel(c: Catalog, id: string): Level | null {
  const i = c.levels.findIndex((l) => l.id === id)
  return c.levels[i + 1] ?? null
}
