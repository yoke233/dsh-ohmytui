import type { AgentStatus } from '@deepseek-ai/dsh-agent'
import { matchesKey } from '@earendil-works/pi-tui'

/** Escape cancels only a running turn while the main composer owns input. */
export function shouldCancelRunningTurn(
  data: string,
  status: AgentStatus | undefined,
  editorFocused: boolean,
): boolean {
  return editorFocused && status === 'running' && matchesKey(data, 'escape')
}
