export async function run(tui) {
  const tarball = process.env.DSH_WEB_ACCESS_TGZ
  if (!tarball) throw new Error('DSH_WEB_ACCESS_TGZ is required')

  tui.runDsh(['plugin', '--profile', 'tui', 'add', tarball])
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen with dsh-web-access installed',
  })

  const pidBefore = tui.pid()
  const offset = tui.mark()
  tui.submit('/webaccess')
  await tui.waitForOutput(/dsh-web-access tools: web_search, fetch_content, get_search_content, source_check/, {
    since: offset,
    timeoutMs: 20_000,
    label: 'web access status command',
  })
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)

  return {
    webAccessLoaded: true,
    pidBefore,
    pidAfter,
  }
}
