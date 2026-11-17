#!/usr/bin/env bun
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { goto, hint, listLevels, resetLevel, setAnswer, skip, tick, verify } from './engine/game'
import { LEVELS_DIR, loadCatalog } from './engine/levels'

const [cmd, ...args] = process.argv.slice(2)

async function main(): Promise<number> {
  switch (cmd) {
    case 'tick':
      process.stdout.write(tick(process.env.LBP_LAST ?? '', process.env.LBP_CWD ?? '', process.env.LBP_RC ?? '0'))
      return 0
    case 'hint':
      console.log(hint())
      return 0
    case 'skip':
      console.log(skip())
      return 0
    case 'goto':
      console.log(goto(args[0] ?? ''))
      return 0
    case 'reset':
      console.log(resetLevel())
      return 0
    case 'levels':
      console.log(listLevels())
      return 0
    case 'answer':
      setAnswer(args.join(' '))
      return 0
    case 'play':
    case 'hud': {
      const { runHud } = await import('./hud/main')
      await runHud()
      return 0
    }
    case 'start': {
      const { runHud } = await import('./hud/main')
      await runHud()
      return 0
    }
    case 'verify': {
      const { ok, report } = verify(args[0])
      console.log(report.join('\n'))
      console.log(ok ? `\n全部通過（${report.length} 關）` : '\n有關卡未通過')
      return ok ? 0 : 1
    }
    case 'build-knowledge': {
      const { buildKnowledge } = await import('./ask/manindex')
      const r = buildKnowledge(args[0] ?? '/game/knowledge/ref.json', args[1])
      console.log(`已匯入 ${r.total} 個知識塊`, r.bySource)
      return 0
    }
    case 'ask': {
      // 除錯：看檢索結果與離線答案（不呼叫模型）
      const { search } = await import('./ask/kb')
      const { answerOffline } = await import('./ask/answer')
      const q = args.join(' ')
      const hits = search(q, 5)
      for (const h of hits) console.log(`${h.score.toFixed(1).padStart(5)} cov=${h.cov.toFixed(2)}  [${h.kind}] ${h.title}`)
      console.log('\n離線答案：' + answerOffline(q, hits))
      return 0
    }
    case 'ask-llm': {
      // 端到端測試：完整走一遍 檢索 → 模型 → 簡短回答，並量測延遲
      const { ask } = await import('./ask/answer')
      const t0 = Date.now()
      let first = 0
      await ask(
        args.join(' '),
        {
          begin: () => {},
          update: () => {
            if (!first) first = Date.now() - t0
          },
          done: (t, src) => console.log(`[${src}] 總計 ${((Date.now() - t0) / 1000).toFixed(1)}s（第一次更新 ${(first / 1000).toFixed(1)}s）\n${t}\n`),
        },
        new AbortController().signal,
      )
      return 0
    }
    case 'selftest': {
      const { runSelftest } = await import('./selftest')
      return runSelftest(args[0])
    }
    case 'lint': {
      const c = loadCatalog()
      console.log(`OK：${c.levels.length} 關、${c.stages.length} 階段（${LEVELS_DIR}）`)
      return 0
    }
    case 'coverage': {
      const c = loadCatalog()
      const taught = new Set(c.levels.flatMap((l) => l.teaches))
      const doc = join(import.meta.dir, '../docs/CURRICULUM.md')
      if (!existsSync(doc)) return 1
      const wanted = new Set<string>()
      for (const line of readFileSync(doc, 'utf8').split('\n')) {
        if (!line.startsWith('`')) continue
        for (const m of line.matchAll(/`([^`]+)`/g)) for (const w of m[1]!.split(/\s+/)) if (/^[a-z][a-z0-9_.-]*$/.test(w)) wanted.add(w)
      }
      const missing = [...wanted].filter((w) => !taught.has(w)).sort()
      console.log(`課程地圖 ${wanted.size} 個指令，已覆蓋 ${wanted.size - missing.length}，未覆蓋 ${missing.length}`)
      if (missing.length) console.log(missing.join(' '))
      return 0
    }
    default:
      console.log('用法: lbp <start|hud|tick|hint|skip|goto|reset|levels|answer|verify|lint|coverage>')
      return cmd ? 1 : 0
  }
}

process.exit(await main())
