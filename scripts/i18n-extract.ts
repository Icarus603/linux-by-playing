// 抽出所有已用 t() 包起來的字串，輸出需要翻譯的清單（key = 繁體原文，樣板的變數以 {} 表示）。
//   bun scripts/i18n-extract.ts            → 印出尚未翻譯的 key（JSON）
//   bun scripts/i18n-extract.ts --check    → 有缺漏就以非零結束
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { scan } from './i18n-scan'

const ROOT = join(import.meta.dir, '..')
const files: string[] = []
const walk = (d: string): void => {
  for (const e of readdirSync(d)) {
    const p = join(d, e)
    if (statSync(p).isDirectory()) walk(p)
    else if (/\.tsx?$/.test(e)) files.push(p)
  }
}
walk(join(ROOT, 'src'))

export function collect(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const f of files) {
    if (f.includes('/i18n/')) continue
    const src = readFileSync(f, 'utf8')
    for (const l of scan(src)) {
      const before = src.slice(Math.max(0, l.start - 3), l.start)
      const wrapped = l.kind === 't' ? (src[l.start - 1] === 't' && !/\w/.test(src[l.start - 2] ?? '')) || /\b(t|tr|T)\($/.test(before) : /\bt\($/.test(before) || /\btr\($/.test(src.slice(Math.max(0, l.start - 4), l.start)) || /\bT\($/.test(before)
      if (wrapped) keys.set(l.key, f.replace(ROOT + '/', ''))
    }
  }
  return keys
}

if (import.meta.main) {
  const en = JSON.parse(readFileSync(join(ROOT, 'src/i18n/en.json'), 'utf8')) as Record<string, string>
  const keys = collect()
  const missing = [...keys.keys()].filter((k) => !(k in en))
  if (process.argv.includes('--check')) {
    if (missing.length) {
      console.error(`缺少 ${missing.length} 條英文翻譯`)
      process.exit(1)
    }
  } else console.log(JSON.stringify(Object.fromEntries(missing.map((k) => [k, keys.get(k)])), null, 1))
}
