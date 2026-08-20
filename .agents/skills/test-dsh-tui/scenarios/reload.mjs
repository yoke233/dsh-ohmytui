import { existsSync, readFileSync, rmSync } from 'node:fs'

/** Live Bundle add/execute/remove test retained as one example of the generic harness. */
export async function run(tui) {
  const packageName = 'dsh-live-tui-fixture'
  const applied = tui.marker('reload-fixture-applied')
  const executed = tui.marker('reload-fixture-executed')
  rmSync(applied, { force: true })
  rmSync(executed, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-tui-command-fixture',
      `      name: '${packageName}'`,
      '',
    ].join('\n'),
    source: [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "export const inject = ['commands']",
      'export function apply(ctx) {',
      "  writeFileSync(join(process.env.DSH_HOME, 'reload-fixture-applied'), String(process.pid))",
      '  ctx.commands.register({',
      "    name: 'reload-live-probe',",
      "    description: 'Verify in-process Profile reload',",
      '    handler: () => {',
      "      writeFileSync(join(process.env.DSH_HOME, 'reload-fixture-executed'), String(process.pid))",
      "      return { kind: 'success', text: 'RELOAD_LIVE_OK' }",
      '    },',
      '  })',
      '}',
      '',
    ].join('\n'),
  })

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 30_000,
    label: 'welcome screen',
  })
  const pidBefore = tui.pid()

  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])
  if (existsSync(applied)) throw new Error('fixture loaded before /reload')

  const addOffset = tui.mark()
  tui.submit('/reload')
  await tui.waitFor(() => existsSync(applied), 20_000, 'fixture apply marker')
  await tui.waitForOutput(/新增 1|1 added/, {
    since: addOffset,
    timeoutMs: 20_000,
    label: 'added Bundle notice',
  })
  const appliedPid = Number(readFileSync(applied, 'utf8'))
  const pidAfterAdd = tui.pid()
  const added = await tui.snapshot('reload-added')

  tui.submit('/reload-live-probe')
  await tui.waitFor(() => existsSync(executed), 10_000, 'fixture command marker')
  await tui.waitForOutput('RELOAD_LIVE_OK', {
    timeoutMs: 10_000,
    label: 'fixture command result',
  })
  const executedPid = Number(readFileSync(executed, 'utf8'))
  const command = await tui.snapshot('reload-command')

  tui.runDsh(['plugin', '--profile', 'tui', 'remove', packageName])
  const removeOffset = tui.mark()
  tui.submit('/reload')
  await tui.waitForOutput(/移除 1|1 removed/, {
    since: removeOffset,
    timeoutMs: 20_000,
    label: 'removed Bundle notice',
  })
  const pidAfterRemove = tui.pid()
  const removed = await tui.snapshot('reload-removed')

  rmSync(executed, { force: true })
  const unknownOffset = tui.mark()
  tui.submit('/reload-live-probe')
  await tui.waitForOutput(/未知命令|Unknown command/, {
    since: unknownOffset,
    timeoutMs: 10_000,
    label: 'removed command rejection',
  })
  if (existsSync(executed)) throw new Error('removed command still executed')

  const pids = [pidBefore, appliedPid, executedPid, pidAfterAdd, pidAfterRemove]
  if (new Set(pids).size !== 1) throw new Error(`DSH PID changed: ${pids.join(', ')}`)

  return {
    ready: true,
    pidBefore,
    appliedPid,
    executedPid,
    pidAfterAdd,
    pidAfterRemove,
    processStayedLive: true,
    addedBundleLoaded: true,
    addedCommandExecuted: true,
    removedBundleUnloaded: true,
    removedCommandRejected: true,
    screenshots: { added, command, removed },
  }
}
