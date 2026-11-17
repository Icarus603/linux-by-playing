import React, { useEffect, useState } from 'react'
import { Box, Text, useAnimationFrame, wrapAnsi } from './ink'
import { PIP_HEIGHT, PIP_WIDTH, Pip } from './Pip'
import type { Controller } from './controller'
import { C } from './theme'
import { loadCatalog } from '../engine/levels'

/**
 * 固定位置的 Pip 與對話框。訊息以「打字機」方式逐字出現，換訊息就在原地重新打字，
 * 不會往下堆疊。對話框高度依完整文字預先算好，打字過程版面不會跳動。
 */
export function SpeechStage({ ctl, columns }: { ctl: Controller; columns: number; rows?: number }): React.ReactNode {
  const sp = ctl.speech
  const [n, setN] = useState(0)
  const [, time] = useAnimationFrame(130)
  const textWidth = Math.max(10, columns - 2 - (PIP_WIDTH + 2) - 4)
  const text = sp ? sp.text : ''
  const total = [...text].length

  useEffect(() => {
    if (!sp) return
    setN(0)
    const t = setInterval(() => setN((x) => Math.min(total, x + sp.step)), sp.tickMs)
    return () => clearInterval(t)
  }, [sp?.id])

  if (!sp) return <Box height={PIP_HEIGHT} />

  const typing = n < total
  const lines = wrapAnsi(text, textWidth, { hard: true, trim: false }).split('\n').length
  const height = Math.max(PIP_HEIGHT, lines + 2)
  const shown = [...text].slice(0, n).join('')
  const border = sp.tone === 'ok' ? C.ice : sp.tone === 'info' ? C.info : C.sky

  const idleBlink = !typing && Math.floor(time / 130) % 30 === 0
  const dancing = sp.danceMs > 0 && Date.now() - sp.startedAt < sp.danceMs
  const beat = Math.floor(time / 150)
  // 跳舞：翅膀交替上下、身體在 0~2 欄之間左右搖擺
  const pose = dancing
    ? beat % 2 === 0
      ? 'dance1'
      : 'dance2'
    : typing
      ? sp.pose
      : idleBlink
        ? 'blink'
        : sp.pose === 'wave'
          ? 'idle'
          : sp.pose
  const sway = dancing ? [0, 1, 2, 1][beat % 4]! : 1

  return (
    <Box flexShrink={0}>
      <Box width={PIP_WIDTH + 2} flexShrink={0}>
        <Box marginLeft={sway}>
          <Pip pose={pose} talking={typing || dancing} />
        </Box>
      </Box>
      <Box
        flexGrow={1}
        flexShrink={1}
        height={height}
        borderStyle="round"
        borderColor={border}
        paddingX={1}
      >
        <Text color={C.text}>
          {shown}
          {typing && <Text color={C.ice}>▌</Text>}
          {!typing && ctl.pendingSpeech > 0 && <Text color={C.dim}>{'  ▼ Enter'}</Text>}
        </Text>
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
