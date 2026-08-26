import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { matchesKey } from '@earendil-works/pi-tui'

export type RunningTurnKeyAction = 'clear-draft' | 'cancel'

/** Resolve Ctrl+C/Escape without letting a non-empty draft stop the running turn. */
export function runningTurnKeyAction(
  data: string,
  status: AgentStatus | undefined,
  editorFocused: boolean,
  draft: string,
): RunningTurnKeyAction | undefined {
  if (!editorFocused || status !== 'running') return undefined
  if (matchesKey(data, 'ctrl+c')) return draft === '' ? 'cancel' : 'clear-draft'
  if (matchesKey(data, 'escape')) return 'cancel'
  return undefined
}
