import { existsSync, readFileSync, statSync } from 'node:fs'
import { cpus } from 'node:os'

// 本機小模型（llama.cpp 的 llama-server，OpenAI 相容 API）。沒有模型或無法啟動時，呼叫端會退回離線知識庫。
const PORT = Number(process.env.LBP_LLM_PORT ?? 8099)
const BASE = process.env.LBP_LLM_URL ?? `http://127.0.0.1:${PORT}`
const BIN = process.env.LBP_LLM_BIN ?? '/game/llm/llama-server'
const MODEL = process.env.LBP_LLM_MODEL ?? '/game/llm/model.gguf'

export type ChatMsg = { role: 'system' | 'user' | 'assistant'; content: string }

/** 是否「可能」有 LLM 可用（有外部端點，或有內建模型與伺服器）。 */
export function llmConfigured(): boolean {
  if (process.env.LBP_NO_LLM) return false // 自我測試等情境停用，避免干擾計時
  return !!process.env.LBP_LLM_URL || (existsSync(BIN) && existsSync(MODEL))
}

/** 可用記憶體是否足夠載入模型（模型檔大小 ×1.35 + 300MB 給 KV 快取與執行期）。不夠就不硬撐，改用離線知識庫。 */
export function enoughMemory(): boolean {
  try {
    const need = statSync(MODEL).size * 1.35 + 300 * 1048576
    const m = /MemAvailable:\s+(\d+)/.exec(readFileSync('/proc/meminfo', 'utf8'))
    return m ? Number(m[1]) * 1024 >= need : true
  } catch {
    return true
  }
}

async function healthy(): Promise<boolean> {
  try {
    const r = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) })
    return r.ok
  } catch {
    return false
  }
}

let starting: Promise<boolean> | null = null

/** 確保伺服器在跑（第一次提問時才啟動，避免平常佔用記憶體）。 */
export function ensureServer(): Promise<boolean> {
  if (starting) return starting
  starting = (async () => {
    if (await healthy()) return true
    if (process.env.LBP_LLM_URL || !existsSync(BIN) || !existsSync(MODEL)) return false
    if (!enoughMemory()) return false
    const threads = Math.max(2, Math.min(8, cpus().length - 1))
    Bun.spawn(
      [
        'nice', '-n', '10', // 低優先權：不要跟玩家正在跑的關卡搶 CPU
        BIN, '-m', MODEL, '--host', '127.0.0.1', '--port', String(PORT), '-c', '3072', '-np', '1', '-t', String(threads),
        '--no-webui', '--jinja', '--reasoning-budget', '0', '--chat-template-kwargs', '{"enable_thinking":false}',
      ],
      { stdout: 'ignore', stderr: 'ignore', stdin: 'ignore' },
    ).unref()
    for (let i = 0; i < 240; i++) {
      await Bun.sleep(500)
      if (await healthy()) return true
    }
    return false
  })()
  starting.then((ok) => {
    if (!ok) starting = null // 失敗時允許下次重試
  })
  return starting
}

/** 以 SSE 串流取得回答的文字片段。 */
export async function* chatStream(messages: ChatMsg[], signal: AbortSignal, maxTokens = 160): AsyncGenerator<string> {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'local',
      messages,
      stream: true,
      temperature: 0.25,
      top_p: 0.9,
      repeat_penalty: 1.08,
      max_tokens: maxTokens,
      cache_prompt: true,
      chat_template_kwargs: { enable_thinking: false },
    }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}`)
  const dec = new TextDecoder()
  let buf = ''
  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim()
      buf = buf.slice(i + 1)
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      try {
        const j = JSON.parse(data) as { choices?: { delta?: { content?: string } }[] }
        const t = j.choices?.[0]?.delta?.content
        if (t) yield t
      } catch {}
    }
  }
}
