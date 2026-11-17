import React from 'react'
import { Text } from './ink'
import { C, GRADIENT, gradientAt } from './theme'

/** 逐字著色的漸層文字。 */
export function Gradient({
  children,
  stops = GRADIENT,
  bold,
}: {
  children: string
  stops?: readonly string[]
  bold?: boolean
}): React.ReactNode {
  const chars = [...children]
  const n = Math.max(1, chars.length - 1)
  const inner = chars.map((c, i) => (
    <Text key={i} color={gradientAt(stops, i / n)}>
      {c}
    </Text>
  ))
  return bold ? <Text bold>{inner}</Text> : <Text>{inner}</Text>
}

/** 漸層細線（用於分隔與進度條填色）。 */
export function GradientBar({ width, char = '━' }: { width: number; char?: string }): React.ReactNode {
  return <Gradient>{char.repeat(Math.max(0, width))}</Gradient>
}

/** 輸入區上下的橫線：閒置時是純象牙白（不做漸層），執行中轉金色，忙碌時變暗。 */
export const Rule = React.memo(function Rule({
  width,
  mode,
}: {
  width: number
  mode: 'idle' | 'busy' | 'run' | 'chat'
}): React.ReactNode {
  const line = '─'.repeat(Math.max(0, width))
  if (mode === 'run') return <Text color={C.accent}>{line}</Text>
  if (mode === 'chat') return <Text color={C.sky}>{line}</Text>
  if (mode === 'busy') return <Text color={C.track}>{line}</Text>
  return <Text color={C.rule}>{line}</Text>
})
