import React, { useEffect, useRef, useSyncExternalStore } from 'react'
import { AlternateScreen, Box, ScrollBox, Text, useSelection, useTerminalSize, type ScrollBoxHandle } from './ink'
import { CmdBlock, ListBlock, NoteBlock, SayBlock } from './blocks'
import type { Controller } from './controller'
import { Gradient, GradientBar } from './Gradient'
import { Prompt } from './Prompt'
import { SpeechStage, TaskCard } from './stage'
import { C } from './theme'
import { loadCatalog, stageOf } from '../engine/levels'
import { rankOf } from '../engine/state'
import type { Entry } from './store'
import { t, tr } from '../i18n'

function Header({ ctl, width }: { ctl: Controller; width: number }): React.ReactNode {
  const cat = loadCatalog()
  const g = ctl.game
  const lvl = g.current ? cat.byId.get(g.current) : undefined
  const st = lvl ? stageOf(lvl) : cat.stages.at(-1)?.id ?? 1
  const stage = cat.stages.find((x) => x.id === st)
  const r = rankOf(g.xp)
  const ratio = r.next ? (g.xp - r.floor) / (r.next - r.floor) : 1
  const barW = Math.max(6, Math.min(16, Math.floor(width / 7)))
  const filled = Math.round(Math.min(1, ratio) * barW)
  const done = Object.keys(g.done).length
  return (
    <Box paddingX={1} justifyContent="space-between" flexShrink={0}>
      <Text wrap="truncate-end">
        <Gradient bold>KERNEL-7</Gradient>
        <Text color={C.dim}>
          {'  '}{t`階段 ${st}/${cat.stages.length} ${stage?.title ?? ''} · 已完成 ${done}/${cat.levels.length}`}
        </Text>
        {g.streak >= 2 && <Text color={C.accent}>{t`  連勝 ${g.streak}`}</Text>}
        {g.hard && <Text color={C.err}>{'  HARD'}</Text>}
      </Text>
      <Text>
        <Text color={C.accent}>{tr(r.name)}</Text>
        <Text color={C.dim}> {g.xp} XP </Text>
        <GradientBar width={filled} />
        <Text color={C.track}>{'━'.repeat(barW - filled)}</Text>
      </Text>
    </Box>
  )
}

function View({ e }: { e: Entry }): React.ReactNode {
  switch (e.kind) {
    case 'cmd':
      return <CmdBlock cwd={e.cwd} cmd={e.cmd} lines={e.lines} dropped={e.dropped} stdin={e.stdin} done={e.done} rc={e.rc} />
    case 'note':
      return <NoteBlock e={e} />
    case 'list':
      return <ListBlock e={e} />
    case 'say':
      return <SayBlock e={e} />
  }
}

/** 選取即複製：滑鼠拖曳放開後，自動把選取的文字寫進系統剪貼簿（選取反白會保留）。 */
function CopyOnSelect({ ctl }: { ctl: Controller }): React.ReactNode {
  const sel = useSelection()
  const last = useRef('')
  useEffect(
    () =>
      sel.subscribe(() => {
        const st = sel.getState()
        if (!st || st.isDragging || !sel.hasSelection()) return
        const text = sel.copySelectionNoClear()
        if (text && text !== last.current) {
          last.current = text
          ctl.flash(t`已複製 ${[...text].length} 字`)
        }
      }),
    [sel, ctl],
  )
  return null
}

export function App({ ctl }: { ctl: Controller }): React.ReactNode {
  useSyncExternalStore(ctl.store.subscribe, ctl.store.getVersion)
  useSyncExternalStore(ctl.subscribe, ctl.getSnapshot)
  const { columns, rows } = useTerminalSize()
  const scroll = useRef<ScrollBoxHandle>(null)

  useEffect(() => {
    ctl.setSize(columns, rows)
  }, [ctl, columns, rows])

  return (
    <AlternateScreen>
      <CopyOnSelect ctl={ctl} />
      <Box flexDirection="column" flexGrow={1}>
        <Header ctl={ctl} width={columns} />
        <Box paddingX={1} marginTop={1} flexDirection="column" flexShrink={0}>
          <SpeechStage ctl={ctl} columns={columns} rows={rows} />
          <TaskCard ctl={ctl} compact={rows < 28} />
        </Box>
        <ScrollBox ref={scroll} flexGrow={1} flexShrink={1} minHeight={1} flexDirection="column" stickyScroll>
          <Box flexDirection="column" width={Math.max(20, columns - 2)} marginLeft={1}>
            {ctl.store.entries.map((e) => (
              <View key={e.id} e={e} />
            ))}
          </Box>
        </ScrollBox>
        <Prompt
          ctl={ctl}
          onScroll={(dy) => {
            ctl.noteScroll()
            scroll.current?.scrollBy(dy)
          }}
          onBottom={() => {
            if (scroll.current && !scroll.current.isSticky()) scroll.current.scrollToBottom()
          }}
        />
        <Box paddingX={1} flexShrink={0}>
          {ctl.flashText ? (
            <Text color={C.accent}>✓ {ctl.flashText}</Text>
          ) : (
            <Text color={C.dim} wrap="truncate-end">
              {t('↑↓ 歷史 · Tab 補全 · ! 和 Pip 聊天 · /levels 選關 · /help 指令 · /quit 離開')}
            </Text>
          )}
        </Box>
      </Box>
    </AlternateScreen>
  )
}
