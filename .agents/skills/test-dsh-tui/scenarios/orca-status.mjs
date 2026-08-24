import { existsSync, rmSync } from 'node:fs'

/**
 * Every OSC 9999 payload the TUI has written to its real stdout so far. Read
 * from the untouched PTY stream: `plainOutput()` exists to strip exactly the
 * OSC sequences under test here.
 */
function statusPayloads(tui) {
  const payloads = []
  const pattern = /\x1b\]9999;(\{.*?\})\x07/g
  for (const match of tui.output.matchAll(pattern)) {
    payloads.push(JSON.parse(match[1]))
  }
  return payloads
}

/** Wait until a payload matching `predicate` appears in the raw PTY stream. */
async function waitForStatus(tui, predicate, label) {
  let found
  await tui.waitFor(() => {
    found = statusPayloads(tui).find(predicate)
    return found !== undefined
  }, 20_000, label)
  return found
}

/**
 * The live TUI reports its agent state to a hosting Orca pane over OSC 9999:
 * an idle boundary at startup, `working` with the prompt and the running tool,
 * `waiting` naming what an approval is about, and `done` with the reply.
 */
export async function run(tui) {
  if (process.env.ORCA_PANE_KEY === undefined || process.env.ORCA_PANE_KEY === '') {
    throw new Error('scenario requires ORCA_PANE_KEY: run it from a terminal inside Orca')
  }
  const packageName = 'dsh-live-orca-status-fixture'
  const outcomeFile = tui.marker('orca-status-outcome')
  rmSync(outcomeFile, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-orca-status-fixture',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: orca-status-fixture',
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
      'class OrcaStatusAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream() {',
      '    requestCount += 1',
      '    if (requestCount === 1) {',
      "      const call = { type: 'tool-call', id: 'orca-status-call-1', name: 'orca_probe', arguments: '{\"target\":\"ORCA_TOOL_TARGET\"}' }",
      "      yield { type: 'block-start', index: 0, blockType: 'tool-call' }",
      "      yield { type: 'block-end', index: 0, block: call }",
      "      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "      yield { type: 'finish', reason: { kind: 'tool-calls' } }",
      '      return',
      '    }',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'ORCA_STATUS_FLOW_DONE' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'ORCA_STATUS_FLOW_DONE' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  ctx.llm.registerAdapter(['orca-status-fixture'], new OrcaStatusAdapter())",
      '  ctx.tools.register(defineTool({',
      "    name: 'orca_probe',",
      "    description: 'Request one live approval decision.',",
      "    parameters: { target: { type: 'string', required: true } },",
      '    output: {',
      "      schema: { type: 'object', additionalProperties: false, properties: { outcome: { type: 'string', required: true } } },",
      "      render: (_args, value) => [{ type: 'text', text: value.outcome }],",
      '    },',
      '    async execute(_args, exec) {',
      "      if (!exec.agent) throw new Error('orca probe has no agent')",
      '      const outcome = await ctx.approval.request({',
      '        agent: exec.agent,',
      "        toolName: 'orca_probe',",
      '        callId: exec.callId,',
      "        reason: 'ORCA_STATUS_REASON',",
      '        signal: exec.signal,',
      '      })',
      "      writeFileSync(join(process.env.DSH_HOME, 'orca-status-outcome'), outcome)",
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

  const boundary = await waitForStatus(
    tui,
    payload => payload.state === 'done' && payload.sessionBoundary === true,
    'startup session boundary',
  )
  if (boundary.agentType !== 'dsh') throw new Error(`boundary reported agentType ${boundary.agentType}`)

  tui.submit('START_ORCA_STATUS')
  const working = await waitForStatus(
    tui,
    payload => payload.state === 'working' && payload.prompt === 'START_ORCA_STATUS',
    'working with the submitted prompt',
  )

  const runningTool = await waitForStatus(
    tui,
    payload => payload.state === 'working' && payload.toolName === 'Orca Probe',
    'working with the running tool',
  )
  if (runningTool.toolInput !== 'ORCA_TOOL_TARGET') {
    throw new Error(`running tool reported toolInput ${runningTool.toolInput}`)
  }

  await tui.waitForScreen(/需要授权|Authorization required/, { timeoutMs: 15_000, label: 'approval popup' })
  const waiting = await waitForStatus(
    tui,
    payload => payload.state === 'waiting',
    'waiting on the approval',
  )
  if (waiting.toolName !== 'Orca Probe' || waiting.toolInput !== 'ORCA_TOOL_TARGET') {
    throw new Error(`bare waiting row: toolName=${waiting.toolName} toolInput=${waiting.toolInput}`)
  }
  if (statusPayloads(tui).some(payload => payload.state === 'blocked')) {
    throw new Error('reported blocked instead of waiting')
  }
  const popup = await tui.snapshot('orca-status-approval')

  tui.key('\x1b')
  await tui.waitFor(() => existsSync(outcomeFile), 15_000, 'approval outcome marker')
  const done = await waitForStatus(
    tui,
    payload => payload.state === 'done' && payload.lastAssistantMessage === 'ORCA_STATUS_FLOW_DONE',
    'done with the assistant preview',
  )
  if (done.sessionBoundary !== undefined) throw new Error('a finished turn was reported as a session boundary')
  if (done.interrupted !== undefined) throw new Error('a completed turn was reported as interrupted')

  const states = statusPayloads(tui).map(payload => payload.state)
  return {
    sessionBoundaryReported: true,
    promptReported: working.prompt,
    runningToolReported: `${runningTool.toolName} · ${runningTool.toolInput}`,
    approvalReportedAsWaiting: true,
    doneReported: done.lastAssistantMessage,
    modelReported: done.model,
    stateSequence: states,
    screenshot: popup,
  }
}
