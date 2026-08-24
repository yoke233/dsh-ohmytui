export async function run(tui) {
  const packageName = 'dsh-live-jobs-fixture'
  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-jobs-fixture',
      `      name: '${packageName}'`,
      '',
    ].join('\n'),
    source: [
      "export const inject = ['commands', 'jobs']",
      'let finishJob',
      'export function apply(ctx) {',
      '  ctx.commands.register({',
      "    name: 'live-job-start',",
      "    description: 'Start a live jobs UI probe',",
      '    handler: () => {',
      "      if (finishJob !== undefined) return { kind: 'error', text: 'LIVE_JOB_ALREADY_RUNNING' }",
      '      let resolveDone',
      '      const done = new Promise(resolve => { resolveDone = resolve })',
      '      const id = ctx.jobs.start({',
      "        kind: 'bash',",
      "        label: 'live jobs probe',",
      '        run: () => ({',
      "          cancel: () => { resolveDone({ status: 'killed', detail: 'cancelled' }); finishJob = undefined },",
      '          done,',
      '        }),',
      '      })',
      "      finishJob = () => { resolveDone({ status: 'completed', detail: 'exit code: 0' }); finishJob = undefined }",
      "      return { kind: 'success', text: `LIVE_JOB_STARTED ${id}` }",
      '    },',
      '  })',
      '  ctx.commands.register({',
      "    name: 'live-job-finish',",
      "    description: 'Finish the live jobs UI probe',",
      '    handler: () => {',
      "      if (finishJob === undefined) return { kind: 'error', text: 'LIVE_JOB_NOT_RUNNING' }",
      '      finishJob()',
      "      return { kind: 'success', text: 'LIVE_JOB_FINISHED' }",
      '    },',
      '  })',
      '}',
      '',
    ].join('\n'),
  })

  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])
  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()

  const startOffset = tui.mark()
  tui.submit('/live-job-start')
  await tui.waitForOutput(/LIVE_JOB_STARTED bash-\d+/, { since: startOffset, timeoutMs: 10_000, label: 'job started' })
  await tui.waitForScreen(/jobs 1/, { timeoutMs: 10_000, label: 'footer jobs count' })

  const listOffset = tui.mark()
  tui.submit('/jobs')
  await tui.waitForOutput(/后台任务（1 个运行中，共 1 个）|Background jobs \(1 running, 1 total\)/, { since: listOffset, timeoutMs: 10_000, label: 'jobs summary' })
  await tui.waitForOutput(/live jobs probe/, { since: listOffset, timeoutMs: 10_000, label: 'job label' })
  const running = await tui.snapshot('jobs-running')

  const finishOffset = tui.mark()
  tui.submit('/live-job-finish')
  await tui.waitForOutput(/LIVE_JOB_FINISHED/, { since: finishOffset, timeoutMs: 10_000, label: 'job finished' })
  await tui.waitFor(async () => !(await tui.screenText()).includes('jobs 1'), 10_000, 'footer jobs count hidden')

  const settledOffset = tui.mark()
  tui.submit('/jobs')
  await tui.waitForOutput(/已完成|completed/, { since: settledOffset, timeoutMs: 10_000, label: 'settled job status' })
  const settled = await tui.snapshot('jobs-settled')
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)

  tui.runDsh(['plugin', '--profile', 'tui', 'remove', packageName])
  return {
    jobsCommandObserved: true,
    footerCountObserved: true,
    footerCountCleared: true,
    processStayedLive: true,
    pidBefore,
    pidAfter,
    screenshots: { running, settled },
  }
}
