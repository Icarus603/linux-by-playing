import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '../engine/levels'
import { tokenize } from './tokenize'

// 離線知識庫 + BM25 檢索。來源：關卡內容（不含解答與判定腳本，避免洩題）、
// 建置時抽出的 man page 摘要、手寫 FAQ。

export type Chunk = {
  id: string
  kind: 'faq' | 'level' | 'cmd' | 'tldr' | 'concept' | 'kdoc'
  title: string
  /** 給人看的短答案或說明 */
  text: string
  /** 較詳細的事實（指令、旗標、陷阱），提供給模型參考；離線模式不直接顯示 */
  detail?: string
  /** 只用於檢索的額外關鍵字 */
  keys: string
  cmd?: string
  levelId?: string
}

/** score：BM25 分數；cov：問題中「有資訊量的詞」被這份資料命中的比例（0–1），用來判斷是不是離題。 */
export type Hit = Chunk & { score: number; cov: number }

const W_LATIN = Number(process.env.LBP_W_LATIN ?? 2.2)
const W_UNI = Number(process.env.LBP_W_UNI ?? 0.5)
const KNOW_DIRS = [process.env.LBP_KNOWLEDGE, '/game/knowledge', join(import.meta.dir, '../../knowledge')].filter(Boolean) as string[]

/** 讀取所有知識目錄下的 *.yaml（手寫的專業知識與 FAQ），同名檔案只取第一個。 */
function loadCurated(): Chunk[] {
  const seen = new Set<string>()
  const out: Chunk[] = []
  for (const d of KNOW_DIRS) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d).sort()) {
      if (!f.endsWith('.yaml') || seen.has(f)) continue
      seen.add(f)
      const items = Bun.YAML.parse(readFileSync(join(d, f), 'utf8')) as { q: string; a: string; d?: string; keys?: string }[]
      items.forEach((it, i) =>
        out.push({
          id: `${f.replace(/\.yaml$/, '')}-${i}`,
          kind: 'faq',
          title: it.q,
          text: String(it.a).trim(),
          detail: it.d ? String(it.d).trim() : undefined,
          keys: `${it.q} ${it.keys ?? ''} ${it.a} ${it.d ?? ''}`,
        }),
      )
    }
  }
  return out
}

function firstExisting(name: string): string | null {
  for (const d of KNOW_DIRS) {
    const p = join(d, name)
    if (existsSync(p)) return p
  }
  return null
}

/** 建置時匯入的參考資料（man page、tldr 範例、核心文件），由 `lbp build-knowledge` 產生。 */
function loadRef(): Chunk[] {
  const p = firstExisting('ref.json')
  return p ? (JSON.parse(readFileSync(p, 'utf8')) as Chunk[]) : []
}

function loadLevels(): Chunk[] {
  return loadCatalog().levels.map((l) => ({
    id: `lvl-${l.id}`,
    kind: 'level' as const,
    title: l.title,
    text: `${l.goal}${l.hints.length ? ' 範例：' + l.hints.slice(0, 2).join('；') : ''}`,
    keys: `${l.title} ${l.goal} ${l.story} ${l.hints.join(' ')} ${l.teaches.join(' ')} ${l.teaches.join(' ')}`,
    levelId: l.id,
    cmd: l.teaches[0],
  }))
}

