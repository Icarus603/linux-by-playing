import { statSync } from 'node:fs'
import { join } from 'node:path'
import { SLASH_NAMES } from './slash'

// Tab 補全：向 bash 的 compgen 詢問候選，並計算最長共同前綴。

const HOME = '/home/player'

function compgen(args: string, word: string, cwd: string): string[] {
  const p = Bun.spawnSync(['bash', '-c', `cd "$2" 2>/dev/null; compgen ${args} -- "$1"`, '_', word, cwd], {
    stdin: 'ignore',
    timeout: 1500,
  })
  return p.stdout.toString().split('\n').filter(Boolean)
}

const lcp = (xs: string[]): string => {
  let p = xs[0] ?? ''
  for (const x of xs) while (!x.startsWith(p)) p = p.slice(0, -1)
  return p
}

export type Completion = { value: string; cursor: number; cands: string[] }

export function complete(value: string, cursor: number, cwd: string): Completion {
  const chars = [...value]
  const head = chars.slice(0, cursor).join('')
  const tail = chars.slice(cursor).join('')
  const word = /(\S*)$/.exec(head)![1]!
  // /指令：只在第一個字補全遊戲指令
  if (/^\s*\/[A-Za-z]*$/.test(head)) {
    const pre = head.trim().toLowerCase()
    const hits = SLASH_NAMES.map((n) => '/' + n).filter((n) => n.startsWith(pre))
    if (hits.length === 0) return { value, cursor, cands: [] }
    const rep = hits.length === 1 ? hits[0]! + ' ' : lcp(hits)
    return { value: rep + tail, cursor: [...rep].length, cands: hits.length > 1 ? hits : [] }
  }
  const before = head.slice(0, head.length - word.length)

  const atCommand =
    !/\S/.test(before) || /[|;&(]\s*$/.test(before) || /^\s*(sudo|time|watch|xargs|nohup|exec|env)\s+$/.test(before)

  let cands: string[]
  let display = (s: string): string => s
  if (atCommand && !word.includes('/')) {
    cands = compgen('-A command', word, cwd)
  } else {
    const tilde = word.startsWith('~')
    const real = tilde ? HOME + word.slice(1) : word
    cands = compgen('-f', real, cwd).map((c) => {
      const abs = c.startsWith('/') ? c : join(cwd, c)
      let isDir = false
      try {
        isDir = statSync(abs).isDirectory()
      } catch {}
      return isDir ? c + '/' : c
    })
    display = (s) => (tilde && s.startsWith(HOME) ? '~' + s.slice(HOME.length) : s)
    cands = cands.map(display)
  }
  cands = [...new Set(cands)].sort()
  if (cands.length === 0) return { value, cursor, cands: [] }

  const esc = (s: string): string => s.replace(/([ '"\\()&;|<>*?$`])/g, '\\$1')
  const common = lcp(cands)
  let replacement: string
  if (cands.length === 1) {
    replacement = esc(cands[0]!) + (cands[0]!.endsWith('/') ? '' : ' ')
  } else {
    replacement = common.length > word.length ? esc(common) : word
  }
  const nextHead = before + replacement
  return {
    value: nextHead + tail,
    cursor: [...nextHead].length,
    cands: cands.length > 1 ? cands : [],
  }
}
