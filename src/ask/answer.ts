import { loadCatalog, loreText } from '../engine/levels'
import { T, t, tr } from '../i18n'
import { loadState } from '../engine/state'
import type { Level } from '../engine/types'
import { type Hit, search, searchFused } from './kb'
import { type ChatMsg, chatStream, ctxTokens, ensureServer, llmConfigured } from './llm'

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
const SYSTEM = T(`你是 Pip，住在 Linux 太空站的企鵝助教，是精通 Linux 命令列、系統管理與排錯的專家，個性親切、有精神。你正在和使用者「對話」，要根據整段對話的上下文理解對方真正的意思（例如「你是誰」是在問你自己，不是 whoami 指令；「那 -r 呢」是接著上一個話題問）。
規則：
1. 只用繁體中文，像朋友聊天。打招呼、道謝、閒聊、問你自己，都像正常對話一樣自然回應。
2. 有時訊息會附上【可能相關的參考資料】，那是自動檢索的，可能不相關。只有確實符合使用者意圖時才採用，不相關就完全忽略，絕對不要因為有資料就硬套。
3. 技術問題沒把握就坦白說不確定，不要編造，並建議用 /explain 指令名稱 或 man 指令名稱。
4. 如果問題和 Linux、電腦、命令列無關，要先坦白說這不是你的專長、你是 Linux 專家，再簡短回應，並把話題帶回 Linux。
5. 回答要讓人真的看懂：簡單的問題 2–3 句就好；技術問題要說明「是什麼、為什麼、怎麼做」，附上一兩個可直接複製的指令範例與常見陷阱，通常 4–8 句、約 150–350 字。用自然的段落，不要 Markdown 標題或表格，指令直接寫出來。
6. 訊息可能附上【目前的遊戲情境】：那是玩家正在玩的關卡與終端機最近的操作。玩家說「這題」「這關」「剛才」「上面」「為什麼錯」就是指它，不用叫玩家再貼一次。可以解釋題目、輸出與錯誤、引導解題思路；預設不要直接貼出完整答案，玩家明確要答案時才給。`)

const SHOTS: [string, string][] = [
  [T('【可能相關的參考資料（不相關就忽略）】\n[1] 問：怎麼離開 vim？\n答：按 Esc 回到一般模式，輸入 :wq 存檔離開，或 :q! 放棄修改離開。\n\n問題：vim 怎麼退出'), T('先按 Esc 回到一般模式，然後輸入 :wq 存檔離開；想放棄修改就輸入 :q! 喔。')],
  [T('問題：你是誰'), T('我是 Pip，住在 Kernel-7 號站的企鵝助教，專門陪你學 Linux 命令列！想知道目前登入的是哪個使用者，才是用 whoami 喔。')],
  [T('問題：你好'), T('你好呀！我是 Pip，Kernel-7 號站的領航企鵝，專攻 Linux。有什麼指令或排錯的問題都可以問我喔！')],
  [T('問題：推薦一部電影'), T('電影我不是專家啦，我專攻 Linux！不過想聊指令、排錯或系統管理的話，我隨時奉陪。')],
]

/** 固定不變的前綴（系統提示 + 範例對話），會被 llama-server 快取。 */
export function prefixMessages(): ChatMsg[] {
  return [
    { role: 'system', content: tr(SYSTEM) },
    ...SHOTS.flatMap(([u, a]): ChatMsg[] => [
      { role: 'user', content: tr(u) },
      { role: 'assistant', content: tr(a) },
    ]),
  ]
}

