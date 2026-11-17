// 一次性工具：把檔案裡含中文的字串字面值包上 t()／t``。用法：bun scripts/i18n-wrap.ts <檔案> [--skip 1-75,253-999] [--fn t|tr]
import { readFileSync, writeFileSync } from 'node:fs'
import { scan } from './i18n-scan'

const [file, ...rest] = process.argv.slice(2)
if (!file) throw new Error('需要檔案路徑')
const skip: [number, number][] = (rest[rest.indexOf('--skip') + 1] ?? '')
  .split(',')
  .filter((x) => /^\d+-\d+$/.test(x))
  .map((x) => x.split('-').map(Number) as [number, number])
const fn = rest.includes('--fn') ? rest[rest.indexOf('--fn') + 1]! : 't'

let src = readFileSync(file, 'utf8')
const lits = scan(src).filter((l) => /[㐀-鿿]/.test(l.raw))
let n = 0
for (const l of lits.reverse()) {
  const line = src.slice(0, l.start).split('\n').length
  if (skip.some(([a, b]) => line >= a && line <= b)) continue
  const before = src.slice(0, l.start)
  const after = src.slice(l.end)
  if (/\b(t|tr|T)\($/.test(before) || (l.kind === 't' && /\bt$/.test(before))) continue
  const prev = before.trimEnd().slice(-1)
  const next = after.trimStart()[0]
  if (next === ':' && (prev === '{' || prev === ',')) continue // 物件的 key
  if (/\bcase\s*$/.test(before) || /\bimport\b[^\n]*$/.test(before)) continue
  src = l.kind === 'q' ? before + `${fn}(${src.slice(l.start, l.end)})` + after : before + 't' + src.slice(l.start, l.end) + after
  n++
}
writeFileSync(file, src)
console.log(`${file}: 包了 ${n} 個`)
