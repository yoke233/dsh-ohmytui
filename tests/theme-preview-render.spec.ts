import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { redrawThemePreview } from '../src/theme-preview-render.ts'

describe('redrawThemePreview', () => {
  it('opens synchronized output before clearing and renders immediately', () => {
    const operations: string[] = []
    redrawThemePreview(
      { write: data => { operations.push(`write:${data}`) } },
      { renderNow: force => { operations.push(`render:${String(force)}`) } },
    )

    assert.deepEqual(operations, [
      'write:\u001b[?2026h\u001b[2J\u001b[H',
      'render:true',
    ])
  })
})
