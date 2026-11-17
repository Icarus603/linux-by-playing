import { llmConfigured } from '../ask/llm'
import { BADGES } from '../engine/badges'
import { toggleHard } from '../engine/game'
import { loadCatalog, loreText, stageOf } from '../engine/levels'
import { rankOf } from '../engine/state'
import type { Controller } from './controller'
import { T, t, tr, type Lang } from '../i18n'

// 以 / 開頭的是「遊戲指令」，由 Pip 回應（打字機效果）。其餘輸入一律交給真實的 bash。

export type SlashDef = { name: string; usage: string; desc: string; /** 必須帶參數，選取時不直接執行 */ needsArg?: boolean }

export const SLASH: SlashDef[] = [
  { name: 'help', usage: '/help', desc: T('看所有指令') },
  { name: 'quit', usage: '/quit', desc: T('離開遊戲（進度已自動存檔）') },
  { name: 'hint', usage: '/hint', desc: T('看提示（會少拿一些 XP）') },
  { name: 'ask', usage: T('/ask 問題'), desc: T('問 Pip 任何 Linux 問題（直接輸入中文問句也行）') },
  { name: 'explain', usage: T('/explain [指令]'), desc: T('請 Pip 解釋指令，不加參數就解釋這關用到的') },
  { name: 'why', usage: '/why', desc: T('解釋上一個指令為什麼失敗') },
  { name: 'map', usage: '/map', desc: T('各階段進度總覽') },
  { name: 'stats', usage: '/stats', desc: T('等級與經驗值') },
  { name: 'levels', usage: '/levels', desc: T('選關（↑↓ 選擇，可重玩已完成的關卡）') },
  { name: 'goto', usage: '/goto [2-03]', desc: T('跳到指定關卡，不加編號會開選單') },
  { name: 'prev', usage: '/prev', desc: T('回上一關') },
  { name: 'next', usage: '/next', desc: T('到下一關') },
  { name: 'continue', usage: '/continue', desc: T('回到最前面還沒完成的關卡') },
  { name: 'skip', usage: '/skip', desc: T('跳過本關') },
  { name: 'restart', usage: '/restart', desc: T('重來本關') },
  { name: 'clear', usage: '/clear', desc: T('清空輸出區') },
  { name: 'copy', usage: '/copy', desc: T('複製上一個指令的輸出到剪貼簿') },
  { name: 'reset', usage: '/reset', desc: T('重置所有進度（還要再輸入 /reset confirm 確認）') },
  { name: 'hard', usage: '/hard', desc: T('切換困難模式（無提示，XP ×1.5）') },
  { name: 'badges', usage: '/badges', desc: T('成就徽章') },
  { name: 'lore', usage: '/lore', desc: T('回顧收集到的日誌碎片') },
  { name: 'tip', usage: '/tip', desc: T('一則 Linux 小技巧') },
  { name: 'joke', usage: '/joke', desc: T('工程師笑話') },
  { name: 'dance', usage: '/dance', desc: T('看 Pip 跳舞') },
  { name: 'language', usage: '/language [tw|cn|en]', desc: T('切換語言：繁體中文 / 简体中文 / English（也同步 Pip 的回答語言）') },
]
export const SLASH_NAMES = SLASH.map((s) => s.name)

const TIPS = [
  T('按 Tab 可以補全指令與檔名，打錯字的機會少一大半。'),
  T('指令跑到一半卡住了？Ctrl-C 可以中斷它。'),
  T('cd - 會回到「上一個」所在的目錄，在兩個資料夾之間來回很方便。'),
  T('!! 代表上一個指令。忘了加 sudo 的時候，輸入 sudo !! 就好。'),
  T('ls -lhS 依大小排序並用 KB/MB 顯示，找佔空間的檔案很快。'),
  T('用 grep -r 找內容、find 找檔名，記得這個分工就不會搞混。'),
  T('管線 | 把前一個指令的輸出接到下一個，每個工具只做一件事，組合起來就很強。'),
  T('rm 沒有垃圾桶。刪除之前先用 ls 預覽一次同樣的萬用字元。'),
  T('man 指令名稱 看說明書，按 / 搜尋、q 離開。找不到選項時它最可靠。'),
  T('cat 檔案 | wc -l 可以快速數行數，wc -l < 檔案 也行。'),
  T('tail -f 會持續追蹤檔案新增的內容，看即時日誌的標準做法。'),
  T('chmod 數字：r=4、w=2、x=1，加起來就是一組權限，755 = rwxr-xr-x。'),
  T('單引號裡的內容原樣保留，雙引號裡 $變數 還是會被展開。'),
  T('指令前面加一個空白、或寫成 \\指令，可以略過別名。'),
  T('Ctrl-A 跳到行首、Ctrl-E 跳到行尾、Ctrl-W 刪掉前一個單字，在這個輸入框也能用。'),
  T('set -euo pipefail 是寫 shell 腳本最值得養成的習慣：出錯就停，不要悄悄繼續。'),
]

