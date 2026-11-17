import React, { useRef, useState } from 'react'
import { Box, Text, stringWidth, useInput, useTerminalSize } from './ink'
import { Rule } from './Gradient'
import type { Controller } from './controller'
import { complete } from './complete'
import { SLASH } from './slash'
import { C } from './theme'
import { loadCatalog, stageOf } from '../engine/levels'

type Props = { ctl: Controller; onScroll: (dy: number) => void; onBottom: () => void }

const shortCwd = (cwd: string): string => (cwd === '/home/player' ? '~' : cwd.replace(/^\/home\/player\//, '~/'))

/** 底部輸入框：行編輯、歷史、Tab 補全、中斷。游標以字元（code point）為單位，CJK 安全。 */
export function Prompt({ ctl, onScroll, onBottom }: Props): React.ReactNode {
  const [chars, setChars] = useState<string[]>([])
  const [cur, setCur] = useState(0)
  const [cands, setCands] = useState<string[]>([])
  const [sel, setSel] = useState(0)
  const [dismissed, setDismissed] = useState('')
  // 聊天模式：行首輸入 ! 進入，輸入框變藍色，送出的內容用自然語言交給 Pip；Esc 或在空白時按退格離開
  const [chat, setChat] = useState(false)
  const hist = useRef({ i: -1, draft: '' })
  const running = ctl.running !== null
  const { columns } = useTerminalSize()

  const set = (next: string[], c: number): void => {
    setChars(next)
    setCur(c)
    setCands([])
    setSel(0)
  }
  const setText = (s: string): void => {
    const a = [...s]
    set(a, a.length)
  }

  // ---- slash 選單：輸入 / 開頭、尚未輸入空白時彈出 ----
  const text = chars.join('')
  const menuOpen = !running && text.startsWith('/') && !text.includes(' ') && dismissed !== text
  const matches = menuOpen ? SLASH.filter((c) => ('/' + c.name).startsWith(text.toLowerCase())) : []
  const popup = matches.length > 0
  const selIdx = popup ? Math.min(sel, matches.length - 1) : 0

  /** 選取一個指令：run 為 true 且不需參數時直接執行，否則填入輸入框等你補參數。 */
  const pick = (i: number, run: boolean): void => {
    const c = matches[i]!
    const full = '/' + c.name
    if (run && !c.needsArg) {
      // 輸入框空白時按 Enter：跳到 Pip 的下一則訊息
      if (!text.trim() && !running && ctl.advanceSpeech()) return
      hist.current = { i: -1, draft: '' }
      setText('')
      ctl.submit(full)
      return
    }
    setText(full + ' ')
  }

  const picking = ctl.pickerOpen

  useInput((input, key) => {
    // ---- 關卡選單（最優先）----
    if (picking) {
      if (key.upArrow) return ctl.movePicker(-1)
      if (key.downArrow) return ctl.movePicker(1)
      if (key.wheelUp) return ctl.movePicker(-3)
      if (key.wheelDown) return ctl.movePicker(3)
      if (key.pageUp) return ctl.movePicker(-8)
      if (key.pageDown) return ctl.movePicker(8)
      if (key.home) return ctl.movePicker(-9999)
      if (key.end) return ctl.movePicker(9999)
      if (key.leftArrow) return ctl.movePickerStage(-1)
      if (key.rightArrow) return ctl.movePickerStage(1)
      if (key.return) return ctl.pickPicker()
      if (key.escape || (key.ctrl && input === 'c')) return ctl.closePicker()
      return
    }

    // ---- 捲動 ----
    if (key.wheelUp) return onScroll(-3)
    if (key.wheelDown) return onScroll(3)
    if (key.pageUp) return onScroll(-10)
    if (key.pageDown) return onScroll(10)

    // 任何非捲動的按鍵都讓紀錄區回到最底（跟一般終端機一樣）
    onBottom()

    // ---- slash 選單操作（優先於歷史與補全）----
    if (popup) {
      if (key.upArrow) return setSel((selIdx - 1 + matches.length) % matches.length)
      if (key.downArrow) return setSel((selIdx + 1) % matches.length)
      if (key.tab) return pick(selIdx, false)
      if (key.return) return pick(selIdx, true)
      if (key.escape) return setDismissed(text)
    }

    // ---- 控制鍵 ----
    if (key.ctrl) {
      switch (input) {
        case 'c':
          if (running) ctl.interrupt()
          else if (chars.length) setText('')
          else if (chat) setChat(false)
          else ctl.nudgeQuit()
          return
        case 'd':
          if (running || chars.length === 0) return ctl.eof()
          return set([...chars.slice(0, cur), ...chars.slice(cur + 1)], cur)
        case 'z':
          return ctl.suspend()
        case 'l':
          return ctl.store.clear()
        case 'a':
          return setCur(0)
        case 'e':
          return setCur(chars.length)
        case 'b':
          return setCur(Math.max(0, cur - 1))
        case 'f':
          return setCur(Math.min(chars.length, cur + 1))
        case 'u':
          return set(chars.slice(cur), 0)
        case 'k':
          return set(chars.slice(0, cur), cur)
        case 'w': {
          let i = cur
          while (i > 0 && chars[i - 1] === ' ') i--
          while (i > 0 && chars[i - 1] !== ' ') i--
          return set([...chars.slice(0, i), ...chars.slice(cur)], i)
        }
      }
      return
    }

    // ---- 換行：Shift+Enter（Ctrl-J 也可）----
    if (key.return && (key.shift || key.meta) && !running) {
      set([...chars.slice(0, cur), '\n', ...chars.slice(cur)], cur + 1)
      return
    }

    // ---- 送出 ----
    if (key.return) {
      const text = chars.join('')
      // 輸入框空白時按 Enter：跳到 Pip 的下一則訊息
      if (!text.trim() && !running && ctl.advanceSpeech()) return
      hist.current = { i: -1, draft: '' }
      setText('')
      if (chat && text.trim() && !text.trim().startsWith('/')) ctl.ask(text.trim())
      else ctl.submit(text)
      return
    }

    // ---- 編輯 ----
    if (key.backspace) {
      if (chat && chars.length === 0) return setChat(false)
      if (cur > 0) set([...chars.slice(0, cur - 1), ...chars.slice(cur)], cur - 1)
      return
    }
    if (key.delete) {
      if (cur < chars.length) set([...chars.slice(0, cur), ...chars.slice(cur + 1)], cur)
      else if (cur > 0) set([...chars.slice(0, cur - 1), ...chars.slice(cur)], cur - 1)
      return
    }
    if (key.leftArrow) return setCur(Math.max(0, cur - 1))
    if (key.rightArrow) return setCur(Math.min(chars.length, cur + 1))
    if (key.home) return setCur(0)
    if (key.end) return setCur(chars.length)

    // ---- 歷史 ----
    if (key.upArrow || key.downArrow) {
      if (running || chars.includes('\n')) return
      const h = ctl.history
      const st = hist.current
      if (key.upArrow) {
        if (h.length === 0 || st.i === 0) return
        if (st.i === -1) st.draft = chars.join('')
        st.i = st.i === -1 ? h.length - 1 : st.i - 1
        return setText(h[st.i]!)
      }
      if (st.i === -1) return
      st.i += 1
      if (st.i >= h.length) {
        st.i = -1
        return setText(st.draft)
      }
      return setText(h[st.i]!)
    }

    // ---- Tab 補全 ----
    if (key.tab) {
      if (running) return
      const r = complete(chars.join(''), cur, ctl.cwd)
      const a = [...r.value]
      setChars(a)
      setCur(r.cursor)
      setCands(r.cands)
      return
    }

    if (key.escape) {
      if (chat && chars.length === 0) return setChat(false)
      return setCands([])
    }

    // ---- 一般字元與貼上 ----
    if (input && !key.meta) {
      if (!running && chars.length === 0 && !chat && input.startsWith('!')) {
        setChat(true)
        input = input.slice(1)
        if (!input) return
      }
      let clean = input.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').replace(/\r\n|\r/g, '\n')
      if (!clean) return
      let cs = chars
      let c = cur
      if (running) {
        // 程式在等輸入：每一行直接送給它
        const parts = clean.split('\n')
        for (let i = 0; i < parts.length - 1; i++) ctl.submit(parts[i]!)
        clean = parts[parts.length - 1]!
      } else if (clean.length > 1) {
        // 貼上：保留內容（含換行）讓你確認，去掉結尾換行，不會自動執行
        clean = clean.replace(/\n+$/, '')
      }
      const ins = [...clean]
      cs = [...cs.slice(0, c), ...ins, ...cs.slice(c)]
      c += ins.length
      set(cs, c)
    }
  })

  const before = chars.slice(0, cur).join('')
  const at = chars[cur] ?? ' '
  const after = chars.slice(cur + 1).join('')
  const mode = running ? 'run' : chat ? 'chat' : ctl.busy ? 'busy' : 'idle'
  const ink = chat ? C.chatInk : C.ivory
  return (
    <Box flexDirection="column" flexShrink={0}>
      {picking && (() => {
        const cat = loadCatalog()
        const g = ctl.game
        const total = cat.levels.length
        const view = 10
        const sel = ctl.pickerSel
        const start = Math.max(0, Math.min(sel - 4, total - view))
        return (
          <Box paddingX={1} flexShrink={0} flexDirection="column">
            <Text color={C.roseDim}>關卡選單 · ↑↓ 移動 · ←→ 跳階段 · PgUp/PgDn 翻頁 · Enter 前往 · Esc 關閉</Text>
            {cat.levels.slice(start, start + view).map((l, k) => {
              const i = start + k
              const on = i === sel
              const mark = g.done[l.id] ? '✔' : l.id === g.current ? '▶' : '·'
              const st = cat.stages.find((x) => x.id === stageOf(l))
              const body = `${mark} ${l.id}  ${l.title}`
              return on ? (
                <Text key={l.id} color={C.roseInk} backgroundColor={C.rose} wrap="truncate-end">
                  {` ❯ ${body}   ${st?.title ?? ''} `}
                </Text>
              ) : (
                <Text key={l.id} wrap="truncate-end">
                  <Text color={C.dim}>{'   '}</Text>
                  <Text color={g.done[l.id] ? C.rose : l.id === g.current ? C.accent : C.roseFaint}>{body}</Text>
                  <Text color={C.roseFaint}>{`   ${st?.title ?? ''}`}</Text>
                </Text>
              )
            })}
            <Text color={C.roseDim}>{`   第 ${sel + 1}/${total} 關 · 已完成 ${Object.keys(g.done).length}`}</Text>
          </Box>
        )
      })()}
      {popup && (
        <Box paddingX={1} flexShrink={0} flexDirection="column">
          <Text color={C.roseDim}>指令選單 · ↑↓ 選擇 · Enter 確認 · Tab 填入 · Esc 關閉</Text>
          {matches.slice(Math.max(0, Math.min(selIdx - 3, matches.length - 8)), Math.max(0, Math.min(selIdx - 3, matches.length - 8)) + 8).map((c) => {
            const on = matches[selIdx]!.name === c.name
            const pad = ' '.repeat(Math.max(1, 20 - stringWidth(c.usage)))
            return on ? (
              <Text key={c.name} color={C.roseInk} backgroundColor={C.rose} wrap="truncate-end">
                {` ❯ ${c.usage}${pad}${c.desc} `}
              </Text>
            ) : (
              <Text key={c.name} wrap="truncate-end">
                <Text color={C.dim}>{'   '}</Text>
                <Text color={C.rose}>{c.usage}</Text>
                <Text color={C.roseDim}>
                  {pad}
                  {c.desc}
                </Text>
              </Text>
            )
          })}
          {matches.length > 8 && <Text color={C.roseDim}>{`   … 共 ${matches.length} 個（↑↓ 可捲動）`}</Text>}
        </Box>
      )}
      {cands.length > 0 && (
        <Box paddingX={1} flexShrink={0}>
          <Text color={C.beigeDim} wrap="truncate-end">
            {cands.slice(0, 24).join('  ')}
            {cands.length > 24 ? `  … 共 ${cands.length} 個` : ''}
          </Text>
        </Box>
      )}
      <Rule width={columns} mode={mode} />
      <Box paddingX={1} flexShrink={0}>
        <Text>
          {running ? (
            <Text color={C.accent}>{'› '}</Text>
          ) : chat ? (
            <Text>{''}</Text>
          ) : (
            <>
              <Text color={C.ivory}>player</Text>
              <Text color={C.beigeDim}>@</Text>
              <Text color={C.ivory}>kernel-7</Text>
              <Text color={C.beigeDim}>:</Text>
              <Text color={C.beige}>{shortCwd(ctl.cwd)}</Text>
              <Text color={C.beigeDim}>{'$ '}</Text>
            </>
          )}
          <Text color={ink}>{before}</Text>
          <Text color={ink} inverse>{at === '\n' ? ' ' : at}</Text>
          <Text color={ink}>{(at === '\n' ? '\n' : '') + after}</Text>
          {chars.length === 0 && !running && !ctl.busy && (chat ? <Text color={C.chatHint}> 用自然語言問 Pip… Esc 回到指令模式</Text> : <Text color={C.beigeDim}> 輸入指令… help 查看說明 · ! 和 Pip 聊天</Text>)}
          {chars.length === 0 && running && <Text color={C.dim}> 輸入會送給執行中的程式 · Ctrl-C 中斷 · Ctrl-D 結束輸入</Text>}
        </Text>
      </Box>
      <Rule width={columns} mode={mode} />
    </Box>
  )
}
