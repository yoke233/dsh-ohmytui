import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { Session, SessionEvent, TodoItem } from '@deepseek-ai/dsh-session'

/** Events proving that a session contains model-facing conversation data. */
const CONVERSATION_EVENT_TYPES: Readonly<Record<string, true>> = {
  'user/message': true,
  'assistant/message': true,
  'tool/call': true,
}

/** Whether a session has crossed the blank-session boundary. */
export function hasConversationData(events: readonly SessionEvent[]): boolean {
  return events.some(event => CONVERSATION_EVENT_TYPES[event.type] === true)
}

export interface SessionSubagent {
  readonly label?: string
  readonly provider: string
  readonly mode: 'one-shot' | 'continuable'
}

export interface SessionViewState {
  readonly todos: readonly TodoItem[]
  readonly goal: { readonly objective: string; readonly phase: string } | undefined
  readonly tokenTotals: { readonly inputTokens: number; readonly outputTokens: number }
  readonly subagents: readonly SessionSubagent[]
}

/** Validate the optional subagent event extension before rendering it. */
export function sessionSubagent(event: SessionEvent): SessionSubagent | undefined {
  const candidate: unknown = event
  if (typeof candidate !== 'object' || candidate === null
    || !('type' in candidate) || candidate.type !== 'subagent/descriptor'
    || !('data' in candidate) || typeof candidate.data !== 'object' || candidate.data === null) return undefined
  const label = 'label' in candidate.data ? candidate.data.label : undefined
  const provider = 'provider' in candidate.data ? candidate.data.provider : undefined
  const mode = 'mode' in candidate.data ? candidate.data.mode : undefined
  if (label !== undefined && typeof label !== 'string') return undefined
  if (provider !== undefined && typeof provider !== 'string') return undefined
  if (mode !== undefined && mode !== 'one-shot' && mode !== 'continuable') return undefined
  return {
    ...(label === undefined ? {} : { label }),
    provider: provider ?? 'subagent',
    mode: mode ?? 'one-shot',
  }
}

/** Fold session-owned UI projections independently from the visible transcript window. */
export function foldSessionView(events: readonly SessionEvent[]): SessionViewState {
  let todos: readonly TodoItem[] = []
  let goal: SessionViewState['goal']
  let inputTokens = 0
  let outputTokens = 0
  const subagents: SessionViewState['subagents'][number][] = []
  for (const event of events) {
    if (event.type === 'todo/write') {
      todos = event.data.todos
    } else if (event.type === 'goal/change') {
      goal = event.data.operation === 'clear'
        ? undefined
        : { objective: event.data.goal.objective, phase: event.data.goal.phase }
    } else if (event.type === 'assistant/message' && event.data.usage !== undefined) {
      inputTokens += event.data.usage.inputTokens
      outputTokens += event.data.usage.outputTokens
    } else {
      const descriptor = sessionSubagent(event)
      if (descriptor !== undefined) subagents.push(descriptor)
    }
  }
  return { todos, goal, tokenTotals: { inputTokens, outputTokens }, subagents }
}

/**
 * Persist a runtime preset immediately before the first user message. Keeping
 * this out of blank-session setup preserves the persistence backend's lazy
 * materialization contract: an abandoned session leaves no artifact.
 */
export function recordConversationPreset(session: Session, preset: string): void {
  if (resolveSessionPreset(session) === preset) return
  session.append('agent-preset/selected', { agentPreset: preset })
}
