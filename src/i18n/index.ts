// 多語系：繁體中文（原文）、簡體中文（自動轉換）、英文（字典）。
// 用法：t('固定字串')、t`含 ${變數} 的字串`。字典的 key 就是繁體原文（樣板用 {} 代表變數，依序填入；也可寫 {0} {1} 重排）。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as OpenCC from 'opencc-js'
import enDict from './en.json'
import feedbackEn from './feedback.en.json'

export type Lang = 'zh-TW' | 'zh-CN' | 'en'
export const LANGS: { code: Lang; name: string; native: string }[] = [
  { code: 'zh-TW', name: 'Traditional Chinese', native: '繁體中文' },
  { code: 'zh-CN', name: 'Simplified Chinese', native: '简体中文' },
  { code: 'en', name: 'English', native: 'English' },
]

const SAVE_DIR = process.env.LBP_SAVE ?? '/save'
const LANG_FILE = join(SAVE_DIR, 'lang')

let lang: Lang | null = null
const listeners = new Set<() => void>()

function readLang(): Lang | null {
  try {
    const v = readFileSync(LANG_FILE, 'utf8').trim()
    return LANGS.some((l) => l.code === v) ? (v as Lang) : null
  } catch {
    return null
  }
}

/** 目前語言。沒選過回傳 null（啟動時要先讓玩家選）。環境變數 LBP_LANG 可覆蓋（測試與 verify 用）。 */
export function currentLang(): Lang | null {
  const env = process.env.LBP_LANG
  if (env && LANGS.some((l) => l.code === env)) return env as Lang
  if (lang === null) lang = readLang()
  return lang
}

/** 內部用：未選語言時當作繁體中文。 */
export const L = (): Lang => currentLang() ?? 'zh-TW'

export function setLang(next: Lang): void {
  lang = next
  try {
    if (!existsSync(SAVE_DIR)) mkdirSync(SAVE_DIR, { recursive: true })
    writeFileSync(LANG_FILE, next)
  } catch {}
  cnCache.clear()
  for (const f of listeners) f()
}

/** 語言切換時通知（關卡目錄快取、UI 重繪）。 */
export function onLangChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

// ───────── 簡體：OpenCC（台灣用語 → 大陸用語）＋少量補丁 ─────────
const toCN = OpenCC.Converter({ from: 'twp', to: 'cn' })
const PATCH: [RegExp, string][] = [
  [/預設/g, '默认'],
  [/目前/g, '当前'],
  [/終端機/g, '终端'],
  [/檔案/g, '文件'],
  [/繁體中文/g, '简体中文'],
]
const cnCache = new Map<string, string>()
export function cn(s: string): string {
  let r = cnCache.get(s)
  if (r === undefined) {
    r = toCN(PATCH.reduce((a, [re, to]) => a.replace(re, to), s))
    if (cnCache.size > 5000) cnCache.clear()
    cnCache.set(s, r)
  }
  return r
}

const dict = enDict as Record<string, string>

function fill(tpl: string, vals: unknown[]): string {
  let i = 0
  return tpl.replace(/\{(\d*)\}/g, (_, n: string) => String(vals[n === '' ? i++ : Number(n)] ?? ''))
}

/** 把原文（繁體）依目前語言轉成顯示文字。英文字典沒有的詞條會退回原文。 */
export function tr(src: string): string {
  const l = L()
  if (l === 'zh-TW') return src
  if (l === 'zh-CN') return cn(src)
  return dict[src] ?? src
}

export function t(s: TemplateStringsArray | string, ...vals: unknown[]): string {
  const l = L()
  if (typeof s === 'string') return tr(s)
  const key = s.join('{}')
  const plain = s.reduce((a, p, i) => a + p + (i < vals.length ? String(vals[i]) : ''), '')
  if (l === 'zh-TW') return plain
  if (l === 'zh-CN') return cn(plain)
  const tpl = dict[key]
  return tpl !== undefined ? fill(tpl, vals) : plain
}

// 判定腳本印出的回饋是「執行時組出來的」字串（含答案、數字等），所以用樣式比對：字典 key 裡的 {} 代表任意片段。
let fbRules: { re: RegExp; en: string }[] | null = null
const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function trFeedback(src: string): string {
  const l = L()
  if (l === 'zh-TW') return src
  if (l === 'zh-CN') return cn(src)
  fbRules ??= Object.entries(feedbackEn as Record<string, string>).map(([k, en]) => ({
    re: new RegExp('^' + k.split('{}').map(escRe).join('(.*?)') + '$', 's'),
    en,
  }))
  for (const r of fbRules) {
    const m = r.re.exec(src)
    if (m) return fill(r.en, m.slice(1))
  }
  return src
}
export { trFeedback }

/** 標記「這個字串要翻譯，但在使用時才轉換」（模組層級的資料表用）：執行時原樣回傳，使用處再呼叫 tr()。 */
export const T = (s: string): string => s

/** 目前語言的名稱（給 LLM 提示詞與顯示用）。 */
export const langName = (): string => LANGS.find((x) => x.code === L())!.native
