import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  ORCA_AGENT_TYPE,
  ORCA_PANE_ENV,
  ORCA_QUESTION_TOOL,
  createOrcaStatusReporter,
  isOrcaPane,
  orcaInteractivePrompt,
  orcaStatusSequence,
  type OrcaStatusPayload,
  type OrcaStatusReporter,
} from '../src/orca-status.ts'

const ORCA_ENV: NodeJS.ProcessEnv = { [ORCA_PANE_ENV]: 'pane-42' }

/** The JSON body of one wire sequence. */
function body(line: string): Record<string, unknown> {
  assert.ok(line.startsWith('\x1b]9999;'), `not an OSC 9999 sequence: ${JSON.stringify(line)}`)
  assert.ok(line.endsWith('\x07'), `unterminated sequence: ${JSON.stringify(line)}`)
  return JSON.parse(line.slice('\x1b]9999;'.length, -1)) as Record<string, unknown>
}

/** A live reporter plus the sequences it wrote. */
function harness(model?: () => string | undefined): {
  reporter: OrcaStatusReporter
  lines: string[]
  bodies: () => Record<string, unknown>[]
} {
  const lines: string[] = []
  const reporter = createOrcaStatusReporter({
    write: (data) => { lines.push(data) },
    env: ORCA_ENV,
    model,
  })
  return { reporter, lines, bodies: () => lines.map(body) }
}

describe('isOrcaPane', () => {
  it('detects the pane key Orca injects', () => {
    assert.equal(isOrcaPane(ORCA_ENV), true)
  })

  it('rejects a missing or blank pane key', () => {
    assert.equal(isOrcaPane({}), false)
    assert.equal(isOrcaPane({ [ORCA_PANE_ENV]: '' }), false)
    assert.equal(isOrcaPane({ [ORCA_PANE_ENV]: '   ' }), false)
  })

  it('ignores the other Orca variables on their own', () => {
    assert.equal(isOrcaPane({ ORCA_TAB_ID: 'tab-1', ORCA_AGENT_HOOK_PORT: '5100' }), false)
  })
})

