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
  await tui.waitForOutput(/\/reload —|\/settings —/, {
    since: helpOffset,
    timeoutMs: 15_000,
    label: 'help command list output',
  })
  await tui.waitForScreen(/\/reload —|\/settings —/, {
    timeoutMs: 15_000,
    label: 'visible help command list',
  })
  const help = await tui.snapshot('smoke-help')
  const pidAfter = tui.pid()

  if (pidBefore !== pidAfter) {
    throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)
  }

  return {
    ready: true,
    helpRendered: true,
    inputAccepted: true,
    pidBefore,
    pidAfter,
    processStayedLive: true,
    screenshots: { welcome, help },
  }
}
