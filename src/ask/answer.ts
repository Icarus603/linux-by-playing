import { loadCatalog } from '../engine/levels'
import { type Hit, search } from './kb'
import { type ChatMsg, chatStream, ensureServer, llmConfigured } from './llm'

// 把檢索到的資料交給模型（或在沒有模型時直接用知識庫作答），並嚴格限制回答的長度與風格，
// 讓 Pip 的對話框不會被撐爆。

/** 顯示用的硬上限（字元，中文一字算一）。 */
export const MAX_CHARS = 200
/** BM25 分數低於此值就視為「知識庫沒有可靠資料」，不讓小模型自由發揮。 */
export const MIN_SCORE = 6
/** 問題中有資訊量的詞至少要有這個比例被命中，才算相關（擋掉離題問題）。 */
export const MIN_COV = 0.34
/** 命中手寫條目且分數與覆蓋率都很高時，直接給標準答案。 */
const STRONG_SCORE = 35
const STRONG_COV = 0.55
const reliable = (h: Hit | undefined): h is Hit => !!h && h.score >= MIN_SCORE && (h.cov >= MIN_COV || (h.score >= 18 && h.cov >= 0.12))

// 只用「一套」系統提示與固定的範例對話：llama-server 會快取相同的提示詞前綴，
// 之後每個問題只需要處理最後變動的那一小段（參考資料 + 問題），可省下大半的等待時間。
const SYSTEM = `你是 Pip，住在 Linux 太空站的企鵝助教，是精通 Linux 命令列、系統管理與排錯的專家，個性親切、有精神。
規則：
1. 只用繁體中文，像朋友聊天。打招呼、道謝、閒聊都正常回應。
2. 訊息裡有【參考資料】時，優先根據它回答；資料不夠可以用你自己的知識簡短補充，但沒把握就坦白說不確定，不要編造。
3. 沒有參考資料時，用你自己的知識簡短回答；Linux 問題沒把握就老實說，並建議用 /explain 指令名稱 或 man 指令名稱。
4. 如果問題和 Linux、電腦、命令列無關，要先坦白說這不是你的專長、你是 Linux 專家，再簡短回應，並把話題帶回 Linux。
5. 最多 3 句話，總共不超過 100 字。不要寫長篇、不要列點、不要 Markdown。指令與路徑直接寫出來，只給最重要的一個範例。`

const SHOTS: [string, string][] = [
  ['【參考資料】\n[1] 問：怎麼離開 vim？\n答：按 Esc 回到一般模式，輸入 :wq 存檔離開，或 :q! 放棄修改離開。\n\n問題：vim 怎麼退出', '先按 Esc 回到一般模式，然後輸入 :wq 存檔離開；想放棄修改就輸入 :q! 喔。'],
  ['問題：你好', '你好呀！我是 Pip，Kernel-7 號站的領航企鵝，專攻 Linux。有什麼指令或排錯的問題都可以問我喔！'],
  ['問題：推薦一部電影', '電影我不是專家啦，我專攻 Linux！不過想聊指令、排錯或系統管理的話，我隨時奉陪。'],
]

/** 固定不變的前綴（系統提示 + 範例對話），會被 llama-server 快取。 */
export function prefixMessages(): ChatMsg[] {
  return [
    { role: 'system', content: SYSTEM },
    ...SHOTS.flatMap(([u, a]): ChatMsg[] => [
      { role: 'user', content: u },
      { role: 'assistant', content: a },
    ]),
  ]
}

/** 背景預熱：先把固定前綴處理進快取，第一次提問就不必再付這筆時間（4B 約 10 秒）。 */
export async function warmup(): Promise<void> {
  if (!llmConfigured()) return
  try {
    if (!(await ensureServer())) return
    const ac = new AbortController()
    for await (const _ of chatStream([...prefixMessages(), { role: 'user', content: '問題：你好' }], ac.signal, 1)) break
    ac.abort()
  } catch {}
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

/**
 * 組成給模型的參考資料。刻意很短：小模型的瓶頸在「提示詞處理」（本機 CPU 約 50–100 tok/s），
 * 參考資料每多 100 個字，使用者就多等約 1 秒。所以只放最相關的 2 條，並截斷詳細內容。
 */
function context(hits: Hit[]): string {
  return hits
    .slice(0, 2)
    .map((h, i) => {
      if (h.kind === 'faq') return `[${i + 1}] 問：${h.title}\n答：${h.text}${h.detail ? '\n補充：' + clip(h.detail, 150) : ''}`
      if (h.kind === 'cmd') return `[${i + 1}] 指令 ${h.title}：${clip(h.text, 80)}${h.detail ? '\n' + clip(h.detail, 260) : ''}`
      if (h.kind === 'tldr') return `[${i + 1}] 範例 ${h.title}\n${clip(h.text, 160)}`
      if (h.kind === 'concept' || h.kind === 'kdoc') return `[${i + 1}] ${h.title}：${clip(h.text, 320)}`
      return `[${i + 1}] 關卡 ${h.levelId}《${h.title}》：${clip(h.text, 100)}`
    })
    .join('\n')
}

/** 去掉模型常見的多餘格式，並把長度壓在上限內（盡量在句尾截斷）。 */
export function tidy(raw: string, max = MAX_CHARS): string {
  let s = raw
    .replace(/<think>[\s\S]*?(<\/think>|$)/g, '')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, '').trim())
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^\s*[-*•]\s+/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim()
  if ([...s].length > max) {
    const cut = [...s].slice(0, max).join('')
    const end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('. '))
    s = end > max * 0.5 ? cut.slice(0, end + 1) : cut + '…'
  }
  return s
}

