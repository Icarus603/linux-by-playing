import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { LevelSchema, StageSchema, type Level, type Stage } from './types'
import { L, cn, onLangChange, type Lang } from '../i18n'
import levelsEn from '../i18n/levels.en.json'

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
const localized = new Map<Lang, Catalog>()
onLangChange(() => localized.clear())

/** 載入並驗證全部關卡（原文，繁體中文）；任何格式錯誤都會丟出含檔名的錯誤。 */
export function loadCatalogRaw(dir = LEVELS_DIR): Catalog {
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

type EnLevel = { title?: string; story?: string; goal?: string; reveal?: string; hints?: string[] }
type EnStage = { title?: string; subtitle?: string; intro?: string }
const EN = levelsEn as unknown as Record<string, EnLevel | EnStage>

function localize(raw: Catalog, lang: Lang): Catalog {
  const f = (s: string): string => (lang === 'zh-CN' ? cn(s) : s)
  const levels = raw.levels.map((l): Level => {
    if (lang === 'zh-TW') return l
    if (lang === 'zh-CN') return { ...l, title: f(l.title), story: f(l.story), goal: f(l.goal), reveal: l.reveal ? f(l.reveal) : l.reveal, hints: l.hints.map(f) }
    const e = (EN[l.id] ?? {}) as EnLevel
    return { ...l, title: e.title ?? l.title, story: e.story ?? l.story, goal: e.goal ?? l.goal, reveal: e.reveal ?? l.reveal, hints: l.hints.map((h, i) => e.hints?.[i] ?? h) }
  })
  const stages = raw.stages.map((s): Stage => {
    if (lang === 'zh-TW') return s
    if (lang === 'zh-CN') return { ...s, title: f(s.title), subtitle: f(s.subtitle), intro: f(s.intro) }
    const e = (EN[`stage:${s.id}`] ?? {}) as EnStage
    return { ...s, title: e.title ?? s.title, subtitle: e.subtitle ?? s.subtitle, intro: e.intro ?? s.intro }
  })
  return { levels, stages, byId: new Map(levels.map((l) => [l.id, l])) }
}

/** 依目前語言顯示的關卡目錄（標題、劇情、目標、提示、揭露都已轉換；判定腳本不變）。 */
export function loadCatalog(dir = LEVELS_DIR): Catalog {
  const raw = loadCatalogRaw(dir)
  if (dir !== LEVELS_DIR) return raw
  const lang = L()
  let c = localized.get(lang)
  if (!c) {
    c = localize(raw, lang)
    localized.set(lang, c)
  }
  return c
}

/** 日誌碎片依「目前語言」顯示：存檔只記關卡 id，文字從關卡目錄取（找不到才用存檔裡的原文）。 */
export const loreText = (l: { id: string; text: string }): string => loadCatalog().byId.get(l.id)?.reveal ?? l.text

export const stageOf = (l: Level): number => Number(l.id.split('-')[0])

export function nextLevel(c: Catalog, id: string): Level | null {
  const i = c.levels.findIndex((l) => l.id === id)
  return c.levels[i + 1] ?? null
}