describe('orcaStatusSequence', () => {
  it('frames the payload as ESC ] 9999 ; JSON BEL', () => {
    const line = orcaStatusSequence({ state: 'working' })
    assert.equal(line, `\x1b]9999;{"state":"working","agentType":"dsh"}\x07`)
  })

  it('always names the agent type Orca renders as DSH', () => {
    assert.equal(body(orcaStatusSequence({ state: 'done' })).agentType, ORCA_AGENT_TYPE)
    assert.equal(body(orcaStatusSequence({ state: 'done' }, 'other')).agentType, 'other')
  })

  it('carries every optional field it is given', () => {
    const payload: OrcaStatusPayload = {
      state: 'working',
      prompt: 'ship it',
      toolName: 'Edit',
      toolInput: 'src/foo.ts',
      lastAssistantMessage: 'done thinking',
      model: 'deepseek-chat',
    }
    assert.deepEqual(body(orcaStatusSequence(payload)), {
      state: 'working',
      agentType: 'dsh',
      prompt: 'ship it',
      toolName: 'Edit',
      toolInput: 'src/foo.ts',
      lastAssistantMessage: 'done thinking',
      model: 'deepseek-chat',
    })
  })

  it('omits fields that are empty or whitespace only', () => {
    const line = orcaStatusSequence({ state: 'working', prompt: '   ', toolName: '', model: '\n' })
    assert.deepEqual(body(line), { state: 'working', agentType: 'dsh' })
  })

  it('escapes quotes, backslashes and newlines into valid JSON', () => {
    const message = 'said "hi"\\ then\nstopped'
    const parsed = body(orcaStatusSequence({ state: 'done', lastAssistantMessage: message }))
    assert.equal(parsed.lastAssistantMessage, message)
  })

  it('keeps non-ASCII text intact', () => {
    const parsed = body(orcaStatusSequence({ state: 'working', prompt: '把状态发给 Orca 🐋' }))
    assert.equal(parsed.prompt, '把状态发给 Orca 🐋')
  })

  it('collapses a multiline prompt onto the activity row', () => {
    const parsed = body(orcaStatusSequence({ state: 'working', prompt: 'first\r\nsecond' }))
    assert.equal(parsed.prompt, 'first second')
  })

  it('keeps line breaks in the assistant preview', () => {
    const parsed = body(orcaStatusSequence({ state: 'done', lastAssistantMessage: 'first\r\nsecond' }))
    assert.equal(parsed.lastAssistantMessage, 'first\nsecond')
  })

  it('strips terminal controls so pasted text cannot forge a status line', () => {
    const injection = 'hi \x1b]9999;{"state":"done"}\x07 there'
    const parsed = body(orcaStatusSequence({ state: 'working', prompt: injection }))
    assert.equal(parsed.prompt, 'hi  there')
  })

  it('clips each field to the limit Orca ingests', () => {
    const parsed = body(orcaStatusSequence({
      state: 'working',
      prompt: 'p'.repeat(2_000),
      toolName: 't'.repeat(100),
      toolInput: 'i'.repeat(500),
      lastAssistantMessage: 'm'.repeat(9_000),
      model: 'x'.repeat(200),
    }))
    assert.equal((parsed.prompt as string).length, 1_000)
    assert.equal((parsed.toolName as string).length, 60)
    assert.equal((parsed.toolInput as string).length, 160)
    assert.equal((parsed.lastAssistantMessage as string).length, 8_000)
    assert.equal((parsed.model as string).length, 120)
  })

  it('clips by code point rather than splitting a surrogate pair', () => {
    const parsed = body(orcaStatusSequence({ state: 'working', toolName: '🐋'.repeat(80) }))
    assert.equal(parsed.toolName, '🐋'.repeat(60))
  })

  it('reports interrupted and sessionBoundary only on done', () => {
    const done = body(orcaStatusSequence({ state: 'done', interrupted: true, sessionBoundary: true }))
    assert.equal(done.interrupted, true)
    assert.equal(done.sessionBoundary, true)
    const working = body(orcaStatusSequence({ state: 'working', interrupted: true, sessionBoundary: true }))
    assert.equal(working.interrupted, undefined)
    assert.equal(working.sessionBoundary, undefined)
  })

  it('omits the flags a completed turn does not set', () => {
    assert.deepEqual(body(orcaStatusSequence({ state: 'done', interrupted: false })), {
      state: 'done',
      agentType: 'dsh',
    })
  })

  it('sends interactivePrompt only while waiting', () => {
    const card = '{"questions":[{"question":"which?"}]}'
    assert.equal(body(orcaStatusSequence({ state: 'waiting', interactivePrompt: card })).interactivePrompt, card)
    assert.equal(body(orcaStatusSequence({ state: 'working', interactivePrompt: card })).interactivePrompt, undefined)
    assert.equal(body(orcaStatusSequence({ state: 'done', interactivePrompt: card })).interactivePrompt, undefined)
  })

  it('drops an oversized question card rather than truncating its JSON', () => {
    const card = `{"questions":[{"question":"${'q'.repeat(16_100)}"}]}`
    assert.equal(body(orcaStatusSequence({ state: 'waiting', interactivePrompt: card })).interactivePrompt, undefined)
  })
})

describe('orcaInteractivePrompt', () => {
  it('encodes the AskUserQuestion shape as a JSON string', () => {
    const encoded = orcaInteractivePrompt([{
      question: 'Which cache?',
      header: 'Cache',
      multiSelect: true,
      options: [{ label: 'LRU', description: 'in memory' }, { label: 'Disk' }],
    }])
    assert.equal(typeof encoded, 'string')
    assert.deepEqual(JSON.parse(encoded!), {
      questions: [{
        question: 'Which cache?',
        header: 'Cache',
        multiSelect: true,
        options: [{ label: 'LRU', description: 'in memory' }, { label: 'Disk' }],
      }],
    })
  })

  it('always states multiSelect explicitly, since Orca only accepts true', () => {
    const encoded = orcaInteractivePrompt([{ question: 'Pick one' }])
    assert.equal(JSON.parse(encoded!).questions[0].multiSelect, false)
  })

  it('keeps a question that has options but no text', () => {
    const encoded = orcaInteractivePrompt([{ question: '', options: [{ label: 'yes' }] }])
    assert.deepEqual(JSON.parse(encoded!).questions[0], {
      question: '',
      multiSelect: false,
      options: [{ label: 'yes' }],
    })
  })

  it('drops a question carrying neither text nor options', () => {
    assert.equal(orcaInteractivePrompt([{ question: '   ' }]), undefined)
    assert.equal(orcaInteractivePrompt([]), undefined)
  })

  it('drops blank option labels and empty descriptions', () => {
    const encoded = orcaInteractivePrompt([{
      question: 'Pick',
      options: [{ label: 'keep', description: '  ' }, { label: '  ' }],
    }])
    assert.deepEqual(JSON.parse(encoded!).questions[0].options, [{ label: 'keep' }])
  })

  it('strips terminal controls from question text and labels', () => {
    const encoded = orcaInteractivePrompt([{
      question: 'a\x1b[31mb',
      options: [{ label: 'x\ny' }],
    }])
    const parsed = JSON.parse(encoded!).questions[0]
    assert.equal(parsed.question, 'ab')
    assert.equal(parsed.options[0].label, 'x y')
  })

  it('drops a card past the size cap instead of corrupting its JSON', () => {
    assert.equal(orcaInteractivePrompt([{ question: 'q'.repeat(16_100) }]), undefined)
  })
})

