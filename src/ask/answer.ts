import { loadCatalog } from '../engine/levels'
import { loadState } from '../engine/state'
import { type Hit, search, searchFused } from './kb'
import { type ChatMsg, chatStream, ensureServer, llmConfigured } from './llm'

// 把檢索到的資料交給模型（或在沒有模型時直接用知識庫作答），並嚴格限制回答的長度與風格，
// 讓 Pip 的對話框不會被撐爆。

/** 顯示用的硬上限（字元，中文一字算一）。 */
export const MAX_CHARS = 600
/** BM25 分數低於此值就視為「知識庫沒有可靠資料」，不讓小模型自由發揮。 */
export const MIN_SCORE = 6
/** 問題中有資訊量的詞至少要有這個比例被命中，才算相關（擋掉離題問題）。 */
export const MIN_COV = 0.34
const reliable = (h: Hit | undefined): h is Hit => !!h && h.score >= MIN_SCORE && (h.cov >= MIN_COV || (h.score >= 18 && h.cov >= 0.12))

// 只用「一套」系統提示與固定的範例對話：llama-server 會快取相同的提示詞前綴，
// 之後每個問題只需要處理最後變動的那一小段（參考資料 + 問題），可省下大半的等待時間。
const SYSTEM = `你是 Pip，住在 Linux 太空站的企鵝助教，是精通 Linux 命令列、系統管理與排錯的專家，個性親切、有精神。你正在和使用者「對話」，要根據整段對話的上下文理解對方真正的意思（例如「你是誰」是在問你自己，不是 whoami 指令；「那 -r 呢」是接著上一個話題問）。
規則：
1. 只用繁體中文，像朋友聊天。打招呼、道謝、閒聊、問你自己，都像正常對話一樣自然回應。
2. 有時訊息會附上【可能相關的參考資料】，那是自動檢索的，可能不相關。只有確實符合使用者意圖時才採用，不相關就完全忽略，絕對不要因為有資料就硬套。
3. 技術問題沒把握就坦白說不確定，不要編造，並建議用 /explain 指令名稱 或 man 指令名稱。
4. 如果問題和 Linux、電腦、命令列無關，要先坦白說這不是你的專長、你是 Linux 專家，再簡短回應，並把話題帶回 Linux。
5. 回答要讓人真的看懂：簡單的問題 2–3 句就好；技術問題要說明「是什麼、為什麼、怎麼做」，附上一兩個可直接複製的指令範例與常見陷阱，通常 4–8 句、約 150–350 字。用自然的段落，不要 Markdown 標題或表格，指令直接寫出來。`

