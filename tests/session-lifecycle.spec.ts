import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionView, hasConversationData, liveChildSubagents, recordConversationPreset } from '../src/session-lifecycle.ts'

function blankSession(idValue: string, agentPreset?: string): Session {
  const id = SessionId(idValue)
  return Session.create(id, undefined, {
    version: SESSION_FORMAT_VERSION,
    id,
    createdAt: 0,
    ...(agentPreset === undefined ? {} : { agentPreset }),
  })
}

describe('session lifecycle', () => {
  it('keeps preset metadata out of a blank conversation check', () => {
    const session = blankSession('blank')
    assert.equal(hasConversationData(session.events), false)

    recordConversationPreset(session, 'standard', undefined)
    assert.equal(session.events.length, 1)
    assert.equal(session.events[0]?.type, 'agent-preset/selected')
    assert.equal(hasConversationData(session.events), false)

    assert.equal(hasConversationData([{ type: 'user/message' } as SessionEvent]), true)
  })

  it('derives session UI state independently from the transcript window', () => {
    const events = [
      {
        type: 'todo/write',
        data: { todos: [{ content: 'old session task', status: 'in_progress' }] },
      },
      {
        type: 'goal/change',
        data: { operation: 'create', goal: { objective: 'old goal', phase: 'active' } },
      },
      {
        type: 'assistant/message',
        data: { usage: { inputTokens: 12, outputTokens: 5 } },
      },
      {
        type: 'assistant/message',
        data: { usage: { inputTokens: 7, outputTokens: 3 } },
      },
      {
        type: 'subagent/descriptor',
        data: { label: 'research', provider: 'task', mode: 'continuable' },
      },
    ] as SessionEvent[]

    assert.deepEqual(foldSessionView(events), {
      todos: [{ content: 'old session task', status: 'in_progress' }],
      goal: { objective: 'old goal', phase: 'active' },
      tokenTotals: { inputTokens: 19, outputTokens: 8 },
      subagents: [{ label: 'research', provider: 'task', mode: 'continuable' }],
    })
    assert.deepEqual(foldSessionView([]), {
      todos: [],
      goal: undefined,
      tokenTotals: { inputTokens: 0, outputTokens: 0 },
      subagents: [],
    })
  })

  it('lists direct live subagents from their own descriptor suffix', () => {
    const parentId = SessionId('parent')
    const firstId = SessionId('first-child')
    const secondId = SessionId('second-child')
    const agents = [
      {
        id: secondId,
        status: 'idle',
        options: { provider: 'task' },
        session: {
          header: { id: secondId, parentSession: parentId, origin: 'subagent', createdAt: 2, seedLength: 1 },
          events: [
            { type: 'subagent/descriptor', data: { label: 'seed-label', provider: 'old', mode: 'one-shot' } },
            { type: 'subagent/descriptor', data: { label: 'review', mode: 'continuable' } },
          ],
        },
      },
      {
        id: firstId,
        status: 'running',
        options: { provider: 'research' },
        session: {
          header: { id: firstId, parentSession: parentId, origin: 'subagent', createdAt: 1, seedLength: 0 },
          events: [{ type: 'subagent/descriptor', data: { label: 'research', mode: 'one-shot' } }],
        },
      },
      {
        id: SessionId('unrelated'),
        status: 'running',
        options: {},
        session: { header: { id: SessionId('unrelated'), createdAt: 0 }, events: [] },
      },
    ]

    assert.deepEqual(liveChildSubagents(agents as never, parentId), [
      { id: 'first-child', label: 'research', provider: 'research', mode: 'one-shot', status: 'running' },
      { id: 'second-child', label: 'review', provider: 'task', mode: 'continuable', status: 'idle' },
    ])
  })

  it('scans only newly appended events when refreshing live subagents', () => {
    const parentId = SessionId('parent')
    const childId = SessionId('busy-child')
    const history = Array.from({ length: 5_000 }, (_, index) => ({
      type: 'session/title',
      data: { title: `event-${index}` },
    })) as SessionEvent[]
    let indexedReads = 0
    const events = new Proxy(history, {
      get(target, property, receiver) {
        if (typeof property === 'string' && /^\d+$/u.test(property)) indexedReads++
        return Reflect.get(target, property, receiver)
      },
    })
    const session = {
      header: { id: childId, parentSession: parentId, origin: 'subagent', createdAt: 1, seedLength: 0 },
      events,
    }
    const agent = {
      id: childId,
      status: 'running',
      options: { provider: 'task' },
      session,
    }

    assert.deepEqual(liveChildSubagents([agent] as never, parentId), [
      { id: 'busy-child', provider: 'task', mode: 'one-shot', status: 'running' },
    ])
    assert.equal(indexedReads, history.length)

    indexedReads = 0
    agent.status = 'idle'
    liveChildSubagents([agent] as never, parentId)
    assert.equal(indexedReads, 0)

    history.push({
      type: 'subagent/descriptor',
      data: { label: 'busy', provider: 'research', mode: 'continuable' },
    } as SessionEvent)
    indexedReads = 0
    assert.deepEqual(liveChildSubagents([agent] as never, parentId), [
      { id: 'busy-child', label: 'busy', provider: 'research', mode: 'continuable', status: 'idle' },
    ])
    assert.equal(indexedReads, 1)
  })

  it('does not append when the creation header already records the preset', () => {
    const session = blankSession('header-preset', 'minimal')
    recordConversationPreset(session, 'minimal', 'minimal')
    assert.equal(session.events.length, 0)
  })

  it('records one latest selection when a blank session changes preset', () => {
    const session = blankSession('switched-preset', 'standard')
    recordConversationPreset(session, 'minimal', 'standard')
    recordConversationPreset(session, 'minimal', 'minimal')
    assert.equal(session.events.length, 1)
    assert.deepEqual(session.events[0]?.data, { agentPreset: 'minimal' })
  })
})
