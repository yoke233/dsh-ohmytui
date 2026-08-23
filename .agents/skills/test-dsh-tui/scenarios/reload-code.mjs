import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** Prove /reload replaces a linked TUI module without changing the DSH process. */
export async function run(tui) {
  const installedPackage = join(
    tui.config.dshHome,
    'profiles',
    'tui',
    'node_modules',
    'dsh-omp-tui',
  )
  const linkedPackage = join(tui.config.dshHome, 'linked-dsh-omp-tui')
  cpSync(installedPackage, linkedPackage, { recursive: true })
  rmSync(installedPackage, { recursive: true, force: true })
  symlinkSync(linkedPackage, installedPackage, 'junction')

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen',
  })
  const pidBefore = tui.pid()
  const entry = join(linkedPackage, 'lib', 'index.js')
  const source = readFileSync(entry, 'utf8')
  const changed = source
    .replaceAll('欢迎回来！', 'LIVE_CODE_RELOAD_OK')
    .replaceAll('Welcome back!', 'LIVE_CODE_RELOAD_OK')
  if (changed === source) throw new Error('linked TUI entry did not contain a welcome marker')
  writeFileSync(entry, changed)

  const offset = tui.mark()
  tui.submit('/reload')
  await tui.waitForOutput('LIVE_CODE_RELOAD_OK', {
    since: offset,
    timeoutMs: 20_000,
    label: 'new TUI module marker',
  })
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)

  const screenshot = await tui.snapshot('reload-code')
  return {
    linkedCodeReloaded: true,
    processStayedLive: true,
    pidBefore,
    pidAfter,
    screenshot,
  }
}
