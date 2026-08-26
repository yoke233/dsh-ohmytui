import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { runningTurnKeyAction } from '../src/input.ts'

describe('running turn keyboard input', () => {
  it('maps Escape and Ctrl+C on an empty draft to cancellation', () => {
    assert.equal(runningTurnKeyAction('\x1b', 'running', true, ''), 'cancel')
    assert.equal(runningTurnKeyAction('\x03', 'running', true, ''), 'cancel')
  })

  it('clears a non-empty running draft on Ctrl+C without cancelling', () => {
    assert.equal(runningTurnKeyAction('\x03', 'running', true, 'keep running'), 'clear-draft')
    assert.equal(runningTurnKeyAction('\x03', 'running', true, ' '), 'clear-draft')
    assert.equal(runningTurnKeyAction('\x1b', 'running', true, 'draft'), 'cancel')
  })

  it('leaves keys to the focused surface when idle or outside the composer', () => {
    assert.equal(runningTurnKeyAction('\x1b', 'idle', true, ''), undefined)
    assert.equal(runningTurnKeyAction('\x1b', 'running', false, ''), undefined)
    assert.equal(runningTurnKeyAction('x', 'running', true, ''), undefined)
  })
})