describe('createOrcaStatusReporter outside Orca', () => {
  it('writes nothing without a pane key', () => {
    const lines: string[] = []
    const reporter = createOrcaStatusReporter({ write: (data) => { lines.push(data) }, env: {} })
    assert.equal(reporter.active, false)
    reporter.report({ state: 'working', prompt: 'hello' })
    reporter.signal({ kind: 'boundary' })
    reporter.signal({ kind: 'prompt', text: 'hello' })
    reporter.signal({ kind: 'running', running: false })
    assert.deepEqual(lines, [])
  })
})

describe('createOrcaStatusReporter reporting', () => {
  it('reads the model at report time', () => {
    let model: string | undefined = 'first-model'
    const { reporter, bodies } = harness(() => model)
    reporter.report({ state: 'working', prompt: 'a' })
    model = 'second-model'
    reporter.report({ state: 'working', prompt: 'b' })
    assert.deepEqual(bodies().map(entry => entry.model), ['first-model', 'second-model'])
  })

  it('skips a repeat of the sequence it just wrote', () => {
    const { reporter, lines } = harness()
    reporter.report({ state: 'working', prompt: 'same' })
    reporter.report({ state: 'working', prompt: 'same' })
    assert.equal(lines.length, 1)
    reporter.report({ state: 'done' })
    assert.equal(lines.length, 2)
  })

  it('never lets a failing write escape', () => {
    const reporter = createOrcaStatusReporter({
      write: () => { throw new Error('EPIPE') },
      env: ORCA_ENV,
    })
    assert.doesNotThrow(() => { reporter.report({ state: 'done' }) })
  })
})

