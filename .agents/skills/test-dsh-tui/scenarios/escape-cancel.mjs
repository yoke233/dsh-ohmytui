import { existsSync, rmSync, writeFileSync } from 'node:fs'

/** Escape aborts a controlled running turn without exiting the TUI process. */
export async function run(tui) {
  const packageName = 'dsh-live-escape-cancel-fixture'
  const requestStarted = tui.marker('escape-cancel-request-started')
  const requestAborted = tui.marker('escape-cancel-request-aborted')
  for (const path of [requestStarted, requestAborted]) rmSync(path, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-escape-cancel-llm',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: escape-cancel-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import { setTimeout as delay } from 'node:timers/promises'",
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'class ControlledAdapter extends LlmAdapter {',
      "  async resolveModel(provider, model) { return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } } }",
      '  async * stream(options) {',
      "    writeFileSync(join(process.env.DSH_HOME, 'escape-cancel-request-started'), String(process.pid))",
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'ESCAPE_CANCEL_WAITING' }",
      '    while (!options.signal?.aborted) await delay(25)',
      "    writeFileSync(join(process.env.DSH_HOME, 'escape-cancel-request-aborted'), String(process.pid))",
      "    throw new Error('aborted by Escape')",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['escape-cancel-fixture'], new ControlledAdapter())",
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()
  tui.submit('START_ESCAPE_CANCEL_TURN')
  await tui.waitFor(() => existsSync(requestStarted), 15_000, 'controlled model request')
  await tui.waitForOutput('ESCAPE_CANCEL_WAITING', { timeoutMs: 15_000, label: 'running response' })

  tui.key('\x1b')
  await tui.waitFor(() => existsSync(requestAborted), 15_000, 'model request aborted by Escape')
  tui.submit('/help')
  await tui.waitForScreen(/键盘快捷键|Keyboard shortcuts/, { timeoutMs: 15_000, label: 'TUI accepts input after cancellation' })
  await tui.waitForScreen(/Esc[\s\S]*(停止进行中的任务|stop the running task)/, { timeoutMs: 5_000, label: 'Escape shortcut help' })

  const pidAfter = tui.pid()
  const abortedPid = Number((await import('node:fs')).readFileSync(requestAborted, 'utf8'))
  if (pidBefore !== pidAfter || pidBefore !== abortedPid) {
    throw new Error(`DSH PID changed: ${pidBefore}, ${abortedPid}, ${pidAfter}`)
  }
  const settled = await tui.snapshot('escape-cancel-settled')
  return { escapeCancelledRunningTurn: true, processStayedLive: true, pidBefore, pidAfter, screenshots: { settled } }
}
