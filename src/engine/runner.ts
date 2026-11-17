import type { Level } from './types'
import { L } from '../i18n'

const isRoot = (): boolean => process.getuid?.() === 0
const PLAYER = 'player'
export const HOME = '/home/player'

export type RunResult = { code: number; out: string; err: string }

function run(argv: string[], env: Record<string, string>, timeoutMs: number): RunResult {
  const p = Bun.spawnSync(argv, {
    env: { ...process.env, LBP_LANG: L(), ...env },
    stdin: 'ignore',
    timeout: timeoutMs,
    cwd: '/',
  })
  return {
    code: p.exitCode ?? 124,
    out: p.stdout.toString(),
    err: p.stderr.toString(),
  }
}

/** 以 root 執行腳本（容器內 player 有免密 sudo）。 */
export function asRoot(script: string, env: Record<string, string> = {}, timeoutMs = 20000): RunResult {
  // sudo 會把完整指令（也就是整段關卡腳本）放進 SUDO_COMMAND，並被子程序繼承；
  // 玩家讀 /proc/PID/environ 就能看到 setup 內容（洩題），所以一律先 unset。
  const clean = `unset SUDO_COMMAND SUDO_USER SUDO_UID SUDO_GID\n${script}`
  const base = ['bash', '-c', clean]
  return run(isRoot() ? base : ['sudo', '-n', '-E', ...base], { HOME: '/root', ...env }, timeoutMs)
}

/** 以 player 身分執行（驗證解答用）。 */
export function asPlayer(script: string, env: Record<string, string> = {}, cwd = HOME, timeoutMs = 20000): RunResult {
  // 解答結束後把最終的 $PWD 記下來，讓 verify 能模擬 LBP_CWD。
  const wrapped = `cd ${cwd} && { ${script}
}; __rc=$?; printf %s "$PWD" > /tmp/.lbp_cwd; exit $__rc`
  const base = ['bash', '-c', wrapped]
  const argv = isRoot() ? ['runuser', '-u', PLAYER, '--', ...base] : base
  return run(argv, { HOME, USER: PLAYER, LOGNAME: PLAYER, PATH: process.env.PATH ?? '', ...env }, timeoutMs)
}

/** 每關開始前的共同重設：清空家目錄、還原骨架檔。 */
const RESET = `
set +e
find ${HOME} -mindepth 1 -delete 2>/dev/null
cp -a /etc/skel/. ${HOME}/ 2>/dev/null
chown -R ${PLAYER}:${PLAYER} ${HOME}
cd ${HOME}
`

export function enter(level: Level): RunResult {
  return asRoot(`${RESET}\nset -e\n${level.setup}\nchown -R ${PLAYER}:${PLAYER} ${HOME} 2>/dev/null || true`)
}

export function leave(level: Level): void {
  if (level.cleanup.trim()) asRoot(level.cleanup)
}

export function check(level: Level, env: { last: string; answer: string; cwd: string; rc?: string }): RunResult {
  return asRoot(level.check, { LBP_LAST: env.last, LBP_ANSWER: env.answer, LBP_CWD: env.cwd, LBP_RC: env.rc ?? '0', PLAYER_HOME: HOME })
}
