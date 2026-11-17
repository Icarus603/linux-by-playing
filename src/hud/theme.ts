import { T } from '../i18n'
// 色調：寶藍 → 天藍 → 淡冰藍的漸層。數值取「偏綠版」與「偏紫版」的中間值。金色只用在任務卡與重點。
export const C = {
  royal: '#2878E8', // 寶藍
  sky: '#47B8E8', // 天藍（微帶青）
  ice: '#B8E4F0', // 淡冰藍
  brand: '#47B8E8',
  accent: '#FFC845', // 黃金色（原本的 #FBBF24 是亮琥珀黃，不是金色）
  ok: '#98DAEA',
  warn: '#FFC845',
  err: '#FF7A90',
  dim: '#7F9FB9',
  text: '#E7F6FA',
  ivory: '#F6F2E2', // 象牙白：輸入框文字
  rule: '#8F8B7F', // 輸入框上下橫線：象牙白調暗，降低存在感
  beige: '#F6F2E2', // 象牙白（popup 與輸入框統一）
  beigeDim: '#B9B6A8', // 米白的次要文字
  beigeFaint: '#7F7E73',
  ink: '#2B2A24', // 米白底上的深色字
  rose: '#8ED8F7', // 寶石藍（稍微偏青）：popup 主色（變數名沿用 rose）
  roseDim: '#B6E6FA', // 玫瑰金的次要文字
  roseFaint: '#7FB1CC',
  roseInk: '#06202E', // 玫瑰金底上的深色字
  info: '#78C8F0',
  track: '#254459',
  chatLine: '#2F6F94', // 聊天模式的橫線：比天藍暗
  chatInk: '#9CCBDD', // 聊天模式輸入文字
  chatHint: '#5F8EA8', // 聊天模式的提示文字
} as const

/** 漸層停駐點（由左至右） */
export const GRADIENT = [C.royal, C.sky, C.ice] as const

export const PRAISE = [
  T('漂亮！這招你已經會用了。'),
  T('乾淨俐落，連我都學到了。'),
  T('過關！引擎室的燈亮了。'),
  T('就是這樣！下一個挑戰在等你。'),
  T('不錯喔，指令感越來越好了。'),
]

const hex = (s: string): [number, number, number] => [
  parseInt(s.slice(1, 3), 16),
  parseInt(s.slice(3, 5), 16),
  parseInt(s.slice(5, 7), 16),
]

/** 在多個色彩停駐點之間做線性插值，t ∈ [0,1]。 */
export function gradientAt(stops: readonly string[], t: number): `#${string}` {
  if (stops.length === 1) return stops[0]! as `#${string}`
  const x = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1)
  const i = Math.floor(x)
  const f = x - i
  const a = hex(stops[i]!)
  const b = hex(stops[i + 1]!)
  const c = a.map((v, k) => Math.round(v + (b[k]! - v) * f))
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}
