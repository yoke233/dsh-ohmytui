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
  argumentHint = '[request]',
): void {
  const regularCommands = commands.filter(command => !command.name.startsWith('skill:'))
  const skillCommands = skills
    .filter(skill => skill.invocation.userInvocable)
    .map((skill): SlashCommand => ({
      name: `skill:${skill.name}`,
      description: skill.description,
      argumentHint,
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
    return this.inner.getSuggestions(lines, cursorLine, cursorCol, options)
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