/** 中英術語對照：使用者用中文問，參考資料多半是英文，把中文詞補上對應的英文關鍵字。 */
const GLOSSARY: [RegExp, string][] = [
  [/記憶體|内存|內存/, 'memory ram'], [/硬碟|磁碟|磁盘|硬盘/, 'disk'], [/分割區|分區|分区/, 'partition'], [/掛載|挂载/, 'mount'],
  [/權限|权限/, 'permission chmod'], [/擁有者|所有者/, 'owner chown'], [/程序|進程|进程/, 'process'], [/殺掉|終止|杀掉|结束/, 'kill'],
  [/網路|网络|網絡/, 'network'], [/防火牆|防火墙/, 'firewall iptables nftables'], [/封包|数据包|数据包/, 'packet'], [/埠|端口/, 'port'],
  [/排程|定時|定时|计划任务/, 'cron timer schedule'], [/日誌|日志/, 'log journal'], [/壓縮|压缩/, 'compress gzip tar'], [/解壓|解压/, 'extract decompress'],
  [/搜尋|搜索|查找|尋找/, 'search find grep'], [/取代|替换|替換/, 'replace sed'], [/排序/, 'sort'], [/重複|重复/, 'uniq duplicate'],
  [/使用者|用户|用戶/, 'user'], [/群組|用户组|群组/, 'group'], [/密碼|密码/, 'password'], [/金鑰|密钥/, 'key ssh'],
  [/服務|服务/, 'service systemd'], [/開機|开机|啟動|启动/, 'boot startup'], [/核心|内核|內核/, 'kernel'], [/模組|模块/, 'module'],
  [/容器/, 'container docker namespace cgroup'], [/虛擬機|虚拟机/, 'virtual machine'], [/套件|软件包|包管理/, 'package apt dpkg'],
  [/檔案|文件/, 'file'], [/目錄|目录|資料夾/, 'directory folder'], [/連結|链接|軟連結|符號連結/, 'link symlink'], [/環境變數|环境变量/, 'environment variable env export'],
  [/撤銷|撤销|復原|还原|回退|回滾|回滚/, 'undo reset revert restore'], [/提交/, 'commit'], [/分支/, 'branch'], [/合併|合并/, 'merge'], [/轉檔|转档|转换|轉換/, 'convert transcode'], [/影片|视频|視頻/, 'video ffmpeg'], [/圖片|图片|圖像/, 'image'], [/映像檔|镜像/, 'image'],
  [/網路卡|网卡|網卡|网络卡/, 'nic ethernet ethtool link'], [/分割|拆分|切割/, 'split'], [/合併檔案|合并文件|串接/, 'cat merge'],
  [/寫磁碟|写磁盘|讀寫|读写|磁碟.{0,3}(忙|慢|高)|I\/?O/i, 'io iotop iostat pidstat disk'], [/免密碼|免密码|無密碼|无密码|不用密碼/, 'ssh-copy-id authorized_keys key passwordless'],
  [/開檔|开档|開啟的檔案|能開的檔案|檔案數量|描述符/, 'ulimit nofile open files descriptor'], [/擋住|被擋|攔截|拦截|拒絕存取/, 'denied blocked avc'],
  [/開機.{0,3}(多久|時間|速度|慢)|启动.{0,3}(多久|时间|慢)/, 'boot systemd-analyze blame'],
  [/效能|性能/, 'performance'], [/延遲|延迟/, 'latency'], [/頻寬|带宽|帶寬/, 'bandwidth'], [/負載|负载/, 'load'], [/交換|交换/, 'swap'],
  [/快取|缓存/, 'cache'], [/逾時|超时/, 'timeout'], [/備份|备份/, 'backup rsync'], [/同步/, 'sync rsync'], [/下載|下载/, 'download curl wget'],
  [/憑證|证书|證書/, 'certificate tls openssl'], [/加密/, 'encrypt'], [/追蹤|追踪/, 'trace strace'], [/除錯|调试|調試/, 'debug gdb strace'],
]

function expand(question: string, toks: string[]): string[] {
  const extra: string[] = []
  for (const [re, en] of GLOSSARY) if (re.test(question)) extra.push(...en.split(' '))
  return [...toks, ...extra]
}

type Index = { chunks: Chunk[]; tf: Map<string, number>[]; len: number[]; df: Map<string, number>; avg: number; titles: Set<string>[] }

let idx: Index | null = null

export function buildIndex(): Index {
  if (idx) return idx
  const chunks = [...loadCurated(), ...loadRef(), ...loadLevels()]
  const tf: Map<string, number>[] = []
  const len: number[] = []
  const df = new Map<string, number>()
  const titles: Set<string>[] = []
  for (const c of chunks) {
    titles.push(new Set(tokenize(c.title)))
    const toks = tokenize(`${c.title} ${c.title} ${c.keys}`)
    const m = new Map<string, number>()
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1)
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1)
    tf.push(m)
    len.push(toks.length)
  }
  idx = { chunks, tf, len, df, titles, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length) }
  return idx
}

