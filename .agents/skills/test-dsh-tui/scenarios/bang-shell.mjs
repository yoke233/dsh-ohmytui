const SHELL_OUTPUT = 'BANG_SHELL_STDOUT'
const AGENT_OUTPUT = 'SHELL_RESULT_SEEN_BY_AGENT'

/** A leading ! runs in the profile shell, persists as a card, then starts an agent turn with its result. */
export async function run(tui) {
  const packageName = 'dsh-live-bang-shell-fixture'
  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-bang-shell-llm',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: bang-shell-fixture',
      '    model: controlled',
      '- id: session-title-llm-tui',
      '  disabled: true',
      '',
    ].join('\n'),
    source: [
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'class ControlledAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream(options) {',
      `    const text = JSON.stringify(options.messages).includes('${SHELL_OUTPUT}')`,
      `      ? '${AGENT_OUTPUT}'`,
      "      : 'SHELL_RESULT_MISSING_FROM_AGENT'",
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['bang-shell-fixture'], new ControlledAdapter())",
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()
  const command = process.platform === 'win32'
    ? `!Write-Output ${SHELL_OUTPUT}`
    : `!printf '${SHELL_OUTPUT}\n'`
  tui.submit(command)
  await tui.waitForScreen(SHELL_OUTPUT, { timeoutMs: 30_000, label: 'shell result card' })
  await tui.waitForScreen(AGENT_OUTPUT, { timeoutMs: 30_000, label: 'agent sees shell user message' })

  const screen = await tui.screenText()
  if (screen.includes('SHELL_RESULT_MISSING_FROM_AGENT')) {
    throw new Error('shell result was rendered but not included in the agent user message')
  }
  if (screen.includes('<omdsh_shell_result')) {
    throw new Error('serialized shell envelope leaked instead of rendering as a shell card')
  }
  const pidAfter = tui.pid()
  if (pidAfter !== pidBefore) throw new Error(`DSH process changed during shell command: ${pidBefore} -> ${pidAfter}`)

  return {
    shellCardRendered: true,
    resultVisibleToAgent: true,
    envelopeHidden: true,
    pidBefore,
    pidAfter,
    processStayedLive: true,
  }
}
