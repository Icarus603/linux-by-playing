// 判斷輸入框裡的一行，是要交給 bash 的指令，還是要問 Pip 的自然語言問題。
// 原則：寧可當成指令（保持「這是真正的終端機」），只有很確定是問句時才交給 Pip。
const CJK = /[㐀-鿿豈-﫿]/
const QWORDS = /^(what|how|why|when|where|who|which|can|could|does|do|is|are|should|explain|tell|please|help)\b/i
const ZH_QUESTION_END = /(怎麼|如何|什麼|為什麼|為何|嗎|呢|差別|差異|區別|意思|用法|作用|做什麼|有哪些|可以嗎|是啥|怎樣)[？?！!。.]*$/
const cache = new Map<string, boolean>()

/** 第一個字是不是 bash 認得的東西（外部指令、內建、別名、關鍵字、函式）。 */
function isKnownCommand(tok: string): boolean {
  if (cache.has(tok)) return cache.get(tok)!
  let ok = false
  if (/^[A-Za-z0-9_.+:@-]+$/.test(tok)) {
    const p = Bun.spawnSync(['bash', '-c', 'type -t -- "$1" >/dev/null 2>&1 || compgen -c -- "$1" | grep -qx -- "$1"', '_', tok], {
      stdin: 'ignore',
      timeout: 1500,
    })
    ok = p.exitCode === 0
  }
  cache.set(tok, ok)
  return ok
}

const GREETING = /^(hello|hi|hey|thanks|thank you|thx|bye|goodbye|good morning|good night)[!.?~ ]*$/i

export function isNaturalLanguage(raw: string): boolean {
  const line = raw.trim()
  if (!line || line.startsWith('/') || line.includes('\n')) return false
  // 單獨一句英文寒暄（hi、hello、thanks）：不是指令，交給 Pip
  if (GREETING.test(line) && !isKnownCommand(line.split(/\s+/)[0]!)) return true
  const toks = line.split(/\s+/)
  const first = toks[0]!
  // 明顯是 shell 語法：路徑、賦值、變數、子殼、重導向、管線、引號
  if (/^[./~$(!]/.test(first) || first.includes('=') || /[|;&<>`"']/.test(line)) {
    // 例外：以問號結尾的整句中文仍視為問題（引號只是被問到的內容，例如：「cat 'a b' 是什麼意思？」）
    return CJK.test(line) && /[？?]$/.test(line) && !isKnownCommand(first)
  }
  const known = isKnownCommand(first)
  // 結尾是明確的中文疑問詞，即使開頭恰好是個指令名稱（例如「ls 怎麼用」）也當成問題
  if (ZH_QUESTION_END.test(line) && CJK.test(line)) return true
  if (known) return false
  if (CJK.test(line)) return true
  if (/[?？]$/.test(line)) return toks.length >= 2
  if (QWORDS.test(line)) return toks.length >= 3
  return false
}
