import { existsSync, rmSync } from 'node:fs'

/** Ctrl+C clears a running draft first, then recalls queued steers and cancels. */
export async function run(tui) {
  const packageName = 'dsh-live-ctrl-c-steer-fixture'
  const requestStarted = tui.marker('ctrl-c-steer-request-started')
  const requestAborted = tui.marker('ctrl-c-steer-request-aborted')
  for (const path of [requestStarted, requestAborted]) rmSync(path, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-ctrl-c-steer-llm',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: ctrl-c-steer-fixture',
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
      "    writeFileSync(join(process.env.DSH_HOME, 'ctrl-c-steer-request-started'), String(process.pid))",
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'CTRL_C_STEER_WAITING' }",
      '    while (!options.signal?.aborted) await delay(25)',
      "    writeFileSync(join(process.env.DSH_HOME, 'ctrl-c-steer-request-aborted'), String(process.pid))",
      "    throw new Error('aborted by Ctrl+C')",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['ctrl-c-steer-fixture'], new ControlledAdapter())",
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()
  tui.submit('START_CTRL_C_STEER_TURN')
  await tui.waitFor(() => existsSync(requestStarted), 15_000, 'controlled model request')
  await tui.waitForOutput('CTRL_C_STEER_WAITING', { timeoutMs: 15_000, label: 'running response' })
  tui.submit('CTRL_C_STEER_ONE')
  tui.submit('CTRL_C_STEER_TWO')
  await tui.waitForScreen(/Steering:[\s\S]*CTRL_C_STEER_ONE[\s\S]*CTRL_C_STEER_TWO/, { timeoutMs: 5_000, label: 'queued Ctrl+C steers' })

  for (const char of 'DRAFT_TO_CLEAR') tui.key(char)
  await tui.waitForScreen('DRAFT_TO_CLEAR', { timeoutMs: 5_000, label: 'running draft' })
  tui.key('\x03')
  await tui.waitFor(async () => {
    const screen = await tui.screenText()
    return !screen.includes('DRAFT_TO_CLEAR') && screen.includes('Steering:') && screen.includes('CTRL_C_STEER_ONE')
  }, 5_000, 'first Ctrl+C cleared only the draft')
  if (existsSync(requestAborted)) throw new Error('First Ctrl+C cancelled despite a non-empty draft')

  tui.key('\x03')
  await tui.waitFor(() => existsSync(requestAborted), 15_000, 'second Ctrl+C aborted model request')
  await tui.waitFor(async () => {
    const screen = await tui.screenText()
    return screen.includes('CTRL_C_STEER_ONE') && screen.includes('CTRL_C_STEER_TWO') && !screen.includes('Steering:')
  }, 5_000, 'Ctrl+C recalled queued steers into editor')
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)
  return { draftClearedWithoutCancel: true, emptyDraftCancelled: true, queuedSteersRecalled: true, processStayedLive: true, pidBefore, pidAfter }
}
