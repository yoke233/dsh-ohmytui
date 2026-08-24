/** Packaged startup, input, help rendering, screenshot, and PID continuity. */
export async function run(tui) {
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen',
  })
  const pidBefore = tui.pid()
  const welcome = await tui.snapshot('smoke-welcome')

  const helpOffset = tui.mark()
  tui.submit('/help')
  await tui.waitForOutput(/\/settings —/, {
    since: helpOffset,
    timeoutMs: 15_000,
    label: 'help command list output',
  })
  await tui.waitForScreen(/\/settings —/, {
    timeoutMs: 15_000,
    label: 'visible help command list',
  })
  const helpScreen = await tui.screenText()
  if (!/\/reload —/.test(helpScreen)) {
    throw new Error('/reload command is missing from help')
  }
  const help = await tui.snapshot('smoke-help')

  // Without the omdsh supervisor a reload exit could not respawn, so the
  // command must refuse and the process must stay alive.
  const reloadOffset = tui.mark()
  tui.submit('/reload')
  await tui.waitForOutput(/omdsh/, {
    since: reloadOffset,
    timeoutMs: 15_000,
    label: 'unsupervised reload refusal notice',
  })

  const pidAfter = tui.pid()

  if (pidBefore !== pidAfter) {
    throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)
  }

  return {
    ready: true,
    helpRendered: true,
    inputAccepted: true,
    reloadRefusedWithoutSupervisor: true,
    pidBefore,
    pidAfter,
    processStayedLive: true,
    screenshots: { welcome, help },
  }
}
