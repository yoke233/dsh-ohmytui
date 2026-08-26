/** Official Code Dispatch events render one nested edit diff in the packaged TUI. */
export async function run(tui) {
  const packageName = 'dsh-live-code-dispatch-fixture'
  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-code-dispatch-fixture',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: code-dispatch-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'class ControlledAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream() {',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'CODE_DISPATCH_DONE' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'let emitted = false',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['code-dispatch-fixture'], new ControlledAdapter())",
      "  ctx.on('agent/pre-step', ({ agent }, next) => {",
      '    if (!emitted) {',
      '      emitted = true',
      "      const rootCallId = 'fixture-root'",
      "      const subCallId = 'fixture-root:repl:1'",
      "      const args = { file_path: 'src/a.ts', old_string: 'const oldValue = 1', new_string: 'const newValue = 2' }",
      "      agent.session.append('tool/code-dispatch-start', { rootCallId, parentCallId: rootCallId, subCallId, name: 'edit', arguments: args })",
      "      agent.session.append('tool/code-dispatch', { rootCallId, parentCallId: rootCallId, subCallId, name: 'edit', arguments: args, isError: false, content: [{ type: 'text', text: 'Edited src/a.ts.' }] })",
      '    }',
      '    return next()',
      '  })',
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()
  tui.submit('RUN_CODE_DISPATCH_FIXTURE')
  await tui.waitForScreen(/• Edit[\s\S]*├─── Input[\s\S]*src\/a\.ts[\s\S]*├─── Output[\s\S]*Edited src\/a\.ts\./, {
    timeoutMs: 20_000,
    label: 'official nested edit card',
  })
  await tui.waitForOutput('CODE_DISPATCH_DONE', { timeoutMs: 20_000, label: 'controlled turn completion' })
  const snapshot = await tui.snapshot('code-dispatch')
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)

  return {
    ready: true,
    nestedCardRendered: true,
    processStayedLive: true,
    pidBefore,
    pidAfter,
    snapshot,
  }
}
