import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { Session, SessionId, SESSION_FORMAT_VERSION, type SessionEvent } from '@deepseek-ai/dsh-session'
import { foldSessionView, hasConversationData, recordConversationPreset } from '../src/session-lifecycle.ts'

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

    recordConversationPreset(session, 'standard')
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

  it('does not append when the creation header already records the preset', () => {
    const session = blankSession('header-preset', 'minimal')
    recordConversationPreset(session, 'minimal')
    assert.equal(session.events.length, 0)
  })

  it('records one latest selection when a blank session changes preset', () => {
    const session = blankSession('switched-preset', 'standard')
    recordConversationPreset(session, 'minimal')
    recordConversationPreset(session, 'minimal')
    assert.equal(session.events.length, 1)
    assert.deepEqual(session.events[0]?.data, { agentPreset: 'minimal' })
  })
})
