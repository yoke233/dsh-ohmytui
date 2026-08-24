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
  if (/\/reload —/.test(helpScreen)) {
    throw new Error('disabled /reload command is still present in help')
  }
  const help = await tui.snapshot('smoke-help')

  const reloadOffset = tui.mark()
  tui.submit('/reload')
  await tui.waitForOutput(/未知命令：reload|Unknown command: reload/, {
    since: reloadOffset,
    timeoutMs: 15_000,
    label: 'disabled reload command rejection',
  })

  const pidAfter = tui.pid()

  if (pidBefore !== pidAfter) {
    throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)
  }

  return {
    ready: true,
    helpRendered: true,
    inputAccepted: true,
    reloadDisabled: true,
    pidBefore,
    pidAfter,
    processStayedLive: true,
    screenshots: { welcome, help },
  }
}
