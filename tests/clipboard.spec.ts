import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { latestAssistantText, osc52ClipboardSequence } from '../src/clipboard.ts'

describe('clipboard helpers', () => {
  it('finds the latest non-empty assistant response', () => {
    const events = [
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: 'older' }] } } },
      { type: 'user/message', data: {} },
      { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '  最新回复  ' }] } } },
    ] as unknown as SessionEvent[]
    assert.equal(latestAssistantText(events), '最新回复')
  })

  it('encodes UTF-8 text as an OSC 52 clipboard sequence', () => {
    const sequence = osc52ClipboardSequence('复制成功')
    assert.match(sequence, /^\x1b\]52;c;[A-Za-z0-9+/]+=*\x07$/)
    const payload = sequence.slice('\x1b]52;c;'.length, -1)
    assert.equal(Buffer.from(payload, 'base64').toString('utf8'), '复制成功')
  })
})
