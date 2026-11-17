// 自我測試：用「真正的遊戲控制器」把每一關的參考解答打進常駐的互動式 bash（PTY）玩一遍。
// 這條路徑與玩家實際遊玩完全相同（輸入框 → PTY → 結束標記 → 判定 → 換關），
// 不同於 `verify` 以非互動 bash -c 執行解答。用來抓出只有在真實遊玩時才會出現的問題。
import { resetProgress } from './engine/game'
import { loadCatalog } from './engine/levels'
import { loadState } from './engine/state'
import { Controller } from './hud/controller'

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** 把解答切成「語法完整」的邏輯指令（處理 heredoc 與 for/if/case 等多行結構）。 */
export function splitCommands(sol: string): string[] {
  const out: string[] = []
  let buf: string[] = []
  let heredoc: string | null = null
  for (const line of sol.replace(/\n+$/, '').split('\n')) {
    buf.push(line)
    if (heredoc) {
      if (line.trim() === heredoc) heredoc = null
      else continue
    } else {
      const m = /<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(line)
      if (m) {
        heredoc = m[1]!
        continue
      }
    }
    const chunk = buf.join('\n')
    const r = Bun.spawnSync(['bash', '-n', '-c', chunk], { stderr: 'ignore' })
    if (r.exitCode === 0) {
      if (chunk.trim() && !chunk.trim().startsWith('#')) out.push(chunk)
      buf = []
    }
  }
  if (buf.join('\n').trim()) out.push(buf.join('\n'))
  return out
}

async function idle(ctl: Controller, ms: number): Promise<boolean> {
  const t0 = Date.now()
  while (ctl.busy) {
    if (Date.now() - t0 > ms) return false
    await sleep(40)
  }
  return true
}

export async function runSelftest(filter?: string): Promise<number> {
  process.env.LBP_NO_LLM = '1' // 模型預熱會佔用 CPU，影響有計時的關卡
  const cat = loadCatalog()
  resetProgress()
  const ctl = new Controller()
  ctl.start()
  const t0 = Date.now()
  while (!ctl.ready) {
    if (Date.now() - t0 > 20000) {
      console.log('✘ 遊戲 shell 沒有在 20 秒內就緒')
      return 1
    }
    await sleep(50)
  }
  await idle(ctl, 30000)

  const failures: string[] = []
  let ran = 0
  for (const l of cat.levels) {
    if (filter && !l.id.startsWith(filter)) continue
    ran++
    const started = Date.now()
    // 前往該關（模擬玩家用 /goto 跳關）
    if (loadState().current !== l.id) {
      ctl.submit(`/goto ${l.id}`)
      await sleep(100)
      if (!(await idle(ctl, 60000))) {
        failures.push(`${l.id} ${l.title}: 跳關後 shell 沒有回到提示字元`)
        continue
      }
    }
    let hung = false
    const trace: string[] = []
    for (const cmd of splitCommands(l.solution)) {
      ctl.submit(cmd)
      await sleep(60)
      if (!(await idle(ctl, 45000))) {
        ctl.interrupt()
        hung = true
        failures.push(`${l.id} ${l.title}: 指令逾時卡住：${cmd.split('\n')[0]}`)
        await idle(ctl, 5000)
        break
      }
      const e = ctl.lastCmd()
      if (e) trace.push(`   $ ${cmd.split('\n')[0]}  → rc=${e.rc}${e.lines.length ? '  out=' + e.lines.slice(0, 3).join(' | ').replace(/\x1b\[[0-9;]*m/g, '').slice(0, 160) : ''}`)
    }
    if (hung) continue
    await sleep(80)
    const s = loadState()
    // 通過後引擎已經換到下一關，所以看 done
    if (!s.done[l.id]) {
      const ps = Bun.spawnSync(['bash', '-c', "ps -eo pid,user,stat,etime,args | grep -E 'cpu-hog|yes|hog' | grep -v grep | head -5"]).stdout.toString().trim()
      failures.push(`${l.id} ${l.title}: 打完解答後仍未通過${s.feedback ? `（回饋：${s.feedback}）` : ''}\n${trace.join('\n')}${ps ? '\n   ps: ' + ps.replace(/\n/g, '\n       ') : ''}`)
      console.log(`✘ ${l.id} ${l.title}`)
    } else {
      console.log(`✔ ${l.id} ${l.title}  (${((Date.now() - started) / 1000).toFixed(1)}s)`)
    }
  }
  ctl.shutdown()
  console.log(failures.length ? `\n有 ${failures.length} 關在真實遊玩路徑下失敗：\n${failures.join('\n')}` : `\n全部通過（${ran} 關，真實遊玩路徑）`)
  return failures.length ? 1 : 0
}
