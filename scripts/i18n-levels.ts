// 抽出關卡裡需要翻譯的文字：
//   bun scripts/i18n-levels.ts fields   → 各關的 title/story/goal/reveal/hints（尚缺英文的）
//   bun scripts/i18n-levels.ts feedback → 判定腳本會印出的中文回饋（尚缺英文的）
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalogRaw } from '../src/engine/levels'

const ROOT = join(import.meta.dir, '..')
const CJK = /[㐀-鿿]/

export function feedbackKeys(): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const l of loadCatalogRaw().levels) {
    for (const line of (l.check ?? '').split('\n')) {
      for (const m of line.matchAll(/\b(?:echo|printf)\s+(?:-[a-zA-Z]+\s+)?(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g)) {
        const body = m[1] ?? m[2] ?? ''
        if (!CJK.test(body)) continue
        const key = body.replace(/\\n$/, '').replace(/\$\{[^}]*\}|\$\([^)]*\)|\$[A-Za-z_]\w*/g, '{}')
        out.set(key, [...(out.get(key) ?? []), l.id])
      }
    }
  }
  return out
}

if (import.meta.main) {
  const mode = process.argv[2]
  if (mode === 'feedback') {
    const have = JSON.parse(readFileSync(join(ROOT, 'src/i18n/feedback.en.json'), 'utf8')) as Record<string, string>
    const miss = [...feedbackKeys().keys()].filter((k) => !(k in have))
    console.log(JSON.stringify(miss, null, 1))
  } else {
    const have = JSON.parse(readFileSync(join(ROOT, 'src/i18n/levels.en.json'), 'utf8')) as Record<string, unknown>
    const c = loadCatalogRaw()
    const o: Record<string, unknown> = {}
    for (const s of c.stages) if (!have[`stage:${s.id}`]) o[`stage:${s.id}`] = { title: s.title, subtitle: s.subtitle, intro: s.intro }
    for (const l of c.levels) if (!have[l.id]) o[l.id] = { title: l.title, story: l.story, goal: l.goal, ...(l.reveal ? { reveal: l.reveal } : {}), hints: l.hints }
    console.log(JSON.stringify(o, null, 1))
  }
}
