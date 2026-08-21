import { existsSync, readFileSync, rmSync } from 'node:fs'

/** A model-requested tool asks for approval and the live TUI rejects it via Escape. */
export async function run(tui) {
  const packageName = 'dsh-live-approval-fixture'
  const outcomeFile = tui.marker('approval-outcome')
  rmSync(outcomeFile, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-approval-fixture',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: approval-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "import { defineTool } from '@deepseek-ai/dsh-tools'",
      "export const inject = ['llm', 'tools', 'approval']",
      'let requestCount = 0',
      'class ApprovalAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream() {',
      '    requestCount += 1',
      '    if (requestCount === 1) {',
      "      const call = { type: 'tool-call', id: 'approval-call-1', name: 'approval_probe', arguments: '{}' }",
      "      yield { type: 'block-start', index: 0, blockType: 'tool-call' }",
      "      yield { type: 'block-end', index: 0, block: call }",
      "      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "      yield { type: 'finish', reason: { kind: 'tool-calls' } }",
      '      return',
      '    }',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'APPROVAL_FLOW_DONE' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'APPROVAL_FLOW_DONE' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['approval-fixture'], new ApprovalAdapter())",
      '  ctx.tools.register(defineTool({',
      "    name: 'approval_probe',",
      "    description: 'Request one live approval decision.',",
      '    parameters: {},',
      '    output: {',
      "      schema: { type: 'object', additionalProperties: false, properties: { outcome: { type: 'string', required: true } } },",
      "      render: (_args, value) => [{ type: 'text', text: value.outcome }],",
      '    },',
      '    async execute(_args, exec) {',
      "      if (!exec.agent) throw new Error('approval probe has no agent')",
      '      const outcome = await ctx.approval.request({',
      '        agent: exec.agent,',
      "        toolName: 'approval_probe',",
      '        callId: exec.callId,',
      "        reason: 'LIVE_APPROVAL_REASON',",
      '        signal: exec.signal,',
      '      })',
      "      writeFileSync(join(process.env.DSH_HOME, 'approval-outcome'), outcome)",
      '      return { outcome }',
      '    },',
      '  }))',
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.start()
  await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000, label: 'welcome screen' })
  const pidBefore = tui.pid()

  tui.submit('START_APPROVAL_FLOW')
  await tui.waitForScreen(/需要授权|Authorization required/, { timeoutMs: 15_000, label: 'approval popup' })
  const popupScreen = await tui.screenText()
  if (!popupScreen.includes('approval_probe')) throw new Error('approval popup omitted the tool name')
  if (!popupScreen.includes('LIVE_APPROVAL_REASON')) throw new Error('approval popup omitted the reason')
  const popup = await tui.snapshot('approval-popup')

  tui.key('\x1b')
  await tui.waitFor(() => existsSync(outcomeFile), 15_000, 'approval outcome marker')
  const outcome = readFileSync(outcomeFile, 'utf8')
  if (outcome !== 'rejected') throw new Error(`Escape returned ${outcome} instead of rejected`)
  await tui.waitForOutput('APPROVAL_FLOW_DONE', { timeoutMs: 15_000, label: 'post-approval model response' })

  const pidAfter = tui.pid()
  if (pidBefore !== pidAfter) throw new Error(`DSH PID changed from ${pidBefore} to ${pidAfter}`)

  return {
    popupVisible: true,
    toolNameVisible: true,
    reasonVisible: true,
    escapeRejected: true,
    processStayedLive: true,
    outcome,
    pidBefore,
    pidAfter,
    screenshot: popup,
  }
}
