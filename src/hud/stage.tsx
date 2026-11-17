import React from 'react'
import { Box, Text, useAnimationFrame } from './ink'
import { PIP_HEIGHT, Pip } from './Pip'
import type { Controller } from './controller'
import { C } from './theme'
import { loadCatalog } from '../engine/levels'

/**
 * 輸入框左上方的 Pip 吉祥物。說的話全部寫進下方紀錄區（前面一個「●」），這裡只負責表情：
 * 說話或串流時嘴巴會動、閒置時偶爾眨眼、/dance 時搖擺。
 */
export function PipDock({ ctl }: { ctl: Controller }): React.ReactNode {
  const [, time] = useAnimationFrame(ctl.scrolling ? null : 130)
  const m = ctl.mood
  const typing = m.streaming || Date.now() - m.at < 1200
  const idleBlink = !typing && Math.floor(time / 130) % 30 === 0
  const dancing = m.danceMs > 0 && Date.now() - m.at < m.danceMs
  const beat = Math.floor(time / 150)
  const pose = dancing
    ? beat % 2 === 0
      ? 'dance1'
      : 'dance2'
    : typing
      ? m.pose
      : idleBlink
        ? 'blink'
        : m.pose === 'wave'
          ? 'idle'
          : m.pose
  const sway = dancing ? [0, 1, 2, 1][beat % 4]! : 0
  return (
    <Box paddingX={1} marginTop={1} flexShrink={0} height={PIP_HEIGHT}>
      <Box marginLeft={sway}>
        <Pip pose={pose} talking={typing || dancing} />
      </Box>
    </Box>
  )
}

/** 目前這一關的任務卡（金框）。永遠只顯示現在這一關。 */
export function TaskCard({ ctl, compact }: { ctl: Controller; compact: boolean }): React.ReactNode {
  const lvl = ctl.displayLevel ? loadCatalog().byId.get(ctl.displayLevel) : undefined
  if (!lvl) return null
  const boss = lvl.kind === 'boss'
  if (compact) {
    return (
      <Box flexShrink={0}>
        <Text wrap="truncate-end">
          <Text color={C.accent}>◆ {lvl.id} </Text>
          <Text color={C.text}>{lvl.goal}</Text>
        </Text>
      </Box>
    )
  }
  return (
    <Box flexShrink={0} flexDirection="column" borderStyle="round" borderColor={C.accent} paddingX={1}>
      <Text bold>
        <Text color={C.accent}>◆ 任務 {lvl.id} · {lvl.title}</Text>
        {boss && <Text color={C.err}>{'  BOSS'}</Text>}
      </Text>
      <Text color={C.text}>{lvl.goal}</Text>
      {lvl.golf !== undefined && !compact && (
        <Text color={C.dim}>
          高爾夫：最後一個指令 ≤ <Text color={C.accent}>{lvl.golf}</Text> 個字元，額外 +10 XP
        </Text>
      )}
      {lvl.teaches.length > 0 && !ctl.game.hard && (
        <Box flexWrap="wrap" columnGap={1}>
          <Text color={C.dim}>指令</Text>
          {lvl.teaches.map((t) => (
            <Text key={t} color="#08263A" backgroundColor={C.sky}>
              {` ${t} `}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
