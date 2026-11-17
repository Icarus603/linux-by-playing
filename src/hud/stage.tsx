import React, { useEffect, useRef, useState } from 'react'
import { Box, Text, useAnimationFrame, wrapAnsi } from './ink'
import { PIP_HEIGHT, PIP_WIDTH, Pip } from './Pip'
import type { Controller } from './controller'
import { C } from './theme'
import { loadCatalog } from '../engine/levels'
import { t } from '../i18n'

/**
 * 固定位置的 Pip 與對話框。訊息以「打字機」方式逐字出現，換訊息就在原地重新打字，
 * 不會往下堆疊。對話框高度依完整文字預先算好，打字過程版面不會跳動。
 */
export function SpeechStage({ ctl, columns }: { ctl: Controller; columns: number; rows?: number }): React.ReactNode {
  const sp = ctl.speech
  const [n, setN] = useState(0)
  const [, time] = useAnimationFrame(ctl.scrolling ? null : 130)
  const textWidth = Math.max(10, columns - 2 - (PIP_WIDTH + 2) - 4)
  const text = sp ? sp.text : ''
  const total = [...text.replace(/\n/g, '')].length // 換行字元不算在打字進度內（排版時它們變成換行）

  // 串流回答會在同一個 id 下不斷更新文字與長度：計時器要讀「最新」的 total / step，
  // 不能只捕捉第一次的值，否則打字會停在最初那段文字的長度。
  const live = useRef({ total, step: sp?.step ?? 1 })
  live.current = { total, step: sp?.step ?? 1 }
  useEffect(() => {
    if (!sp) return
    setN(0)
    const t = setInterval(() => setN((x) => Math.min(live.current.total, x + live.current.step)), sp.tickMs)
    return () => clearInterval(t)
  }, [sp?.id])

  if (!sp) return <Box height={PIP_HEIGHT} />

  const typing = n < total || !!sp.streaming
  // 先用「最終的完整文字」排好版，再依打字進度逐字揭露：版面從第一個字起就和最後一樣，不會中途換行或跳動。
  // 寬度預留 1 欄給游標，結尾的「▼ Enter」提示也預先算進去（有下一則時才有）。
  const hint = ctl.pendingSpeech > 0 ? '  ▼ Enter' : ''
  const wrapped = wrapAnsi(text + hint, Math.max(8, textWidth - 1), { hard: true, trim: false }).split('\n')
  const height = Math.max(PIP_HEIGHT, wrapped.length + 2)
  const done = !typing
  let left = done ? Infinity : n
  const rows = wrapped.map((ln) => {
    const cs = [...ln]
    const take = Math.max(0, Math.min(cs.length, left))
    left -= cs.length
    return cs.slice(0, take).join('')
  })
  const cursorRow = Math.max(0, rows.findIndex((r, i) => r.length < [...wrapped[i]!].length || i === rows.length - 1))
  const border = sp.tone === 'ok' ? C.ice : sp.tone === 'info' ? C.info : C.sky

  const idleBlink = !typing && Math.floor(time / 130) % 30 === 0
  const dancing = sp.danceMs > 0 && Date.now() - sp.startedAt < sp.danceMs
  const beat = Math.floor(time / 150)
  // 跳舞：翅膀交替上下、身體在 0~2 欄之間左右搖擺
  const answering = ctl.answering
  const pose = answering
    ? 'think'
    : dancing
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
          <Pip pose={pose} talking={typing || dancing || answering} />
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
        <Box flexDirection="column">
          {rows.map((r, i) => (
            <Text key={i} color={C.text} wrap="truncate-end">
              {done && i === rows.length - 1 && hint && r.endsWith(hint) ? r.slice(0, r.length - hint.length) : r}
              {done && i === rows.length - 1 && hint && r.endsWith(hint) && <Text color={C.dim}>{hint}</Text>}
              {typing && i === cursorRow && <Text color={C.ice}>▌</Text>}
            </Text>
          ))}
        </Box>
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
        <Text color={C.accent}>{t`◆ 任務 ${lvl.id} · ${lvl.title}`}</Text>
        {boss && <Text color={C.err}>{'  BOSS'}</Text>}
      </Text>
      <Text color={C.text}>{lvl.goal}</Text>
      {lvl.golf !== undefined && !compact && (
        <Text color={C.dim}>
          {t`高爾夫：最後一個指令 ≤ `}<Text color={C.accent}>{lvl.golf}</Text>{t` 個字元，額外 +10 XP`}
        </Text>
      )}
      {lvl.teaches.length > 0 && !ctl.game.hard && (
        <Box flexWrap="wrap" columnGap={1}>
          <Text color={C.dim}>{t('指令')}</Text>
          {lvl.teaches.map((t) => (
            <Text key={t} color={C.sky} backgroundColor={C.track}>
              {` ${t} `}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}