const JOKES = [
  T('為什麼工程師分不清萬聖節和聖誕節？因為 Oct 31 == Dec 25。'),
  T('有人問 root：你累不累？root 說：我什麼都能做，所以什麼都要負責。'),
  T('我有個關於 UDP 的笑話，不過你可能收不到。'),
  T('遞迴的定義：如果你還沒懂，請看「遞迴的定義」。'),
  T('「這個指令很安全，我先在測試環境跑過了。」——所有事故報告的開頭。'),
  T('rm -rf / 是最誠實的指令：它從不騙你，它真的會做。'),
  T('程式設計有兩件難事：快取失效、命名，還有差一錯誤。'),
]

const pick = <T>(xs: T[]): T => xs[Math.floor(Math.random() * xs.length)]!

function whatis(cmd: string): string {
  if (!/^[A-Za-z0-9_.+-]+$/.test(cmd)) return ''
  const p = Bun.spawnSync(['bash', '-c', 'whatis -- "$1" 2>/dev/null | head -1', '_', cmd], { stdin: 'ignore', timeout: 1500 })
  const line = p.stdout.toString().trim().replace(/\s+/g, ' ')
  if (!line || /nothing appropriate/i.test(line)) return ''
  const m = / - (.+)$/.exec(line)
  return m ? m[1]! : ''
}

