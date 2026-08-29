/** Live child agents expose a compact hint that Down opens and Left closes. */
export async function run(tui) {
  const packageName = 'dsh-live-subagent-navigation-fixture'
  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-subagent-navigation-fixture',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: subagent-navigation-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "import { SessionId } from '@deepseek-ai/dsh-session'",
      "export const inject = ['llm', 'agents']",
      'class ControlledAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream() {',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'SUBAGENT_NAV_DONE' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'let childHandle',
      'let created = false',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['subagent-navigation-fixture'], new ControlledAdapter())",
      "  ctx.on('agent/pre-step', async ({ agent }, next) => {",
      '    if (!created) {',
      '      created = true',
      "      childHandle = await ctx.agents.create({ sessionId: SessionId('live-navigation-child'), meta: { cwd: agent.session.header.cwd, parentSession: agent.id, origin: 'subagent' }, agentOptions: agent.options })",
      "      childHandle.agent.session.append('subagent/descriptor', { label: 'research', mode: 'continuable' })",
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
  tui.submit('RUN_SUBAGENT_NAV_FIXTURE')
  await tui.waitForOutput('SUBAGENT_NAV_DONE', { timeoutMs: 20_000, label: 'controlled turn completion' })
  await tui.waitForScreen(/agents ● 0 running ○ 1 idle.*↓ select/, { timeoutMs: 20_000, label: 'compact subagent statuses' })

  tui.key('\x1b[B')
  await tui.waitForScreen(/Background tasks[\s\S]*← (?:Main agent|Main)[\s\S]*Subagents[\s\S]*research · continuable · idle/, {
    timeoutMs: 10_000,
    label: 'expanded subagent list',
  })

  tui.key('\x1b[D')
  await tui.waitForScreen(/agents ● 0 running ○ 1 idle.*↓ select/, { timeoutMs: 10_000, label: 'returned main-agent view' })
  const returnedScreen = await tui.screenText()
  if (/← (?:Main agent|Main)/u.test(returnedScreen)) throw new Error('Subagent list remained expanded after Left')
  const snapshot = await tui.snapshot('subagent-navigation')
  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed: ${pidBefore} -> ${pidAfter}`)

  return {
    ready: true,
    compactHintRendered: true,
    downOpenedList: true,
    leftReturnedToMain: true,
    processStayedLive: true,
    pidBefore,
    pidAfter,
    snapshot,
  }
}