/** BM25 檢索；question 裡明確出現的指令名稱會額外加分（讓「grep 怎麼用」一定先找到 grep）。 */
/** 啟動後在背景先載入知識庫，第一次提問就不會因為解析 20MB 的 JSON 而卡住。 */
export function warmKb(): void {
  try {
    search('warm up', 1)
  } catch {}
}

export function search(question: string, k = 4): Hit[] {
  const ix = buildIndex()
  const q = [...new Set(expand(question, tokenize(question)))]
  const words = new Set(q)
  const N = ix.chunks.length
  const k1 = 1.4
  const b = 0.75
  const hits: Hit[] = []
  const idfOf = (t: string): number => Math.log(1 + (N - (ix.df.get(t) ?? 0) + 0.5) / ((ix.df.get(t) ?? 0) + 0.5))
  // 純數字與數值單位（500mb、80、3g）不是檢索重點，不計入覆蓋率
  const isQty = (t: string): boolean => /^\d+[a-z%]*$/.test(t)
  // 詞的重要性：英文技術詞（selinux、swappiness、ulimit）資訊量最高；中文單字最容易碰巧命中，權重最低
  const wOf = (t: string): number => (/^[a-z][a-z0-9_.+-]+$/.test(t) ? W_LATIN : [...t].length === 1 ? W_UNI : 1)
  const totalIdf = q.filter((t) => !isQty(t)).reduce((a, t) => a + idfOf(t) * wOf(t), 0) || 1
  for (let i = 0; i < N; i++) {
    let s = 0
    let matched = 0
    for (const t of q) {
      const f = ix.tf[i]!.get(t)
      if (!f) continue
      const idf = idfOf(t) * wOf(t)
      if (!isQty(t)) matched += idf
      // 條目標題本身就是問句，標題命中比內文命中更能代表主題
      if (ix.titles[i]!.has(t)) s += idf * 1.1
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * ix.len[i]!) / ix.avg))
    }
    const c = ix.chunks[i]!
    if (c.cmd && words.has(c.cmd.toLowerCase())) s += 6
    // 問題裡的英文詞（tar、selinux、tcpdump…）若出現在條目標題，通常就是主題，額外加分
    if (c.kind === 'faq') {
      const title = c.title.toLowerCase()
      for (const t of q) if (/^[a-z][a-z0-9_.+-]{1,}$/.test(t) && title.includes(t)) s += t.length >= 5 ? 30 : 12
    }
    if (s > 0) hits.push({ ...c, score: s, cov: matched / totalIdf })
  }
  // 重新排序：分數乘上覆蓋率，讓「問題裡的關鍵詞都有命中」的條目排在只有單一詞高分的條目前面
  // 關卡內容是「教學」而不是「參考資料」，同分時專業條目優先
  const prior = (h: Hit): number => (h.kind === 'level' ? 0.75 : h.kind === 'faq' ? 1 : h.kind === 'tldr' ? 0.9 : h.kind === 'kdoc' || h.kind === 'concept' ? 0.85 : 0.8)
  hits.sort((a, b) => prior(b) * b.score * (0.4 + b.cov) - prior(a) * a.score * (0.4 + a.cov))
  return hits.slice(0, k)
}

/** 兩次檢索（原問題、原問題＋模型補的關鍵字）用 RRF 融合：兩邊都認為相關的排前面，補關鍵字帶偏時原問題還能把關。 */
export function searchFused(question: string, extra: string, k = 5): Hit[] {
  if (!extra) return search(question, k)
  const a = search(question, 10)
  const b = search(`${question} ${extra}`, 10)
  const score = new Map<string, { h: Hit; s: number }>()
  // 補關鍵字的那一路通常更貼近語意，權重 2；原問題當保險
  for (const [list, w] of [[a, 1], [b, 2]] as const)
    list.forEach((h, i) => {
      const cur = score.get(h.id)
      const add = w / (60 + i)
      if (cur) cur.s += add
      else score.set(h.id, { h, s: add })
    })
  return [...score.values()].sort((x, y) => y.s - x.s).slice(0, k).map((x) => x.h)
}
