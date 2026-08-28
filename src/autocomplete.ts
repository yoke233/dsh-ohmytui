/**
 * Composer autocomplete wrapper.
 *
 * Skills are exposed as ordinary slash commands named `skill:<name>` so they
 * appear in the quick command list after `/` and participate in the same fuzzy
 * search as other commands (e.g. `commit` matches `skill:git-commit`).
 *
 * The stock pi-tui completion inserts a space after a completed command, which
 * would turn `/skill:git-commit` into `/skill:git-commit `. This wrapper keeps
 * the no-space `skill:<name>` syntax when a skill command is completed.
 */

import type {
  AutocompleteItem,
  AutocompleteProvider,
  AutocompleteSuggestions,
  SlashCommand,
} from '@earendil-works/pi-tui'

export interface SkillCommandCandidate {
  name: string
  description: string
  invocation: { userInvocable: boolean }
}

interface AutocompleteSelectionList {
  onSelectionChange?: (item: AutocompleteItem) => void
  getSelectedItem(): AutocompleteItem | null
}

interface SelectionObservableEditor {
  getText(): string
}

interface EditorAutocompleteInternals {
  createAutocompleteList(prefix: string, items: AutocompleteItem[]): AutocompleteSelectionList
  cancelAutocomplete(): void
}

export interface AutocompleteSelectionObserver {
  onSelection: (text: string, item: AutocompleteItem) => void
  onClose?: () => void
}

/**
 * Observe the SelectList owned by pi-tui's Editor.
 *
 * SelectList exposes selection changes, but Editor does not currently forward
 * them. Keep this compatibility shim isolated here so theme preview can be
 * removed once the upstream Editor offers a public observer.
 */
export function observeAutocompleteSelection(
  editor: SelectionObservableEditor,
  observer: AutocompleteSelectionObserver,
): () => void {
  const internals = editor as SelectionObservableEditor & EditorAutocompleteInternals
  const originalCreate = internals.createAutocompleteList.bind(editor)
  const originalCancel = internals.cancelAutocomplete.bind(editor)

  internals.createAutocompleteList = (prefix, items) => {
    const list = originalCreate(prefix, items)
    const previous = list.onSelectionChange
    list.onSelectionChange = (item) => {
      previous?.(item)
      observer.onSelection(editor.getText(), item)
    }
    const selected = list.getSelectedItem()
    if (selected !== null) observer.onSelection(editor.getText(), selected)
    return list
  }
  internals.cancelAutocomplete = () => {
    originalCancel()
    observer.onClose?.()
  }

  return () => {
    internals.createAutocompleteList = originalCreate
    internals.cancelAutocomplete = originalCancel
  }
}

/** Split `/skill:<name> [request]` without treating the request as part of the name. */
export function parseSkillInvocation(line: string): { name: string; request: string } {
  const invocation = line.slice('/skill:'.length).trim()
  const separator = invocation.search(/\s/u)
  if (separator < 0) return { name: invocation, request: '' }
  return {
    name: invocation.slice(0, separator),
    request: invocation.slice(separator).trim(),
  }
}

/** Replace dynamic skill commands while retaining every non-skill command. */
export function syncSkillCommands(
  commands: SlashCommand[],
  skills: readonly SkillCommandCandidate[],
): void {
  const regularCommands = commands.filter(command => !command.name.startsWith('skill:'))
  const skillCommands = skills
    .filter(skill => skill.invocation.userInvocable)
    .map((skill): SlashCommand => ({
      name: `skill:${skill.name}`,
      description: skill.description,
    }))
  commands.splice(0, commands.length, ...regularCommands, ...skillCommands)
}

/** Autocomplete provider that completes `skill:<name>` commands without a space. */
export class SkillAwareAutocompleteProvider implements AutocompleteProvider {
  constructor(private readonly inner: AutocompleteProvider) {}

  async getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    options: Parameters<AutocompleteProvider['getSuggestions']>[3],
  ): Promise<AutocompleteSuggestions | null> {
    const suggestions = await this.inner.getSuggestions(lines, cursorLine, cursorCol, options)
    if (suggestions === null) return null

    // Skill completions intentionally omit the usual trailing space. That leaves
    // the cursor on the exact slash command, so the inner provider immediately
    // offers the item that was just accepted again. Remove only that completed
    // item while preserving any other fuzzy matches.
    const items = suggestions.items.filter(item => (
      !item.value.startsWith('skill:') || suggestions.prefix !== `/${item.value}`
    ))
    if (items.length === 0) return null
    if (items.length === suggestions.items.length) return suggestions
    return { ...suggestions, items }
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    if (item.value.startsWith('skill:')) {
      const currentLine = lines[cursorLine] ?? ''
      const beforePrefix = currentLine.slice(0, cursorCol - prefix.length)
      const afterCursor = currentLine.slice(cursorCol)
      const newLine = `${beforePrefix}/${item.value}${afterCursor}`
      const newLines = [...lines]
      newLines[cursorLine] = newLine
      return {
        lines: newLines,
        cursorLine,
        cursorCol: beforePrefix.length + item.value.length + 1, // +1 for the leading "/"
      }
    }
    return this.inner.applyCompletion(lines, cursorLine, cursorCol, item, prefix)
  }

  shouldTriggerFileCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): boolean {
    return this.inner.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true
  }
}