const stripAnsi = (s: string): string => s.replace(/\x1b\[[0-9;]*m/g, '')

/** 解釋上一個指令為什麼失敗：靠結束碼與輸出裡的常見訊息做簡單診斷。 */
function diagnose(rc: number | null, out: string): string {
  if (rc === 0) return t('上一個指令成功了（結束碼 0），沒有錯誤喔。')
  if (rc === 127 || /command not found/.test(out))
    return t('找不到這個指令（結束碼 127）。先檢查拼字；用 which 或 type 確認它存在；善用 Tab 補全可以避免打錯。')
  if (/No such file or directory/.test(out))
    return t('路徑不存在。先用 pwd 確認自己在哪，再用 ls 確認檔名。相對路徑是從「目前所在的目錄」算起，大小寫也要一致。')
  if (/Permission denied|Operation not permitted/.test(out))
    return t('權限不足。用 ls -l 看這個檔案或目錄的權限與擁有者；需要時用 sudo 借用 root，或用 chmod 調整權限。')
  if (/Is a directory/.test(out)) return t('你把「目錄」當成檔案用了。想看內容用 ls，想進去用 cd。')
  if (/Not a directory/.test(out)) return t('路徑中間有一段其實是檔案，不是目錄。檢查有沒有多打了斜線。')
  if (/syntax error|unexpected token|unexpected EOF/.test(out))
    return t('語法錯誤。檢查引號、括號、反引號有沒有成對，特殊字元（& ; | < >）要不要加引號。')
  if (/invalid option|unrecognized option|unknown option/.test(out))
    return t('這個選項不存在。用 指令 --help 或 man 指令 查看正確的選項。')
  if (/missing operand|requires an argument|missing file operand/.test(out)) return t('少了必要的參數。用 man 或 --help 看這個指令至少需要什麼。')
  if (rc === 130) return t('這是你按了 Ctrl-C 中斷它（結束碼 130），不是錯誤。')
  if (rc === 124) return t('指令被 timeout 中止了（結束碼 124）：它跑太久。')
  if (rc === 126) return t('檔案存在但不能執行（結束碼 126）。用 chmod +x 加上執行權限。')
  return t`指令回報失敗（結束碼 ${rc}），不過我看不出明確原因。仔細讀它印出的錯誤訊息，通常答案就在那一行。`
}

/** 處理由 Pip 回應的 slash 指令。回傳 false 代表不是我負責的指令。 */
export function runSlash(ctl: Controller, name: string, args: string): boolean {
  const cat = loadCatalog()
  const s = ctl.game
  switch (name) {
    case 'help': {
      const lines = SLASH.map((c) => `  ${tr(c.usage).padEnd(16)} ${tr(c.desc)}`).join('\n')
      ctl.store.push({ kind: 'list', text: t`Pip 的指令\n${lines}\n\n其他輸入都會交給真正的 bash 執行。` })
      ctl.speak([
        {
          text: t('以 / 開頭的是我的指令，我會幫你解釋、看進度、也能陪你聊天。其他輸入都是真正的 Linux 指令，直接交給 bash。要離開就輸入 /quit。'),
          pose: 'wave',
          tone: 'info',
        },
      ])
      return true
    }
    case 'explain': {
      const cmd = args.trim().split(/\s+/)[0] ?? ''
      if (!cmd) {
        const lvl = s.current ? cat.byId.get(s.current) : undefined
        if (!lvl || lvl.teaches.length === 0) {
          ctl.speak([{ text: t('這關沒有特別要解釋的指令。想問哪個指令，輸入 /explain 指令名稱，例如 /explain grep。'), pose: 'think', tone: 'info' }])
          return true
        }
        const items = lvl.teaches
          .filter((x) => /^[A-Za-z0-9_.+-]+$/.test(x))
          .slice(0, 4)
          .map((x) => t`• ${x}：${whatis(x) || t('（見關卡提示）')}`)
        ctl.speak([
          { text: t`這關會用到：\n${items.join('\n')}\n\n想深入某一個，輸入 /explain 指令名稱。`, pose: 'think', tone: 'info' },
        ])
        return true
      }
      // 有本機模型就交給 Pip 完整解釋（有上下文、可追問）；沒有模型才用固定說明
      if (llmConfigured() && /^[A-Za-z0-9_.+-]+$/.test(cmd)) {
        ctl.ask(t`請詳細解釋 ${cmd} 指令：它是做什麼的、最常用的選項與範例、常見的陷阱`)
        return true
      }
      const w = whatis(cmd)
      const hit = cat.levels.find((l) => l.teaches.includes(cmd))
      let text: string
      if (hit) {
        text = t`「${cmd}」${w ? '：' + w : ''}\n\n我在 ${hit.id}「${hit.title}」教過它：${hit.story}`
        const ex = hit.hints.find((h) => h.includes(cmd))
        if (ex) text += t`\n範例：${ex}`
        text += t`\n想複習可以輸入 /goto ${hit.id}。`
      } else if (w) {
        text = t`「${cmd}」：${w}\n\n我還沒在關卡裡教它，完整說明請看 man ${cmd}。`
      } else {
        text = t`我找不到「${cmd}」的資料。拼字對嗎？可以試試 man ${cmd} 或 ${cmd} --help。`
      }
      ctl.speak([{ text, pose: w || hit ? 'think' : 'worry', tone: 'info' }])
      return true
    }
    case 'why': {
      const e = ctl.lastCmd()
      if (!e) {
        ctl.speak([{ text: t('你還沒有執行過指令呢。先試試看，出錯了再問我 /why。'), pose: 'idle', tone: 'plain' }])
        return true
      }
      const out = stripAnsi(e.lines.join('\n'))
      ctl.speak([{ text: t`關於「${e.cmd}」：\n${diagnose(e.rc, out)}`, pose: e.rc === 0 ? 'happy' : 'think', tone: 'info' }])
      return true
    }
    case 'map': {
      const rows = cat.stages.map((st) => {
        const lv = cat.levels.filter((l) => stageOf(l) === st.id)
        const done = lv.filter((l) => s.done[l.id]).length
        const w = 16
        const f = lv.length ? Math.round((done / lv.length) * w) : 0
        return t`階段 ${st.id}  ${st.title.padEnd(8, '　')} ${'█'.repeat(f)}${'░'.repeat(w - f)} ${done}/${lv.length}`
      })
      const total = Object.keys(s.done).length
      ctl.store.push({ kind: 'list', text: rows.join('\n') })
      ctl.speak([{ text: t`你已經完成 ${total}/${cat.levels.length} 關。進度圖在下面，繼續加油！`, pose: 'happy', tone: 'plain' }])
      return true
    }
    case 'stats': {
      const r = rankOf(s.xp)
      const hints = Object.values(s.done).reduce((a, d) => a + d.hints, 0)
      const next = r.next ? t`距離下一級還差 ${r.next - s.xp} XP。` : t('你已經是最高等級了！')
      ctl.speak([
        {
          text: t`你目前是「${tr(r.name)}」，累積 ${s.xp} XP。${next}\n已完成 ${Object.keys(s.done).length} 關，一共用了 ${hints} 次提示。`,
          pose: 'happy',
          tone: 'ok',
        },
      ])
      return true
    }
    case 'copy': {
      const e = ctl.lastCmd()
      if (!e || e.lines.length === 0) {
        ctl.speak([{ text: t('目前沒有可以複製的輸出。先執行一個指令再試試。你也可以直接用滑鼠拖曳選取，放開就會自動複製。'), pose: 'think', tone: 'info' }])
        return true
      }
      const out = stripAnsi(e.lines.join('\n'))
      void ctl.copyToClipboard(out)
      ctl.flash(t`已複製 ${[...out].length} 字`)
      ctl.speak([{ text: t`已把「${e.cmd.split('\n')[0]}」的輸出複製到剪貼簿。貼上用 Cmd-V（或 Ctrl-Shift-V）。`, pose: 'happy', tone: 'ok' }])
      return true
    }
    case 'hard': {
      const on = toggleHard()
      ctl.refresh()
      ctl.speak([
        {
          text: on
            ? t('困難模式開啟！沒有提示、不顯示指令名稱，所有 XP ×1.5。看你的本事了。再輸入一次 /hard 可以關掉。')
            : t('回到一般模式。需要的時候我會給你提示。'),
          pose: on ? 'happy' : 'idle',
          tone: on ? 'ok' : 'plain',
        },
      ])
      return true
    }
    case 'badges': {
      const have = new Set(s.badges)
      const rows = BADGES.map((b) => `${have.has(b.id) ? '★' : '☆'} ${tr(b.name).padEnd(8, '　')} ${have.has(b.id) ? tr(b.desc) : '？？？'}`)
      ctl.store.push({ kind: 'list', text: rows.join('\n') })
      ctl.speak([{ text: t`你已解鎖 ${s.badges.length}/${BADGES.length} 個徽章。最長連勝紀錄是 ${s.bestStreak}。`, pose: 'happy', tone: 'ok' }])
      return true
    }
    case 'lore': {
      if (s.lore.length === 0) {
        ctl.speak([{ text: t('你還沒有收集到日誌碎片。每通過幾個關卡，我會替你解讀一段 Vega 留下的線索。'), pose: 'think', tone: 'info' }])
        return true
      }
      const all = s.lore.map((l, i) => `#${i + 1}（${l.id}）${loreText(l)}`).join('\n\n')
      ctl.store.push({ kind: 'list', text: all })
      const last = s.lore[s.lore.length - 1]!
      ctl.speak([{ text: t`已收集 ${s.lore.length} 則碎片，完整內容在下面。最新的一則：\n${loreText(last)}`, pose: 'think', tone: 'info' }])
      return true
    }
    case 'tip':
      ctl.speak([{ text: t`小技巧：${tr(pick(TIPS))}`, pose: 'think', tone: 'info' }])
      return true
    case 'joke':
      ctl.speak([{ text: tr(pick(JOKES)), pose: 'happy', tone: 'plain' }])
      return true
    case 'dance':
      ctl.speak([{ text: t('♪ 啦啦啦～ 企鵝甩甩翅膀，扭扭身體！'), pose: 'happy', tone: 'ok', danceMs: 5000 }])
      return true
    case 'language':
    case 'lang': {
      const a = args.trim().toLowerCase().replace(/[_\s]/g, '-')
      const map: Record<string, Lang> = { tw: 'zh-TW', 'zh-tw': 'zh-TW', hant: 'zh-TW', '繁體': 'zh-TW', '繁体': 'zh-TW', '繁體中文': 'zh-TW', cn: 'zh-CN', 'zh-cn': 'zh-CN', hans: 'zh-CN', '簡體': 'zh-CN', '简体': 'zh-CN', '简体中文': 'zh-CN', en: 'en', english: 'en', '英文': 'en', '英语': 'en' }
      if (!a) ctl.openLangPicker()
      else if (map[a]) ctl.setLanguage(map[a]!)
      else ctl.speak([{ text: 'Usage: /language [tw|cn|en]', pose: 'worry', tone: 'plain' }])
      return true
    }
  }
  return false
}
