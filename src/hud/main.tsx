import React from 'react'
import { render } from './ink'
import { App } from './App'
import { Controller } from './controller'

/** 主迴圈：Ink 全螢幕介面 ⇄ 全螢幕程式（less/vim/top…）交接。 */
export async function runHud(): Promise<void> {
  const ctl = new Controller()
  ctl.start()
  process.on('SIGTERM', () => ctl.shutdown())

  while (!ctl.quit) {
    const inst = await render(<App ctl={ctl} />, { exitOnCtrlC: false, patchConsole: false })
    const next = await ctl.waitForSwitch()
    inst.unmount()
    await new Promise((r) => setTimeout(r, 30))
    if (next === 'quit' || ctl.quit) break
    await ctl.passthrough()
  }
  ctl.shutdown()
}
