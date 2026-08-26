import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveThemeCommand, type ThemeSelectionState } from '../src/theme-command.ts'

const current: ThemeSelectionState = {
  mode: 'dynamic', dark: 'dark-default', light: 'light-default', selected: 'dark-default',
}
const known = (id: string): boolean => ['dark-default', 'light-default', 'light-github'].includes(id)

describe('resolveThemeCommand', () => {
  it('returns a compact summary without mutating state', () => {
    const result = resolveThemeCommand('', current, known)
    assert.deepEqual(result, { kind: 'summary', state: current })
    assert.notEqual(result.state, current)
  })

  it('resolves selected and scheme-specific updates', () => {
    assert.deepEqual(resolveThemeCommand('light-github', current, known), {
      kind: 'update', changed: 'selected', value: 'light-github',
      state: { ...current, mode: 'selected', selected: 'light-github' },
    })
    assert.deepEqual(resolveThemeCommand('light light-github', current, known), {
      kind: 'update', changed: 'light', value: 'light-github',
      state: { ...current, light: 'light-github', mode: 'dynamic' },
    })
  })

  it('rejects unknown and extra arguments', () => {
    assert.deepEqual(resolveThemeCommand('missing', current, known), {
      kind: 'error', reason: 'theme', value: 'missing',
    })
    assert.deepEqual(resolveThemeCommand('mode selected extra', current, known), {
      kind: 'error', reason: 'mode', value: 'selected',
    })
  })
})