function exampleFor(cmd: string): string {
  const l = loadCatalog().levels.find((x) => x.teaches.includes(cmd))
  const ex = l?.hints.find((h) => h.includes(cmd))
  return ex ? `例如：${ex}` : ''
}

/** 沒有模型時的寒暄與閒聊（簡單規則）。回傳 null 表示不是寒暄。 */
export function chitchat(q: string): string | null {
  const t = q.trim().toLowerCase().replace(/[!！?？。.~～]+$/g, '')
  if (/^(你好|您好|哈囉|哈啰|嗨|嗨嗨|hello|hi|hey|早安|午安|晚安|安安|在嗎|在吗)/.test(t)) return '你好呀！我是 Pip，Kernel-7 號站的領航企鵝。有什麼 Linux 問題都可以問我，例如「怎麼找檔案？」或「chmod 755 是什麼意思？」'
  if (/(謝謝|谢谢|感謝|感谢|thanks|thank you|多謝)/.test(t)) return '不客氣！有問題隨時叫我。'
  if (/(你是誰|你是谁|who are you|你叫什麼|介紹一下你)/.test(t)) return '我是 Pip，一隻住在 Kernel-7 號空間站的企鵝助教，負責陪你學 Linux 命令列，也能回答各種 Linux 問題。'
  if (/(再見|再见|掰掰|拜拜|bye)/.test(t)) return '掰掰！想離開遊戲就輸入 /quit，進度都會自動存好。'
  if (/(你會什麼|你能做什麼|可以做什麼|help me|幫我|怎麼用你)/.test(t)) return '我可以回答 Linux 問題、解釋指令（/explain）、幫你看進度（/map）。直接用中文問我就好！'
  return null
}

/** 沒有模型、知識庫也沒有可靠資料時的備援訊息：友善、誠實，並說明原因。 */
export const OFFLINE_FALLBACK =
  '這方面我不是專家，我專攻 Linux 啦！你可以問我指令用法、排錯、系統管理，或試試 /explain 指令名稱、man 指令名稱。'

/** 沒有模型時，直接由知識庫給確定性的答案。 */
export function answerOffline(q: string, hits: Hit[]): string {
  const best = hits[0]
  if (!reliable(best)) return chitchat(q) ?? OFFLINE_FALLBACK
  if (best.kind === 'faq') return tidy(best.text)
  if (best.kind === 'cmd') {
    const ex = best.cmd ? exampleFor(best.cmd) : ''
    return tidy(`「${best.cmd}」：${best.text}。${ex}`)
  }
  if (best.kind === 'tldr') return tidy(`${best.title}\n${best.text}`)
  return tidy(`${best.title}：${best.text}`)
}

export type Sink = {
  /** 開始回答（顯示等待訊息） */
  begin(text: string): void
  /** 更新目前的回答文字（串流中） */
  update(text: string): void
  /** 完成；source 表示答案來源 */
  done(text: string, source: 'model' | 'kb' | 'unsure'): void
}

/** 完整流程：檢索 → （信心足夠時）請模型根據資料簡短作答 → 失敗或沒有模型就用知識庫答案。 */
export async function ask(q: string, sink: Sink, signal: AbortSignal): Promise<void> {
  sink.begin('讓我想想…')
  const hits = search(q, 5)
  const confident = reliable(hits[0])
  const offline = answerOffline(q, hits)
  // 高信心命中手寫條目：直接用審過的標準答案（即時、不會有模型改寫出錯的風險）
  const top = hits[0]
  if (top && top.kind === 'faq' && top.score >= STRONG_SCORE && top.cov >= STRONG_COV) return sink.done(offline, 'kb')
  // 沒有模型：寒暄用規則回應、有可靠資料用知識庫、否則誠實說明
  if (!llmConfigured()) return sink.done(offline, confident ? 'kb' : 'unsure')

  sink.update('想一想怎麼說…')
  const ready = await ensureServer()
  if (!ready || signal.aborted) return sink.done(offline, 'kb')

  const messages: ChatMsg[] = [
    ...prefixMessages(),
    // 有可靠資料就附上；沒有就只放問題，讓模型以 Pip 的身分自由回答（閒聊、一般問題都行）
    { role: 'user', content: confident ? `【參考資料】\n${context(hits)}\n\n問題：${q}` : `問題：${q}` },
  ]
  let acc = ''
  try {
    for await (const piece of chatStream(messages, signal)) {
      acc += piece
      sink.update(tidy(acc))
      if ([...acc].length > MAX_CHARS * 1.6) break // 模型太囉嗦，提早結束
    }
  } catch {
    if (signal.aborted) return
  }
  const text = tidy(acc)
  if (text.length < 2) return sink.done(offline, confident ? 'kb' : 'unsure')
  sink.done(text, 'model')
}