/** 背景預熱：先把固定前綴處理進快取，第一次提問就不必再付這筆時間（4B 約 10 秒）。 */
export async function warmup(): Promise<void> {
  if (!llmConfigured()) return
  try {
    if (!(await ensureServer())) return
    const ac = new AbortController()
    for await (const _ of chatStream([...prefixMessages(), { role: 'user', content: t('問題：你好') }], ac.signal, 1)) break
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
      if (h.kind === 'faq') return t`[${i + 1}] 問：${h.title}\n答：${h.text}${h.detail ? t('\n補充：') + clip(h.detail, 150) : ''}`
      if (h.kind === 'cmd') return t`[${i + 1}] 指令 ${h.title}：${clip(h.text, 80)}${h.detail ? '\n' + clip(h.detail, 260) : ''}`
      if (h.kind === 'tldr') return t`[${i + 1}] 範例 ${h.title}\n${clip(h.text, 160)}`
      if (h.kind === 'concept' || h.kind === 'kdoc') return `[${i + 1}] ${h.title}：${clip(h.text, 320)}`
      return t`[${i + 1}] 關卡 ${h.levelId}《${h.title}》：${clip(h.text, 100)}`
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
  return ex ? t`例如：${ex}` : ''
}

/** 問 Pip 自己（你是誰 / 你是什麼…）：短句才算，避免誤傷「怎麼查我是誰」這類 Linux 問題。 */
export const isAboutPip = (t: string): boolean => t.length <= 14 && /(你是誰|你是谁|你是什麼|你是什么|你是啥|你是人|你是機器人|你是ai|who are you|what are you|你叫什麼|你叫什么|介紹一下你|介绍一下你)/i.test(t)

/** 沒有模型時的寒暄與閒聊（簡單規則）。回傳 null 表示不是寒暄。 */
export function chitchat(q: string): string | null {
  const s = q.trim().toLowerCase().replace(/[!！?？。.~～]+$/g, '')
  if (s.length > 14) return null // 長句通常是帶著 Linux 問題，不算寒暄
  if (/^(你好|您好|哈囉|哈啰|嗨|嗨嗨|hello|hi|hey|早安|午安|晚安|安安|在嗎|在吗)(啊|呀|喔|哦|啦|呢)?[,，\s]*(pip)?$/.test(s)) return t('你好呀！我是 Pip，Kernel-7 號站的領航企鵝。有什麼 Linux 問題都可以問我，例如「怎麼找檔案？」或「chmod 755 是什麼意思？」')
  if (/(謝謝|谢谢|感謝|感谢|thanks|thank you|多謝)/.test(s)) return t('不客氣！有問題隨時叫我。')
  if (isAboutPip(s)) return t('我是 Pip，一隻住在 Kernel-7 號空間站的企鵝助教，負責陪你學 Linux 命令列，也能回答各種 Linux 問題。')
  if (/(再見|再见|掰掰|拜拜|bye)/.test(s)) return t('掰掰！想離開遊戲就輸入 /quit，進度都會自動存好。')
  if (/(你會什麼|你能做什麼|你可以做什麼|可以幫我做什麼|你能幫我做什麼|你能幫我什麼|怎麼用你|what can you do|how do i use you)/.test(s)) return t('我可以回答 Linux 問題、解釋指令（/explain）、幫你看進度（/map）。直接用中文問我就好！')
  return null
}

/** 沒有模型、知識庫也沒有可靠資料時的備援訊息：友善、誠實，並說明原因。 */
export const OFFLINE_FALLBACK =
  T('這方面我不是專家，我專攻 Linux 啦！你可以問我指令用法、排錯、系統管理，或試試 /explain 指令名稱、man 指令名稱。')

/** 沒有模型時，直接由知識庫給確定性的答案。 */
export function answerOffline(q: string, hits: Hit[]): string {
  const social = chitchat(q)
  if (social) return social
  const best = hits[0]
  if (!reliable(best)) return chitchat(q) ?? tr(OFFLINE_FALLBACK)
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
      { role: 'user', content: t`【改寫任務】請把下面的問題改寫成 3 到 8 個英文指令名稱或技術關鍵字（例如 iotop iostat ulimit nofile），只輸出關鍵字並用空格分隔，不要任何其他文字。\n問題：${q}` },
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
const MAX_TURNS = 30
function remember(q: string, a: string): void {
  history.push({ role: 'user', content: t`問題：${q}` }, { role: 'assistant', content: a })
  while (history.length > MAX_TURNS * 2) history.splice(0, 2)
}

// ───────────── 上下文預算 ─────────────
// 上下文大小由 llm.ts 依記憶體決定（預設最多 32768 token）。中文約 1 字 ≈ 1 token，所以字數預算取 6 成並留給回答。
const budget = (): number => Math.max(2400, Math.floor(ctxTokens() * 0.6))
/** 對話歷史超出預算時，從最舊的一輪開始丟。 */
function fitHistory(reserve: number): ChatMsg[] {
  const room = budget() - reserve
  const h = [...history]
  const size = (): number => h.reduce((n, m) => n + m.content.length, 0)
  while (h.length > 2 && size() > room) h.splice(0, 2)
  return h
}

export type Activity = { cwd: string; cmd: string; out: string[]; rc: number | null }
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g
const REF_RE = /這題|這關|這個|這道|這步|上面|剛才|剛剛|前面|上一|為什麼|為何|怎麼(做|辦|解|過|會)|不對|不行|錯|失敗|卡|提示|答案|任務|目標|題目|輸出|結果|報錯|error|看不懂|什麼意思|是什麼意思|該怎麼|怎麼辦/i

function clipOut(lines: string[], maxLines: number, maxChars: number): string {
  const L = lines.map((l) => l.replace(ANSI, '').replace(/\s+$/, '')).filter((l, i, a) => l || (a[i - 1] ?? '') !== '')
  const body = L.length > maxLines ? [...L.slice(0, Math.ceil(maxLines * 0.6)), t`…（省略 ${L.length - maxLines} 行）…`, ...L.slice(-Math.floor(maxLines * 0.4))] : L
  const s = body.map((l) => (l.length > 160 ? l.slice(0, 160) + '…' : l)).join('\n')
  return s.length > maxChars ? s.slice(0, maxChars) + '…' : s
}

/** 目前關卡（永遠附上一小段）＋ 需要時附上詳細內容與最近的終端機操作。 */
function gameContext(q: string, recent: Activity[]): { text: string; referential: boolean; teaches: string } {
  let lvl: Level | undefined
  let st: ReturnType<typeof loadState> | undefined
  try {
    st = loadState()
    lvl = st.current ? loadCatalog().byId.get(st.current) : undefined
  } catch {}
  const referential = REF_RE.test(q) || [...q].length <= 10
  const parts: string[] = []
  if (lvl && st) {
    parts.push(t`目前關卡：${lvl.id}「${lvl.title}」\n任務：${lvl.goal}${lvl.teaches.length ? t`\n本關教的指令：${lvl.teaches.join('、')}` : ''}`)
    if (referential) {
      if (lvl.story) parts.push(t`關卡背景：${clip(lvl.story, 300)}`)
      const shown = lvl.hints.slice(0, st.hintsShown)
      if (shown.length) parts.push(t`玩家已看過的提示：${shown.join(' / ')}`)
      if (st.feedback) parts.push(t`系統對玩家上次嘗試的回饋：${st.feedback}`)
    }
  }
  if (referential && recent.length) {
    let room = Math.min(4000, Math.floor(budget() * 0.25))
    const blocks: string[] = []
    for (const a of [...recent].reverse().slice(0, 8)) {
      const out = clipOut(a.out, 14, 600)
      const b = t`$ ${clip(a.cmd, 200)}${a.rc !== null && a.rc !== 0 ? t`   （結束碼 ${a.rc}）` : ''}${out ? `\n${out}` : ''}`
      if (b.length > room && blocks.length) break
      room -= b.length
      blocks.unshift(b)
    }
    parts.push(t`最近的終端機操作（舊 → 新，目錄 ${recent[recent.length - 1]!.cwd}）：\n${blocks.join('\n\n')}`)
  }
  const text = parts.length ? t`【目前的遊戲情境】\n${parts.join('\n')}\n` : ''
  return { text, referential, teaches: lvl?.teaches.join(' ') ?? '' }
}
/** 切換語言時清掉對話歷史，避免模型接著用舊語言回答。 */
export function resetChat(): void {
  history.length = 0
}
const lastUserQ = (): string => (history.length >= 2 ? history[history.length - 2]!.content.replace(/^(問題：|问题：|Question: )/, '') : '')

/** 完整流程：先理解這句話（寒暄 / 問 Pip / 追問 / 技術問題）→ 技術問題才檢索 → 一律交給模型「對話」式回答。 */
const STORY_RE = /warden|vega|ghost|aurora|echo-lima|kernel-7|空間站|太空站|劇情|故事|失蹤|守護程序|幽靈|真相|兇手|誰關了/i

/** 劇情問題（Warden 是誰、Vega 去哪了…）：只能依玩家「已經揭露」的碎片回答，不能劇透。 */
function storyNote(q: string): string | null {
  if (!STORY_RE.test(q)) return null
  let lore: { id: string; text: string }[] = []
  try {
    lore = loadState().lore
  } catch {}
  const known = lore.length ? lore.map((l, i) => `${i + 1}. ${loreText(l)}`).join('\n') : t('（目前還沒有任何線索）')
  return t`【劇情進度：玩家目前查到的線索】\n${known}\n（只能依這些線索回答。沒提到的事，就說「這個我們還沒查到」，並鼓勵繼續破關；不要編造、不要劇透。）`
}

export async function ask(q: string, sink: Sink, signal: AbortSignal, recent: Activity[] = []): Promise<void> {
  sink.begin(t('讓我想想…'))
  // 寒暄與問 Pip 自己不檢索（「你是誰」會誤中 whoami）；很短的追問（「那 -r 呢」）把上一題接上去一起檢索
  const story = storyNote(q)
  const social = chitchat(q) !== null || story !== null
  const game = social ? { text: '', referential: false, teaches: '' } : gameContext(q, recent)
  // 短追問接上一題；指涉「這題」的問題把本關教的指令加進檢索，找得到對應的說明
  const searchQ = !social && [...q].length <= 8 && lastUserQ() ? `${lastUserQ()} ${q}` : game.referential && game.teaches ? `${q} ${game.teaches}` : q
  let hits = social ? [] : search(searchQ, 5)
  // 第一輪沒有把握（常見於用「現象」而非指令名稱描述的問題）：請模型補上英文關鍵字再檢索一次
  const strong = hits[0] && hits[0].score >= 60 && hits[0].cov >= 0.6
  if (!social && !strong && llmConfigured()) {
    sink.update(t('查一下資料…'))
    const kw = await expandQuery(q, signal)
    if (kw && !signal.aborted) hits = searchFused(searchQ, kw, 5)
  }
  const confident = reliable(hits[0])
  const offline = answerOffline(q, hits)
  // 沒有模型：寒暄用規則回應、有可靠資料用知識庫、否則誠實說明
  if (!llmConfigured()) return sink.done(offline, confident ? 'kb' : 'unsure')

  sink.update(t('想一想怎麼說…'))
  const ready = await ensureServer()
  if (!ready || signal.aborted) return sink.done(offline, 'kb')

  // 資料只是「可能相關」的參考：由模型依對話判斷要不要用
  const extra = story ? `${story}\n\n` : confident ? t`【可能相關的參考資料（不相關就忽略）】\n${context(hits)}\n\n` : ''
  const userMsg: ChatMsg = { role: 'user', content: t`${game.text ? game.text + '\n' : ''}${extra}問題：${q}` }
  const prefix = prefixMessages()
  const reserve = prefix.reduce((n, m) => n + m.content.length, 0) + userMsg.content.length
  const messages: ChatMsg[] = [...prefix, ...fitHistory(reserve), userMsg]
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
