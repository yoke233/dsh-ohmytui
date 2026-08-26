export interface ThemeSelectionState {
  mode: 'dynamic' | 'selected'
  dark: string
  light: string
  selected: string
}

export type ThemeCommandResult =
  | { kind: 'summary'; state: ThemeSelectionState }
  | { kind: 'error'; reason: 'mode' | 'theme'; value: string }
  | { kind: 'update'; state: ThemeSelectionState; changed: 'mode' | 'dark' | 'light' | 'selected'; value: string }

/** Whether the current editor text is selecting a concrete /theme candidate. */
export function isThemeAutocompleteContext(text: string): boolean {
  return /^\/theme\s+(?:(?:dark|light)\s+)?\S*$/u.test(text)
}

/** Return the concrete candidate in a completed /theme command, if present. */
export function completedThemeCandidate(text: string): string | undefined {
  const match = /^\/theme\s+(?:(?:dark|light)\s+)?(\S+)\s*$/u.exec(text)
  return match?.[1]
}

/** Resolve a /theme argument without performing persistence or terminal rendering. */
export function resolveThemeCommand(
  argument: string,
  current: ThemeSelectionState,
  isKnownTheme: (id: string) => boolean,
): ThemeCommandResult {
  const parts = argument.trim().split(/\s+/u).filter(Boolean)
  if (parts.length === 0) return { kind: 'summary', state: { ...current } }

  const command = parts[0]!
  if (command === 'mode') {
    const mode = parts[1]
    if ((mode !== 'dynamic' && mode !== 'selected') || parts.length !== 2) {
      return { kind: 'error', reason: 'mode', value: mode ?? '' }
    }
    return { kind: 'update', state: { ...current, mode }, changed: 'mode', value: mode }
  }

  if (command === 'dark' || command === 'light') {
    const id = parts[1]
    if (id === undefined || parts.length !== 2 || !isKnownTheme(id)) {
      return { kind: 'error', reason: 'theme', value: id ?? '' }
    }
    return {
      kind: 'update',
      state: { ...current, mode: 'dynamic', [command]: id },
      changed: command,
      value: id,
    }
  }

  if (parts.length !== 1 || !isKnownTheme(command)) {
    return { kind: 'error', reason: 'theme', value: argument.trim() }
  }
  return {
    kind: 'update',
    state: { ...current, mode: 'selected', selected: command },
    changed: 'selected',
    value: command,
  }
}
