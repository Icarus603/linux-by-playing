// 掃描 TS/TSX 原始碼，找出含中文的字串字面值（單引號、雙引號、樣板字串），供 i18n 包裝與字典抽取使用。
export type Lit = { start: number; end: number; kind: 'q' | 't'; raw: string; /** 樣板字串的各段（已還原跳脫）與變數個數 */ key: string }

const CJK = /[㐀-鿿＀-￯　-〿]/

function unescape(s: string): string {
  return s.replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (_, c: string) => {
    if (c[0] === 'u') return String.fromCodePoint(parseInt(c.replace(/[u{}]/g, ''), 16))
    if (c[0] === 'x') return String.fromCharCode(parseInt(c.slice(1), 16))
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }[c as 'n'] ?? c
  })
}

export function scan(src: string): Lit[] {
  const out: Lit[] = []
  const n = src.length
  // 掃描 [i, 結尾)；endOnBrace 為真時，遇到未配對的 } 就停（用於樣板字串的 ${...} 內）。回傳停止位置。
  const run = (start: number, endOnBrace: boolean): number => {
    let i = start
    let prevSig = ''
    let depth = 0
    while (i < n) {
      const c = src[i]!
      const d = src[i + 1]
      if (c === '/' && d === '/') {
        while (i < n && src[i] !== '\n') i++
        continue
      }
      if (c === '/' && d === '*') {
        const e = src.indexOf('*/', i + 2)
        i = e < 0 ? n : e + 2
        continue
      }
      if (c === "'" || c === '"') {
        let j = i + 1
        while (j < n && src[j] !== c) j += src[j] === '\\' ? 2 : 1
        const raw = src.slice(i + 1, j)
        if (CJK.test(raw)) out.push({ start: i, end: j + 1, kind: 'q', raw, key: unescape(raw) })
        i = j + 1
        prevSig = 'x'
        continue
      }
      if (c === '`') {
        let j = i + 1
        let key = ''
        let lit = ''
        while (j < n && src[j] !== '`') {
          if (src[j] === '\\') {
            lit += src.slice(j, j + 2)
            j += 2
          } else if (src[j] === '$' && src[j + 1] === '{') {
            key += unescape(lit) + '{}'
            lit = ''
            j = run(j + 2, true) + 1
          } else {
            lit += src[j]
            j++
          }
        }
        key += unescape(lit)
        const raw = src.slice(i + 1, j)
        if (CJK.test(raw.replace(/\$\{[\s\S]*?\}/g, ''))) out.push({ start: i, end: j + 1, kind: 't', raw, key })
        i = j + 1
        prevSig = 'x'
        continue
      }
      if (c === '{') depth++
      if (c === '}') {
        if (endOnBrace && depth === 0) return i
        depth--
      }
      if (c === '/' && /^[(,=:[!&|?{};]?$/.test(prevSig)) {
        let j = i + 1
        let inClass = false
        while (j < n && (src[j] !== '/' || inClass) && src[j] !== '\n') {
          if (src[j] === '\\') j++
          else if (src[j] === '[') inClass = true
          else if (src[j] === ']') inClass = false
          j++
        }
        i = j + 1
        prevSig = 'x'
        continue
      }
      if (!/\s/.test(c)) prevSig = c
      i++
    }
    return i
  }
  run(0, false)
  return out.sort((a, b) => a.start - b.start)
}
