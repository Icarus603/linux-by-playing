// 建置時執行：匯入 man page、tldr-pages、核心文件，輸出 ref.json 供 RAG 使用。
import { join } from 'node:path'
import { loadCatalog } from '../engine/levels'
import { buildRef } from './ingest'

export function buildKnowledge(out: string, refsDir = process.env.LBP_REFS ?? '/refs'): { total: number; bySource: Record<string, number> } {
  const taught = new Set(loadCatalog().levels.flatMap((l) => l.teaches))
  return buildRef(out.endsWith('.json') ? out.replace(/man\.json$/, 'ref.json') : join(out, 'ref.json'), refsDir, taught)
}
