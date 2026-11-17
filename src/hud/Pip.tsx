import React from 'react'
import { Box, Text } from './ink'

// Pip：Kernel-7 號空間站的領航企鵝雛鳥。原創設計。
// 寬 9 欄、高 5 列，只用 ASCII 當眼睛（避免東亞寬度歧義字元造成錯位）。
// 做法：每列拆成「側邊 / 臉 / 翅膀」片段，姿勢只替換變動的片段。

export type PipPose = 'idle' | 'blink' | 'happy' | 'think' | 'wave' | 'sleep' | 'worry' | 'dance1' | 'dance2'

const NAVY = '#4BA3F0' // 取「偏綠版」與「偏紫版」的中間值
const FACE = '#F4F6FB'
const BEAK = '#FFB020'

type Look = { eyes: string; beak: string; armsUp: boolean }

const LOOKS: Record<PipPose, Look> = {
  idle: { eyes: 'o o', beak: 'v', armsUp: false },
  blink: { eyes: '- -', beak: 'v', armsUp: false },
  happy: { eyes: '^ ^', beak: 'v', armsUp: true },
  think: { eyes: 'o .', beak: 'v', armsUp: false },
  wave: { eyes: 'o o', beak: 'v', armsUp: true },
  sleep: { eyes: '- -', beak: 'o', armsUp: false },
  worry: { eyes: 'o o', beak: '~', armsUp: false },
  dance1: { eyes: '^ ^', beak: 'o', armsUp: true },
  dance2: { eyes: '^ ^', beak: 'v', armsUp: false },
}

export const PIP_WIDTH = 9
export const PIP_HEIGHT = 5

export function Pip({ pose = 'idle', talking = false }: { pose?: PipPose; talking?: boolean }): React.ReactNode {
  const look = LOOKS[pose]
  const { eyes, armsUp } = look
  const beak = talking ? (Math.floor(Date.now() / 140) % 2 === 0 ? 'o' : 'v') : look.beak
  const [l, , r] = [eyes[0]!, eyes[1]!, eyes[2]!]
  return (
    <Box flexDirection="column" width={PIP_WIDTH} height={PIP_HEIGHT} flexShrink={0}>
      <Text color={NAVY}>{'  ▄███▄  '}</Text>
      <Text>
        <Text color={NAVY}>{armsUp ? '▗▐█' : ' ▐█'}</Text>
        <Text color={FACE} backgroundColor={NAVY}>{`${l} ${r}`}</Text>
        <Text color={NAVY}>{armsUp ? '█▌▖' : '█▌ '}</Text>
      </Text>
      <Text>
        <Text color={NAVY}>{armsUp ? ' ▐█' : '▗▐█'}</Text>
        <Text color={BEAK} backgroundColor={NAVY}>{` ${beak} `}</Text>
        <Text color={NAVY}>{armsUp ? '█▌ ' : '█▌▖'}</Text>
      </Text>
      <Text>
        <Text color={NAVY}>{' ▝▜'}</Text>
        <Text color={FACE}>{'███'}</Text>
        <Text color={NAVY}>{'▛▘ '}</Text>
      </Text>
      <Text color={BEAK}>{'  ▀▘ ▝▀  '}</Text>
    </Box>
  )
}

/** 一段動畫：每格 (姿勢, 垂直位移)，每格持續 frameMs。 */
export type Frame = { pose: PipPose; lift: 0 | 1 }
export const JUMP: Frame[] = [
  { pose: 'idle', lift: 0 },
  { pose: 'happy', lift: 1 },
  { pose: 'happy', lift: 1 },
  { pose: 'idle', lift: 0 },
  { pose: 'happy', lift: 1 },
  { pose: 'happy', lift: 1 },
  { pose: 'happy', lift: 0 },
]
