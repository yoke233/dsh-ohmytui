import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatRetryDelay, requestAttemptForTurn, retryActivity } from '../src/retry-display.ts'

describe('requestAttemptForTurn', () => {
  it('counts the initial request plus durable retries for the final step', () => {
    const events = [
      { type: 'turn/start', data: { turn: 4 } },
      { type: 'step/start', data: { turn: 4, step: 0 } },
      ...Array.from({ length: 5 }, (_, index) => ({
        type: 'llm/retry',
        data: { turn: 4, step: 0, retry: index + 1 },
      })),
      { type: 'turn/end', data: { turn: 4 } },
    ]
    assert.equal(requestAttemptForTurn(events, 4), 6)
  })

  it('formats live retry progress from a durable retry event', () => {
    assert.deepEqual(retryActivity({ mode: 'normal', retry: 2, maxRetries: 5, delayMs: 1_000 }), {
      retry: 2,
      maximum: '5',
      delayMs: 1_000,
    })
    assert.equal(formatRetryDelay(500), '0.5s')
    assert.equal(formatRetryDelay(8_000), '8s')
  })

  it('does not count retries from an earlier successful step', () => {
    const events = [
      { type: 'step/start', data: { turn: 7, step: 0 } },
      { type: 'llm/retry', data: { turn: 7, step: 0, retry: 1 } },
      { type: 'step/end', data: { turn: 7, step: 0 } },
      { type: 'step/start', data: { turn: 7, step: 1 } },
      { type: 'turn/end', data: { turn: 7 } },
    ]
    assert.equal(requestAttemptForTurn(events, 7), 1)
  })
})
