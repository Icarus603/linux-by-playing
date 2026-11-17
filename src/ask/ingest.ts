// 建置時執行：把多個「參考資料來源」匯入成統一的知識塊（chunk），輸出成 ref.json。
// 來源：tldr-pages（實用範例，CC BY 4.0）、系統 man page（語法與選項、概念文件）、
// Linux 核心文件（sysctl 與子系統參數，GPL-2.0）。手寫的專業條目另外放在 knowledge/*.yaml。
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Chunk } from './kb'

const squash = (s: string): string => s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
const sh = (script: string, timeout = 5000): string =>
  Bun.spawnSync(['bash', '-c', script], { stdin: 'ignore', timeout, env: { ...process.env, MANWIDTH: '110', LC_ALL: 'C.UTF-8' } }).stdout.toString()

// ───────────────────────── tldr-pages ─────────────────────────
// 每個範例一個知識塊：「tar：Create an archive and write it to a file」→ 指令列。
export function ingestTldr(dir: string): Chunk[] {
  const out: Chunk[] = []
  for (const platform of ['common', 'linux']) {
    const pdir = [join(dir, platform), join(dir, 'pages', platform)].find(existsSync)
    if (!pdir) continue
    for (const f of readdirSync(pdir)) {
      if (!f.endsWith('.md')) continue
      const lines = readFileSync(join(pdir, f), 'utf8').split('\n')
      const name = (lines[0] ?? '').replace(/^#\s*/, '').trim() || f.replace(/\.md$/, '')
      const desc = lines
        .filter((l) => l.startsWith('>') && !/More information|See also|Preview|^> \(?[Tt]his command is an alias/.test(l))
        .map((l) => l.replace(/^>\s*/, '').replace(/<(https?:[^>]+)>/g, '').trim())
        .filter(Boolean)
        .join(' ')
      let curDesc = ''
      for (const l of lines) {
        const d = /^- (.+):\s*$/.exec(l)
        if (d) {
          curDesc = d[1]!.replace(/\[(\w)\]/g, '$1')
          continue
        }
        const c = /^`(.+)`$/.exec(l)
        if (c && curDesc) {
          const cmd = c[1]!.replace(/\{\{([^}]*)\}\}/g, '<$1>')
          out.push({
            id: `tldr-${platform}-${name}-${out.length}`,
            kind: 'tldr',
            title: `${name}：${curDesc}`,
            text: cmd,
            keys: `${name} ${name} ${curDesc} ${cmd} ${desc.slice(0, 90)}`,
            cmd: name,
          })
          curDesc = ''
        }
      }
    }
  }
  return out
}

// ───────────────────────── man page ─────────────────────────
function manSections(page: string): Record<string, string> {
  const secs: Record<string, string> = {}
  let cur = ''
  for (const line of page.split('\n')) {
    const h = /^([A-Z][A-Z0-9 ,/&-]{2,})\s*$/.exec(line)
    if (h) {
      cur = h[1]!.trim()
      secs[cur] = ''
    } else if (cur) secs[cur] += line + '\n'
  }
  return secs
}

function windows(text: string, size: number, max: number): string[] {
  const paras = text.split(/\n\s*\n/).map((p) => squash(p)).filter(Boolean)
  const out: string[] = []
  let cur = ''
  for (const p of paras) {
    if ((cur + ' ' + p).length > size && cur) {
      out.push(cur)
      cur = p
    } else cur = cur ? cur + ' ' + p : p
    if (out.length >= max) break
  }
  if (cur && out.length < max) out.push(cur)
  return out
}

export function ingestMan(taught: Set<string>): Chunk[] {
  const list = sh('man -k . 2>/dev/null', 40000).split('\n')
  const seen = new Set<string>()
  const out: Chunk[] = []
  for (const line of list) {
    const m = /^(\S+)\s+\((\w+)[^)]*\)\s+-\s+(.*)$/.exec(line)
    if (!m) continue
    const [, name, sec, what] = m as unknown as [string, string, string, string]
    if (!['1', '2', '5', '7', '8'].includes(sec[0]!)) continue
    if (!/^[A-Za-z0-9][A-Za-z0-9_.+:-]*$/.test(name)) continue
    const key = `${name}.${sec[0]}`
    if (seen.has(key)) continue
    seen.add(key)
    const whatis = squash(what)
    const s = sec[0]!
    if (s === '2') {
      out.push({ id: `man-${key}`, kind: 'cmd', title: `${name}(2)`, text: whatis, keys: `${name} ${name} ${whatis} system call syscall 系統呼叫`, cmd: name })
      continue
    }
    const page = sh(`man -P cat ${s} ${name} 2>/dev/null | col -b`)
    if (!page) {
      out.push({ id: `man-${key}`, kind: 'cmd', title: name, text: whatis, keys: `${name} ${name} ${whatis}`, cmd: name })
      continue
    }
    const secs = manSections(page)
    const synopsis = squash(secs['SYNOPSIS'] ?? '').slice(0, 260)
    const description = squash(secs['DESCRIPTION'] ?? secs['OVERVIEW'] ?? '')
    const options = squash(secs['OPTIONS'] ?? secs['COMMANDS'] ?? '')
    const examples = squash(secs['EXAMPLES'] ?? secs['EXAMPLE'] ?? '')
    const files = squash(secs['FILES'] ?? '').slice(0, 500)

    if (s === '7') {
      // 概念性文件（cgroups、namespaces、capabilities、signal、tcp…）：依段落切成多個知識塊
      const body = [secs['DESCRIPTION'], secs['NOTES'], secs['VERSIONS']].filter(Boolean).join('\n\n')
      windows(body, 1100, 8).forEach((w, i) =>
        out.push({ id: `man-${key}-${i}`, kind: 'concept', title: `${name}(7)${i ? ` #${i + 1}` : ''}`, text: w.slice(0, 1100), keys: `${name} ${name} ${whatis} ${w}`, cmd: name }),
      )
      continue
    }
    const isTaught = taught.has(name)
    out.push({
      id: `man-${key}`,
      kind: 'cmd',
      title: name,
      text: whatis,
      // detail 只給模型當參考：語法 + 說明 + 選項（重要指令保留更多）
      detail: [synopsis && `用法：${synopsis}`, description && `說明：${description.slice(0, isTaught ? 700 : 380)}`, options && `選項：${options.slice(0, isTaught ? 1500 : 700)}`, examples && `範例：${examples.slice(0, 500)}`, files && `檔案：${files}`]
        .filter(Boolean)
        .join('\n'),
      // keys 讓旗標與說明文字也能被檢索到（例如問「rsync 的 --delete 是什麼」）
      keys: `${name} ${name} ${name} ${whatis} ${synopsis} ${description.slice(0, 700)} ${options.slice(0, 2500)}`,
      cmd: name,
    })
  }
  return out
}

// ───────────────────────── 核心文件 ─────────────────────────
export function ingestKernelDocs(dir: string): Chunk[] {
  const out: Chunk[] = []
  if (!existsSync(dir)) return out
  for (const f of readdirSync(dir)) {
    const text = readFileSync(join(dir, f), 'utf8')
    const base = f.replace(/\.(rst|txt)$/, '')
    // 1) sysctl 風格的「參數名 - 型別」條目（ip-sysctl.rst）
    const lines = text.split('\n')
    let curName = ''
    let buf: string[] = []
    const flush = (): void => {
      if (curName && buf.length) {
        const body = squash(buf.join('\n'))
        out.push({ id: `kdoc-${base}-${out.length}`, kind: 'kdoc', title: `${curName}（核心文件 ${base}）`, text: body.slice(0, 1100), keys: `${curName} ${curName} ${curName} ${base} ${body.slice(0, 1500)}` })
      }
      buf = []
    }
    let usedParam = 0
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!
      const param = /^([a-z0-9_./\-*]+)\s+-\s+[A-Z][A-Za-z ,/]+$/.exec(l) // 例：tcp_tw_reuse - INTEGER
      const head = lines[i + 1] && /^(=+|-+|~+|\^+)$/.test(lines[i + 1]!.trim()) && l.trim() && !/^\s/.test(l) && lines[i + 1]!.trim().length >= Math.min(l.trim().length, 3) // RST 標題
      if (param) {
        flush()
        curName = param[1]!
        usedParam++
        buf = []
      } else if (head && usedParam < 3) {
        flush()
        curName = l.trim()
        buf = []
        i++
      } else if (curName) buf.push(l)
    }
    flush()
    // 2) 沒有條目結構的長文件（kernel-parameters.txt 等）：按段落視窗切塊
    if (out.filter((c) => c.id.startsWith(`kdoc-${base}-`)).length < 3) {
      windows(text, 1000, 400).forEach((w, i) => out.push({ id: `kdoc-${base}-w${i}`, kind: 'kdoc', title: `${base} #${i + 1}`, text: w.slice(0, 1000), keys: `${base} ${w}` }))
    }
  }
  return out
}

/** 匯入全部來源並寫出 ref.json。 */
export function buildRef(outFile: string, refsDir: string, taught: Set<string>): { total: number; bySource: Record<string, number> } {
  const man = ingestMan(taught)
  const tldr = ingestTldr(join(refsDir, 'tldr'))
  const kdoc = ingestKernelDocs(join(refsDir, 'kdoc'))
  const all = [...man, ...tldr, ...kdoc]
  writeFileSync(outFile, JSON.stringify(all))
  return { total: all.length, bySource: { man: man.length, tldr: tldr.length, kdoc: kdoc.length } }
}