const SHOTS: [string, string][] = [
  ['【可能相關的參考資料（不相關就忽略）】\n[1] 問：怎麼離開 vim？\n答：按 Esc 回到一般模式，輸入 :wq 存檔離開，或 :q! 放棄修改離開。\n\n問題：vim 怎麼退出', '先按 Esc 回到一般模式，然後輸入 :wq 存檔離開；想放棄修改就輸入 :q! 喔。'],
  ['問題：你是誰', '我是 Pip，住在 Kernel-7 號站的企鵝助教，專門陪你學 Linux 命令列！想知道目前登入的是哪個使用者，才是用 whoami 喔。'],
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
    .replace(/`/g, '')
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

/** 問 Pip 自己（你是誰 / 你是什麼…）：短句才算，避免誤傷「怎麼查我是誰」這類 Linux 問題。 */
export const isAboutPip = (t: string): boolean => t.length <= 14 && /(你是誰|你是谁|你是什麼|你是什么|你是啥|你是人|你是機器人|你是ai|who are you|what are you|你叫什麼|你叫什么|介紹一下你|介绍一下你)/i.test(t)

/** 沒有模型時的寒暄與閒聊（簡單規則）。回傳 null 表示不是寒暄。 */
export function chitchat(q: string): string | null {
  const t = q.trim().toLowerCase().replace(/[!！?？。.~～]+$/g, '')
  if (t.length > 14) return null // 長句通常是帶著 Linux 問題，不算寒暄
  if (/^(你好|您好|哈囉|哈啰|嗨|嗨嗨|hello|hi|hey|早安|午安|晚安|安安|在嗎|在吗)(啊|呀|喔|哦|啦|呢)?[,，\s]*(pip)?$/.test(t)) return '你好呀！我是 Pip，Kernel-7 號站的領航企鵝。有什麼 Linux 問題都可以問我，例如「怎麼找檔案？」或「chmod 755 是什麼意思？」'
  if (/(謝謝|谢谢|感謝|感谢|thanks|thank you|多謝)/.test(t)) return '不客氣！有問題隨時叫我。'
  if (isAboutPip(t)) return '我是 Pip，一隻住在 Kernel-7 號空間站的企鵝助教，負責陪你學 Linux 命令列，也能回答各種 Linux 問題。'
  if (/(再見|再见|掰掰|拜拜|bye)/.test(t)) return '掰掰！想離開遊戲就輸入 /quit，進度都會自動存好。'
  if (/(你會什麼|你能做什麼|你可以做什麼|可以幫我做什麼|你能幫我做什麼|你能幫我什麼|怎麼用你)/.test(t)) return '我可以回答 Linux 問題、解釋指令（/explain）、幫你看進度（/map）。直接用中文問我就好！'
  return null
}

/** 沒有模型、知識庫也沒有可靠資料時的備援訊息：友善、誠實，並說明原因。 */
export const OFFLINE_FALLBACK =
  '這方面我不是專家，我專攻 Linux 啦！你可以問我指令用法、排錯、系統管理，或試試 /explain 指令名稱、man 指令名稱。'

/** 沒有模型時，直接由知識庫給確定性的答案。 */
export function answerOffline(q: string, hits: Hit[]): string {
  const social = chitchat(q)
  if (social) return social
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

/**
 * 查詢改寫：請模型把口語問題轉成英文指令名稱與技術關鍵字（「誰在大量寫磁碟」→ iotop iostat），
 * 補上 BM25 缺少的語意橋接。沿用同一個系統提示前綴，所以 llama-server 的前綴快取仍然有效。
 */
export async function expandQuery(q: string, signal: AbortSignal): Promise<string> {
  try {
    if (!llmConfigured() || !(await ensureServer())) return ''
    const msgs: ChatMsg[] = [
      ...prefixMessages(),
      { role: 'user', content: `【改寫任務】請把下面的問題改寫成 3 到 8 個英文指令名稱或技術關鍵字（例如 iotop iostat ulimit nofile），只輸出關鍵字並用空格分隔，不要任何其他文字。\n問題：${q}` },
    ]
    let acc = ''
    for await (const piece of chatStream(msgs, signal, 40)) acc += piece
    return [...new Set(acc.toLowerCase().match(/[a-z][a-z0-9_.+-]{1,}/g) ?? [])].slice(0, 10).join(' ')
  } catch {
    return ''
  }
}

/** 最近幾輪對話（只存使用者原話與 Pip 的回答，不含參考資料），讓模型理解上下文與追問。 */
const history: ChatMsg[] = []
const MAX_TURNS = 6
function remember(q: string, a: string): void {
  history.push({ role: 'user', content: `問題：${q}` }, { role: 'assistant', content: a })
  while (history.length > MAX_TURNS * 2) history.splice(0, 2)
}
const lastUserQ = (): string => (history.length >= 2 ? history[history.length - 2]!.content.replace(/^問題：/, '') : '')

/** 完整流程：先理解這句話（寒暄 / 問 Pip / 追問 / 技術問題）→ 技術問題才檢索 → 一律交給模型「對話」式回答。 */
const STORY_RE = /warden|vega|ghost|aurora|echo-lima|kernel-7|空間站|太空站|劇情|故事|失蹤|守護程序|幽靈|真相|兇手|誰關了/i

/** 劇情問題（Warden 是誰、Vega 去哪了…）：只能依玩家「已經揭露」的碎片回答，不能劇透。 */
function storyNote(q: string): string | null {
  if (!STORY_RE.test(q)) return null
  let lore: { id: string; text: string }[] = []
  try {
    lore = loadState().lore
  } catch {}
  const known = lore.length ? lore.map((l, i) => `${i + 1}. ${l.text}`).join('\n') : '（目前還沒有任何線索）'
  return `【劇情進度：玩家目前查到的線索】\n${known}\n（只能依這些線索回答。沒提到的事，就說「這個我們還沒查到」，並鼓勵繼續破關；不要編造、不要劇透。）`
}

export async function ask(q: string, sink: Sink, signal: AbortSignal): Promise<void> {
  sink.begin('讓我想想…')
  // 寒暄與問 Pip 自己不檢索（「你是誰」會誤中 whoami）；很短的追問（「那 -r 呢」）把上一題接上去一起檢索
  const story = storyNote(q)
  const social = chitchat(q) !== null || story !== null
  const searchQ = !social && [...q].length <= 8 && lastUserQ() ? `${lastUserQ()} ${q}` : q
  let hits = social ? [] : search(searchQ, 5)
  // 第一輪沒有把握（常見於用「現象」而非指令名稱描述的問題）：請模型補上英文關鍵字再檢索一次
  const strong = hits[0] && hits[0].score >= 60 && hits[0].cov >= 0.6
  if (!social && !strong && llmConfigured()) {
    sink.update('查一下資料…')
    const kw = await expandQuery(q, signal)
    if (kw && !signal.aborted) hits = searchFused(searchQ, kw, 5)
  }
  const confident = reliable(hits[0])
  const offline = answerOffline(q, hits)
  // 沒有模型：寒暄用規則回應、有可靠資料用知識庫、否則誠實說明
  if (!llmConfigured()) return sink.done(offline, confident ? 'kb' : 'unsure')

  sink.update('想一想怎麼說…')
  const ready = await ensureServer()
  if (!ready || signal.aborted) return sink.done(offline, 'kb')

  const messages: ChatMsg[] = [
    ...prefixMessages(),
    ...history,
    // 資料只是「可能相關」的參考：由模型依對話判斷要不要用
    { role: 'user', content: story ? `${story}\n\n問題：${q}` : confident ? `【可能相關的參考資料（不相關就忽略）】\n${context(hits)}\n\n問題：${q}` : `問題：${q}` },
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
  remember(q, text)
  sink.done(text, 'model')
}
