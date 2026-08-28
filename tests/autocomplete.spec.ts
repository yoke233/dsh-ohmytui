import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from '@earendil-works/pi-tui'
import {
  SkillAwareAutocompleteProvider,
  observeAutocompleteSelection,
  parseSkillInvocation,
  syncSkillCommands,
} from '../src/autocomplete.ts'
import { completedThemeCandidate, isThemeAutocompleteContext } from '../src/theme-command.ts'

function innerStub(suggestions: AutocompleteSuggestions | null): AutocompleteProvider {
  return {
    async getSuggestions() {
      return suggestions
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      const currentLine = lines[cursorLine] ?? ''
      const before = currentLine.slice(0, cursorCol - prefix.length)
      const after = currentLine.slice(cursorCol)
      const newLine = `${before}/${item.value} ${after}`
      const newLines = [...lines]
      newLines[cursorLine] = newLine
      return { lines: newLines, cursorLine, cursorCol: before.length + item.value.length + 2 }
    },
  }
}

describe('SkillAwareAutocompleteProvider', () => {
  it('completes skill:<name> without inserting a trailing space', () => {
    const provider = new SkillAwareAutocompleteProvider(innerStub(null))
    const skill: AutocompleteItem = { value: 'skill:git-commit', label: 'skill:git-commit — Git 提交助手' }

    const applied = provider.applyCompletion(['/com'], 0, 4, skill, '/com')
    assert.equal(applied.lines[0], '/skill:git-commit')
    assert.equal(applied.cursorCol, '/skill:git-commit'.length)
  })

  it('delegates suggestions to the inner provider', async () => {
    const inner = innerStub({ items: [{ value: 'skill:git-commit', label: 'skill:git-commit' }], prefix: '/com' })
    const provider = new SkillAwareAutocompleteProvider(inner)
    const suggestions = await provider.getSuggestions(['/com'], 0, 4, {} as never)
    assert.ok(suggestions)
    assert.equal(suggestions!.items[0]!.value, 'skill:git-commit')
  })

  it('hides an exact skill suggestion after it has been completed', async () => {
    const inner = innerStub({
      items: [{ value: 'skill:distill', label: 'skill:distill [请求]' }],
      prefix: '/skill:distill',
    })
    const provider = new SkillAwareAutocompleteProvider(inner)

    const suggestions = await provider.getSuggestions(
      ['/skill:distill'],
      0,
      '/skill:distill'.length,
      {} as never,
    )

    assert.equal(suggestions, null)
  })
})

describe('skill slash commands', () => {
  it('separates a trailing request from the skill name', () => {
    assert.deepEqual(
      parseSkillInvocation('/skill:beautify-github-readme 重写readme'),
      { name: 'beautify-github-readme', request: '重写readme' },
    )
    assert.deepEqual(
      parseSkillInvocation('/skill:beautify-github-readme'),
      { name: 'beautify-github-readme', request: '' },
    )
  })

  it('adds user-invocable skills to the slash list with their descriptions', () => {
    const commands = [{ name: 'help', description: 'Help' }]
    syncSkillCommands(commands, [
      {
        name: 'beautify-github-readme',
        description: 'Beautify a GitHub README',
        invocation: { userInvocable: true },
      },
      {
        name: 'internal-only',
        description: 'Hidden',
        invocation: { userInvocable: false },
      },
    ])

    assert.deepEqual(commands, [
      { name: 'help', description: 'Help' },
      {
        name: 'skill:beautify-github-readme',
        description: 'Beautify a GitHub README',
      },
    ])
  })

  it('replaces stale skill entries when the catalog refreshes', () => {
    const commands = [
      { name: 'help', description: 'Help' },
      { name: 'skill:old', description: 'Old' },
    ]
    syncSkillCommands(commands, [{
      name: 'new',
      description: 'New',
      invocation: { userInvocable: true },
    }])

    assert.deepEqual(commands.map(command => command.name), ['help', 'skill:new'])
  })
})

describe('theme autocomplete preview', () => {
  it('recognizes direct and scheme-specific theme selection contexts', () => {
    assert.equal(isThemeAutocompleteContext('/theme light'), true)
    assert.equal(isThemeAutocompleteContext('/theme light '), true)
    assert.equal(isThemeAutocompleteContext('/theme light light-github'), true)
    assert.equal(isThemeAutocompleteContext('/theme mode dynamic'), false)
    assert.equal(isThemeAutocompleteContext('/model light-github'), false)
    assert.equal(completedThemeCandidate('/theme light-github '), 'light-github')
    assert.equal(completedThemeCandidate('/theme light light-github'), 'light-github')
    assert.equal(completedThemeCandidate('/theme mode dynamic'), undefined)
  })

  it('forwards initial and navigated selections and reports closing', () => {
    const first = { value: 'light-forest', label: 'Light Forest' }
    const second = { value: 'light-github', label: 'Light Github' }
    let text = '/theme light'
    let selected = first
    let selectionListener: ((item: AutocompleteItem) => void) | undefined
    let closes = 0
    const editor = {
      getText: () => text,
      createAutocompleteList: () => ({
        get onSelectionChange() { return selectionListener },
        set onSelectionChange(listener) { selectionListener = listener },
        getSelectedItem: () => selected,
      }),
      cancelAutocomplete: () => { closes += 1 },
    }
    const seen: string[] = []
    const dispose = observeAutocompleteSelection(editor, {
      onSelection: (value, item) => seen.push(
        value + ':' + item.value,
      ),
      onClose: () => { closes += 10 },
    })

    editor.createAutocompleteList('', [first, second])
    selected = second
    selectionListener?.(second)
    text = '/theme light light-github'
    editor.cancelAutocomplete()

    assert.deepEqual(seen, [
      '/theme light:light-forest',
      '/theme light:light-github',
    ])
    assert.equal(closes, 11)
    dispose()
  })
})
