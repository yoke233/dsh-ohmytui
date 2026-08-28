import {
  Editor,
  matchesKey,
  truncateToWidth,
  visibleWidth,
  type EditorOptions,
  type EditorTheme,
  type TUI,
} from '@earendil-works/pi-tui'

export interface EditorPrompt {
  first: string
  continuation: string
}

interface AutocompleteRefreshEditor {
  tryTriggerAutocomplete(explicitTab?: boolean): void
}

const ansiSequence = /\x1B\[[0-?]*[ -/]*[@-~]/g

function plainText(line: string): string {
  return line.replace(ansiSequence, '')
}

function isFrameLine(line: string): boolean {
  const plain = plainText(line)
  return /^─+$/.test(plain) || /^─── [↑↓] \d+ more (?:─+)?$/.test(plain)
}

/**
 * Keeps OMP's inline prompt while using the public, unpatched pi-tui Editor.
 * The upstream editor owns editing, wrapping, autocomplete, and IME behavior;
 * this adapter only removes its horizontal frame and prefixes rendered rows.
 */
export class PromptEditor extends Editor {
  private prompt: EditorPrompt = { first: '', continuation: '' }
  private cursorVisible = true

  constructor(tui: TUI, theme: EditorTheme, options: EditorOptions = {}) {
    super(tui, theme, options)
  }

  setPrompt(prompt: EditorPrompt): void {
    if (visibleWidth(prompt.first) !== visibleWidth(prompt.continuation)) {
      throw new Error('Editor prompt prefixes must have equal visible widths')
    }
    this.prompt = prompt
  }

  setCursorVisible(visible: boolean): void {
    this.cursorVisible = visible
  }

  override handleInput(data: string): void {
    const textBefore = this.getText()
    const autocompleteBefore = this.isShowingAutocomplete()
    const historyNavigation = matchesKey(data, 'up') || matchesKey(data, 'down')
    const tabCompletion = matchesKey(data, 'tab')
    const submit = matchesKey(data, 'enter')

    super.handleInput(data)

    // pi-tui leaves the old completion list open after destructive editor
    // actions (Ctrl+U/Ctrl+K/Ctrl+W, Backspace, Delete). Escape closes that
    // stale list without changing the already-updated text or cursor.
    if (autocompleteBefore && this.getText().length < textBefore.length && this.isShowingAutocomplete()) {
      super.handleInput('\x1b')
    }

    // Upstream recalls older history at column zero. Keep the long-standing
    // composer contract: recalled drafts resume with the cursor at the end.
    if (historyNavigation && this.getText() !== textBefore) super.handleInput('\x1b[F')

    // Accepting a slash-command candidate with Tab inserts a trailing space and
    // closes the command list upstream. Trigger completion once more so the
    // command's argument choices replace it immediately.
    if (
      tabCompletion
      && autocompleteBefore
      && textBefore.startsWith('/')
      && this.getText() !== textBefore
      && this.getText().endsWith(' ')
      && !this.isShowingAutocomplete()
    ) {
      (this as unknown as AutocompleteRefreshEditor).tryTriggerAutocomplete(true)
    }

    // Upstream applies an exact slash-command argument on the first Enter but
    // does not submit it. A second Enter is safe only when completion left the
    // slash command unchanged and closed the list.
    if (
      submit
      && autocompleteBefore
      && textBefore.startsWith('/')
      && this.getText() === textBefore
      && !this.isShowingAutocomplete()
    ) {
      super.handleInput(data)
    }
  }

  override render(width: number): string[] {
    const first = truncateToWidth(this.prompt.first, Math.max(0, width - 1), '')
    const promptWidth = visibleWidth(first)
    const continuation = ' '.repeat(promptWidth)
    const innerWidth = Math.max(1, width - promptWidth)
    const framed = super.render(innerWidth)
    if (!this.cursorVisible) {
      for (let index = 0; index < framed.length; index++) {
        framed[index] = framed[index]!.replace(/\x1b\[7m([\s\S]*?)\x1b\[0m/, '$1')
      }
    }
    const topFrame = framed.shift()
    const bottomFrameIndex = framed.findIndex((line, index) => index > 0 && isFrameLine(line))
    const bottomFrame = bottomFrameIndex >= 0 ? framed[bottomFrameIndex] : undefined
    const inputLines = bottomFrameIndex >= 0 ? framed.slice(0, bottomFrameIndex) : framed
    const autocompleteLines = bottomFrameIndex >= 0 ? framed.slice(bottomFrameIndex + 1) : []
    const result: string[] = []

    if (topFrame && plainText(topFrame).includes('↑')) result.push(continuation + topFrame)
    inputLines.forEach((line, index) => result.push((index === 0 ? first : continuation) + line))
    if (bottomFrame && plainText(bottomFrame).includes('↓')) result.push(continuation + bottomFrame)
    autocompleteLines.forEach(line => result.push(continuation + line))
    return result
  }
}
