// 唯一的 Ink 轉接層：專案其他程式只從這裡引入 UI 原語。
// 目前指向 vendor/ink（訂製版，修正 resize 斷裂）；發布前如需替換，只改這個檔。
export {
  BaseBox as Box,
  BaseText as Text,
  Ansi,
  AlternateScreen,
  ScrollBox,
  wrappedRender as render,
  useInput,
  useApp,
  useTerminalSize,
  useAnimationFrame,
  stringWidth,
  wrapAnsi,
  useSelection,
  setClipboard,
} from '@vendor/ink'
export type { ScrollBoxHandle } from '@vendor/ink'