describe('createOrcaStatusReporter state machine', () => {
  it('announces an idle session boundary', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'boundary' })
    assert.deepEqual(bodies(), [{ state: 'done', agentType: 'dsh', sessionBoundary: true }])
  })

  it('walks a whole turn from prompt to done', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'boundary' })
    reporter.signal({ kind: 'prompt', text: 'fix the build' })
    reporter.signal({ kind: 'running', running: true })
    reporter.signal({ kind: 'assistant', text: 'looking at it' })
    reporter.signal({ kind: 'tool', name: 'Edit', input: 'src/foo.ts' })
    reporter.signal({ kind: 'assistant', text: 'fixed' })
    reporter.signal({ kind: 'turn-end', aborted: false })
    reporter.signal({ kind: 'running', running: false })
    assert.deepEqual(bodies(), [
      { state: 'done', agentType: 'dsh', sessionBoundary: true },
      { state: 'working', agentType: 'dsh', prompt: 'fix the build' },
      { state: 'working', agentType: 'dsh', prompt: 'fix the build', toolName: 'Edit', toolInput: 'src/foo.ts' },
      { state: 'working', agentType: 'dsh', prompt: 'fix the build' },
      { state: 'done', agentType: 'dsh', lastAssistantMessage: 'fixed' },
    ])
  })

  it('keeps the prompt on the activity row across the whole turn', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'prompt', text: 'fix the build' })
    reporter.signal({ kind: 'tool', name: 'Bash', input: 'pnpm test' })
    assert.equal(bodies()[1]?.prompt, 'fix the build')
  })

  it('marks a cancelled turn as interrupted, once', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'prompt', text: 'go' })
    reporter.signal({ kind: 'turn-end', aborted: true })
    reporter.signal({ kind: 'running', running: false })
    reporter.signal({ kind: 'prompt', text: 'go again' })
    reporter.signal({ kind: 'turn-end', aborted: false })
    reporter.signal({ kind: 'running', running: false })
    const states = bodies().filter(entry => entry.state === 'done')
    assert.deepEqual(states, [
      { state: 'done', agentType: 'dsh', interrupted: true },
      { state: 'done', agentType: 'dsh' },
    ])
  })

  it('says what an approval is approving, then resumes working', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'prompt', text: 'clean the tree' })
    reporter.signal({ kind: 'running', running: true })
    reporter.signal({ kind: 'tool', name: 'Bash', input: 'rm -rf build' })
    reporter.signal({ kind: 'approval', toolName: 'Bash', toolInput: 'rm -rf build' })
    reporter.signal({ kind: 'attention-cleared' })
    assert.deepEqual(bodies().slice(-2), [
      {
        state: 'waiting',
        agentType: 'dsh',
        prompt: 'clean the tree',
        toolName: 'Bash',
        toolInput: 'rm -rf build',
      },
      { state: 'working', agentType: 'dsh', prompt: 'clean the tree', toolName: 'Bash', toolInput: 'rm -rf build' },
    ])
  })

  it('never reports blocked for an approval', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'approval', toolName: 'Edit', toolInput: 'src/foo.ts' })
    assert.equal(bodies().at(-1)?.state, 'waiting')
  })

  it('carries an open question as an interactivePrompt card', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'running', running: true })
    reporter.signal({
      kind: 'questions',
      questions: [{
        question: '用哪种方式实现缓存？',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: '内存 LRU', description: '简单，进程重启即失效' },
          { label: '磁盘持久化' },
        ],
      }],
    })
    const waiting = bodies().at(-1)!
    assert.equal(waiting.state, 'waiting')
    assert.equal(waiting.toolName, ORCA_QUESTION_TOOL)
    assert.deepEqual(JSON.parse(waiting.interactivePrompt as string), {
      questions: [{
        question: '用哪种方式实现缓存？',
        header: 'Cache',
        multiSelect: false,
        options: [
          { label: '内存 LRU', description: '简单，进程重启即失效' },
          { label: '磁盘持久化' },
        ],
      }],
    })
  })

  it('clears the question card on the next report', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'running', running: true })
    reporter.signal({ kind: 'questions', questions: [{ question: 'which?', options: [{ label: 'a' }] }] })
    reporter.signal({ kind: 'attention-cleared' })
    assert.equal(bodies().at(-1)?.interactivePrompt, undefined)
    assert.equal(bodies().at(-1)?.state, 'working')
  })

  it('degrades to a plain waiting row when no question survives', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'questions', questions: [{ question: '  ' }] })
    assert.deepEqual(bodies().at(-1), {
      state: 'waiting',
      agentType: 'dsh',
      toolName: ORCA_QUESTION_TOOL,
    })
  })

  it('ignores a cleared modal that was never opened', () => {
    const { reporter, lines } = harness()
    reporter.signal({ kind: 'running', running: true })
    const before = lines.length
    reporter.signal({ kind: 'attention-cleared' })
    assert.equal(lines.length, before)
  })

  it('does not re-report working when a modal closes on an idle agent', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'approval', toolName: 'Edit', toolInput: 'src/foo.ts' })
    reporter.signal({ kind: 'attention-cleared' })
    assert.deepEqual(bodies(), [{
      state: 'waiting',
      agentType: 'dsh',
      toolName: 'Edit',
      toolInput: 'src/foo.ts',
    }])
  })

  it('starts working for a turn opened outside the editor', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'boundary' })
    reporter.signal({ kind: 'running', running: true })
    assert.deepEqual(bodies().at(-1), { state: 'working', agentType: 'dsh' })
  })

  it('forgets the previous turn when the foreground session changes', () => {
    const { reporter, bodies } = harness()
    reporter.signal({ kind: 'prompt', text: 'old work' })
    reporter.signal({ kind: 'assistant', text: 'old answer' })
    reporter.signal({ kind: 'reset' })
    reporter.signal({ kind: 'boundary' })
    reporter.signal({ kind: 'running', running: false })
    assert.deepEqual(bodies().at(-1), { state: 'done', agentType: 'dsh' })
  })

  it('re-announces a state the previous session already reported', () => {
    const { reporter, lines } = harness()
    reporter.signal({ kind: 'boundary' })
    reporter.signal({ kind: 'reset' })
    reporter.signal({ kind: 'boundary' })
    assert.equal(lines.length, 2)
  })
})
