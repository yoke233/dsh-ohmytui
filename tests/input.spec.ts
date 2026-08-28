import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { restoreComposerFocus, runningTurnKeyAction } from '../src/input.ts'

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

describe('composer focus recovery', () => {
  it('restores a missing focus owner before the same key is dispatched', () => {
    const received: string[] = []
    const editor = { handleInput: (data: string) => received.push(data) }
    let focused: unknown = null
    const ui = {
      getFocusedComponent: () => focused,
      setFocus: (component: unknown) => { focused = component },
    }

    assert.equal(restoreComposerFocus(ui, editor, true), true)
    ;(focused as typeof editor).handleInput('字')

    assert.deepEqual(received, ['字'])
  })

  it('preserves explicit non-composer focus owners', () => {
    const editor = {}
    const focused = { focused: true }
    let focusWrites = 0
    const controller = () => ({
      getFocusedComponent: () => focused,
      setFocus: () => { focusWrites++ },
    })

    assert.equal(restoreComposerFocus(controller(), editor, false), false)
    assert.equal(restoreComposerFocus(controller(), editor, true), false)
    assert.equal(focusWrites, 0)
  })
})
