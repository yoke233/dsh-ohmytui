import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shouldCancelRunningTurn } from '../src/input.ts'

describe('running turn keyboard input', () => {
  it('maps Escape to cancellation while the composer owns a running turn', () => {
    assert.equal(shouldCancelRunningTurn('\x1b', 'running', true), true)
  })

  it('leaves Escape to the focused surface when idle or outside the composer', () => {
    assert.equal(shouldCancelRunningTurn('\x1b', 'idle', true), false)
    assert.equal(shouldCancelRunningTurn('\x1b', 'running', false), false)
    assert.equal(shouldCancelRunningTurn('x', 'running', true), false)
  })
})
