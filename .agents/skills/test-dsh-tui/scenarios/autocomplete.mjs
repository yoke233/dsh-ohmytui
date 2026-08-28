/** Slash-command readiness, Tab command acceptance, and argument-menu transition. */
export async function run(tui) {
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  await tui.waitForSlashMenu({ expected: /→\s+(?:palette|help|model|mode)/ })
  const pidBefore = tui.pid()

  tui.key('m')
  tui.key('o')
  await tui.waitForScreen(/→\s+mode/, { timeoutMs: 10_000, label: 'mode command candidate' })
  tui.key('\t')
  await tui.waitForScreen(/standard[\s\S]*minimal[\s\S]*code[\s\S]*cordis/, {
    timeoutMs: 10_000,
    label: 'mode argument candidates after Tab',
  })

  const screen = await tui.screenText()
  if (screen.includes('/mode <standard')) {
    throw new Error(`Duplicate mode syntax hint remained.\n${screen}`)
  }
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)

  return {
    slashMenuReady: true,
    tabOpenedArguments: true,
    duplicateHintHidden: true,
    pidBefore,
    pidAfter,
    processStayedLive: true,
  }
}
