const ERROR_TEXT = 'SIMULATED_NETWORK_429_RETRIES_EXHAUSTED'

/** A failed model turn remains in transcript order instead of the notice slot. */
export async function run(tui) {
  const packageName = 'dsh-live-error-persistence-fixture'
  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-error-persistence-llm',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: error-persistence-fixture',
      '    model: controlled',
      '- id: session-title-llm-tui',
      '  disabled: true',
      '',
    ].join('\n'),
    source: [
      "import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'let requestCount = 0',
      'class ControlledAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  providerRetryPolicy() {',
      "    return { mode: 'normal', maxRetries: 2, retryableCodes: ['TRANSPORT'], initialDelayMs: 700, maxDelayMs: 700, jitterRatio: 0 }",
      '  }',
      '  async * stream() {',
      '    requestCount += 1',
      `    if (requestCount <= 3) throw new LlmError('${ERROR_TEXT}', 'TRANSPORT')`,
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'SECOND_TURN_OK' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SECOND_TURN_OK' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['error-persistence-fixture'], new ControlledAdapter())",
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  tui.submit('TRIGGER_CONTROLLED_NETWORK_FAILURE')
  await tui.waitForScreen(/(?:重试|retrying) 1\/2/, { timeoutMs: 15_000, label: 'first retry progress' })
  await tui.waitForScreen(ERROR_TEXT, { timeoutMs: 15_000, label: 'model error row' })
  await tui.waitForScreen(/(?:第 3 次尝试|attempt 3)/, { timeoutMs: 15_000, label: 'final request attempt count' })

  tui.submit('RUN_SECOND_CONTROLLED_TURN')
  await tui.waitForScreen('SECOND_TURN_OK', { timeoutMs: 15_000, label: 'second model response' })
  await new Promise(resolve => setTimeout(resolve, 6_000))

  const screen = await tui.screenText()
  const errorIndex = screen.indexOf(ERROR_TEXT)
  const secondTurnIndex = screen.indexOf('SECOND_TURN_OK')
  if (errorIndex === -1) throw new Error('model error disappeared from the transcript list')
  if (errorIndex > secondTurnIndex) {
    throw new Error('model error rendered in the notice slot instead of transcript order')
  }

  return {
    errorRenderedInTranscriptOrder: true,
    errorStillVisibleAfterMs: 6_000,
  }
}
