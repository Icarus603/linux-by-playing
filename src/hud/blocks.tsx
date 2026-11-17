import React from 'react'
import { Ansi, Box, Text } from './ink'
import { C } from './theme'
import type { Entry } from './store'
import { t } from '../i18n'

const MAX_VISIBLE_LINES = 300
const shortCwd = (cwd: string): string => (cwd === '/home/player' ? '~' : cwd.replace(/^\/home\/player\//, '~/'))

export const CmdBlock = React.memo(function CmdBlock({
  cwd,
  cmd,
  lines,
  dropped,
  stdin,
  done,
  rc,
}: {
  cwd: string
  cmd: string
  lines: string[]
  dropped: number
  stdin: string[]
  done: boolean
  rc: number | null
}): React.ReactNode {
  const hidden = Math.max(0, lines.length - MAX_VISIBLE_LINES)
  const shown = hidden ? lines.slice(-MAX_VISIBLE_LINES) : lines
  return (
    <Box marginTop={1} flexDirection="column">
      <Text>
        <Text color={C.sky}>{shortCwd(cwd)}</Text>
        <Text color={C.dim}>{' $ '}</Text>
        <Text color={C.text} bold>
          {cmd}
        </Text>
      </Text>
      {(hidden > 0 || dropped > 0) && <Text color={C.dim}>{t`… 前面省略 ${hidden + dropped} 行`}</Text>}
      {shown.map((l, i) => (
        <Text key={i}>{l === '' ? ' ' : <Ansi>{l}</Ansi>}</Text>
      ))}
      {stdin.map((s, i) => (
        <Text key={`in${i}`} color={C.accent}>
          {'› '}
          {s}
        </Text>
      ))}
      {!done && lines.length === 0 && <Text color={C.dim}>…</Text>}
      {done && rc !== null && rc !== 0 && <Text color={C.err}>{t`✗ 結束碼 ${rc}`}</Text>}
    </Box>
  )
})

export function NoteBlock({ e }: { e: Extract<Entry, { kind: 'note' }> }): React.ReactNode {
  const color = e.tone === 'warn' ? C.warn : e.tone === 'err' ? C.err : e.tone === 'ok' ? C.ok : C.dim
  return (
    <Box marginTop={1}>
      <Text color={color}>{e.text}</Text>
    </Box>
  )
}

export function ListBlock({ e }: { e: Extract<Entry, { kind: 'list' }> }): React.ReactNode {
  return (
    <Box marginTop={1} flexDirection="column">
      {e.text.split('\n').map((l, i) => (
        <Text key={i} color={C.text}>
          {l === '' ? ' ' : l}
        </Text>
      ))}
    </Box>
  )
}

/** 自然語言對話：行首一個「●」，和指令前的「$」區分開。使用者是冰藍色，Pip 是天藍色。 */
export function SayBlock({ e }: { e: Extract<Entry, { kind: 'say' }> }): React.ReactNode {
  const dot = e.who === 'you' ? C.ice : e.tone === 'ok' ? C.ok : C.sky
  return (
    <Box marginTop={1}>
      <Box width={2} flexShrink={0}>
        <Text color={dot}>{'● '}</Text>
      </Box>
      <Box flexGrow={1} flexShrink={1} flexDirection="column">
        {(e.text || '…').split('\n').map((l, i) => (
          <Text key={i} color={e.who === 'you' ? C.ice : C.text}>
            {l === '' ? ' ' : l}
          </Text>
        ))}
      </Box>
    </Box>
  )
}
