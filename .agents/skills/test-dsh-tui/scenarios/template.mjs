/** Copy this file and replace the assertions with one observable TUI behavior. */
export async function run(tui) {
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen',
  })
  const pidBefore = tui.pid()

  const offset = tui.mark()
  tui.submit('/help')
  await tui.waitForOutput(/\/new —|\/resume —/, {
    since: offset,
    timeoutMs: 15_000,
    label: 'expected result',
  })
  const screenshot = await tui.snapshot('custom-result')
  const pidAfter = tui.pid()

  if (pidBefore !== pidAfter) {
    throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)
  }

  return {
    expectedBehaviorObserved: true,
    pidBefore,
    pidAfter,
    screenshot,
  }
}
