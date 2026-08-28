import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CombinedAutocompleteProvider, visibleWidth } from '@earendil-works/pi-tui'
import { PromptEditor } from '../src/components/prompt-editor.ts'

const identity = (text: string): string => text

function createEditor(): PromptEditor {
  return new PromptEditor({
    terminal: { rows: 24 },
    requestRender: () => undefined,
  } as never, {
    borderColor: identity,
    selectList: {
      selectedPrefix: identity,
      selectedText: identity,
      description: identity,
      scrollInfo: identity,
      noMatch: identity,
    },
  }, { paddingX: 1 })
}

describe('PromptEditor', () => {
  it('renders the prompt without pi-tui horizontal frames', () => {
    const editor = createEditor()
    editor.setPrompt({ first: '❯ ', continuation: '  ' })
    editor.setText('hello')

    const lines = editor.render(20)

    assert.equal(lines.length, 1)
    assert.match(lines[0]!, /^❯  hello/)
    assert.equal(visibleWidth(lines[0]!), 20)
    assert.ok(lines.every(line => !line.includes('─')))
  })

  it('uses an aligned continuation prompt for wrapped input', () => {
    const editor = createEditor()
    editor.setPrompt({ first: '> ', continuation: '  ' })
    editor.setText('one two three four')

    const lines = editor.render(10)

    assert.ok(lines.length > 1)
    assert.ok(lines[0]!.startsWith('> '))
    assert.ok(lines.slice(1).every(line => line.startsWith('  ')))
    assert.ok(lines.every(line => visibleWidth(line) === 10))
  })

  it('rejects prompts whose visible widths differ', () => {
    const editor = createEditor()
    assert.throws(
      () => editor.setPrompt({ first: '❯ ', continuation: ' ' }),
      /equal visible widths/,
    )
  })

  it('hides the fake input cursor while task navigation has focus', () => {
    const editor = createEditor()
    editor.setText('draft')
    assert.ok(editor.render(20).some(row => row.includes('\x1b[7m')))

    editor.setCursorVisible(false)

    assert.ok(editor.render(20).every(row => !row.includes('\x1b[7m')))
    assert.equal(editor.getText(), 'draft')
  })

  it('places the cursor at the end of recalled history', () => {
    const editor = createEditor()
    editor.addToHistory('/help')

    editor.handleInput('\x1b[A')

    assert.equal(editor.getText(), '/help')
    assert.deepEqual(editor.getCursor(), { line: 0, col: '/help'.length })
  })

  it('submits an unchanged exact slash-command argument with one Enter', async () => {
    const editor = createEditor()
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([{
      name: 'mode',
      description: '切换模式',
      argumentHint: '<standard|minimal>',
      getArgumentCompletions: () => [
        { value: 'standard', label: 'standard — 标准' },
        { value: 'minimal', label: 'minimal — 极简' },
      ],
    }], 'D:/work'))
    let submitted: string | undefined
    editor.onSubmit = (text): void => { submitted = text }
    for (const character of '/mode minimal') editor.handleInput(character)
    await new Promise<void>(resolve => setImmediate(resolve))

    editor.handleInput('\r')

    assert.equal(submitted, '/mode minimal')
  })

  it('opens argument suggestions after Tab completes a slash command', async () => {
    const editor = createEditor()
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([{
      name: 'permission',
      description: '切换权限',
      argumentHint: '<read-only|workspace-write|full-access>',
      getArgumentCompletions: () => [
        { value: 'read-only', label: 'read-only — 只读' },
        { value: 'workspace-write', label: 'workspace-write — 工作区写入' },
        { value: 'full-access', label: 'full-access — 完全访问' },
      ],
    }], 'D:/work'))
    for (const character of '/per') editor.handleInput(character)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(editor.isShowingAutocomplete(), true)

    editor.handleInput('\t')
    assert.equal(editor.getText(), '/permission ')
    await new Promise<void>(resolve => setImmediate(resolve))

    assert.equal(editor.isShowingAutocomplete(), true)
    assert.ok(editor.render(80).some(line => line.includes('read-only — 只读')))
  })

  it('closes autocomplete when Ctrl+U clears the command line', async () => {
    const editor = createEditor()
    editor.setAutocompleteProvider(new CombinedAutocompleteProvider([{
      name: 'theme',
      description: '切换主题',
      getArgumentCompletions: () => [
        { value: 'light', label: 'light — 浅色主题' },
        { value: 'dark', label: 'dark — 深色主题' },
      ],
    }], 'D:/work'))
    for (const character of '/theme light') editor.handleInput(character)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(editor.isShowingAutocomplete(), true)

    editor.handleInput('\x15')

    assert.equal(editor.getText(), '')
    assert.equal(editor.isShowingAutocomplete(), false)

    for (const character of '/theme light') editor.handleInput(character)
    await new Promise<void>(resolve => setImmediate(resolve))
    assert.equal(editor.isShowingAutocomplete(), true)
    editor.handleInput('\x17')
    assert.equal(editor.getText(), '/theme ')
    assert.equal(editor.isShowingAutocomplete(), false)
  })
})
