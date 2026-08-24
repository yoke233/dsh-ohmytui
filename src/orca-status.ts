/**
 * Agent-status reporting for panes hosted by Orca.
 *
 * Orca derives an agent's lifecycle state from two sources only, and terminal
 * titles are never one of them. The transport used here is the generic one:
 * an OSC 9999 sequence carrying a JSON payload, embedded in the PTY stream and
 * stripped by Orca before the bytes reach the screen. That payload is what
 * renders the `✓ Done – DSH` row in Orca's workspace list.
 *
 * The sequence must reach stdout out of band — never through pi-tui's
 * differential renderer, whose next frame would otherwise swallow or diff it.
 * `ProcessTerminal.write` is exactly that path (it is what `setTitle` and the
 * OSC 52 clipboard bridge already use), so the reporter takes a raw writer.
 *
 * Outside an Orca pane the reporter is inert: a plain terminal must never see
 * the raw bytes.
 */

import { displayInlineText, displayText } from './components/text.ts'

/** OSC identifier Orca's terminal-status processor listens on. */
export const ORCA_STATUS_OSC = 9999

/** Agent identity Orca resolves to the "DSH" label and icon. */
export const ORCA_AGENT_TYPE = 'dsh'

/** Environment variable Orca injects into every pane it owns. */
export const ORCA_PANE_ENV = 'ORCA_PANE_KEY'

/**
 * The lifecycle states Orca accepts; any other value drops the whole payload.
 *
 * `blocked` and `waiting` are near-identical in Orca — same dot color, same
 * `attention` bucket, same notification — and differ only in accessible text.
 * Everything that needs the user is reported as `waiting`, matching how Orca's
 * own Claude Code normalizer folds permission requests and questions together.
 */
export type OrcaAgentState = 'working' | 'blocked' | 'waiting' | 'done'

/** One status report, before serialization. */
export interface OrcaStatusPayload {
  readonly state: OrcaAgentState
  /** The user input driving the current turn, shown on Orca's activity row. */
  readonly prompt?: string
  /** Tool currently executing — or awaiting approval — titled as on the TUI's tool card. */
  readonly toolName?: string
  /** That tool's summarized argument: a command, a path, a URL. Never a diff. */
  readonly toolInput?: string
  /**
   * `waiting` only: the open question, as a JSON *string* in the shape of
   * Claude's `AskUserQuestion` tool input. Orca renders it as a clickable card
   * until the next report replaces it, so it must never outlive the answer.
   */
  readonly interactivePrompt?: string
  /** Preview of this turn's assistant output. */
  readonly lastAssistantMessage?: string
  /** Model routing the current turn. */
  readonly model?: string
  /** `done` only: the turn was interrupted rather than completed. */
  readonly interrupted?: boolean
  /** `done` only: an idle boundary (startup/resume/switch), not a finished turn. */
  readonly sessionBoundary?: boolean
}

/** Per-field caps enforced by Orca's ingestion; longer values are clipped here. */
const FIELD_LIMITS = {
  prompt: 1_000,
  toolName: 60,
  toolInput: 160,
  lastAssistantMessage: 8_000,
  model: 120,
} as const

/**
 * Cap on `interactivePrompt`. Unlike the others this one is not a clip:
 * truncating would corrupt the JSON, so an oversized question card is dropped.
 */
const INTERACTIVE_PROMPT_LIMIT = 16_000

/** The tool name Orca resolves to its registered question-card parser. */
export const ORCA_QUESTION_TOOL = 'AskUserQuestion'

/** One selectable answer on a question card. */
export interface OrcaQuestionOption {
  readonly label: string
  readonly description?: string
}

/** One question offered to the user, in the shape Orca's card parser reads. */
export interface OrcaQuestion {
  readonly question: string
  readonly header?: string
  readonly multiSelect?: boolean
  readonly options?: readonly OrcaQuestionOption[]
}

/**
 * Serialize open questions into an `interactivePrompt` value.
 *
 * Orca drops a question carrying neither text nor options, and silently drops
 * an option whose label is not a string; both are filtered here so a partially
 * usable request still renders a card. An empty result, or one past the size
 * cap, yields `undefined` — the caller then reports a plain `waiting`.
 * @param questions - the questions currently on screen.
 * @returns the JSON string to send, or undefined when no card can be built.
 */
export function orcaInteractivePrompt(
  questions: readonly OrcaQuestion[],
): string | undefined {
  const usable = questions.flatMap(item => {
    const options = (item.options ?? [])
      .filter(option => typeof option.label === 'string' && option.label.trim() !== '')
      .map(option => ({
        label: displayInlineText(option.label),
        ...option.description === undefined || option.description.trim() === ''
          ? {}
          : { description: displayInlineText(option.description) },
      }))
    const question = displayInlineText(item.question ?? '').trim()
    if (question === '' && options.length === 0) return []
    return [{
      question,
      ...item.header === undefined ? {} : { header: displayInlineText(item.header) },
      multiSelect: item.multiSelect === true,
      ...options.length === 0 ? {} : { options },
    }]
  })
  if (usable.length === 0) return undefined
  const encoded = JSON.stringify({ questions: usable })
  return encoded.length > INTERACTIVE_PROMPT_LIMIT ? undefined : encoded
}

/** Clip by code point so a cap can never split a surrogate pair. */
function clip(text: string, limit: number): string {
  const points = [...text]
  return points.length <= limit ? text : points.slice(0, limit).join('')
}

/**
 * Serialize one payload as the wire sequence `ESC ] 9999 ; <JSON> BEL`.
 *
 * Text fields are stripped of terminal controls first: session and tool text is
 * untrusted, and although `JSON.stringify` already escapes every C0 byte, the
 * payload should not carry control noise into Orca's UI either. Empty fields
 * are omitted rather than sent blank.
 * @param payload - the status to report.
 * @param agentType - agent identity; the default is what Orca labels "DSH".
 * @returns the sequence to write to stdout.
 */
export function orcaStatusSequence(
  payload: OrcaStatusPayload,
  agentType: string = ORCA_AGENT_TYPE,
): string {
  const body: Record<string, unknown> = { state: payload.state, agentType }
  const inline = (value: string | undefined, limit: number): string | undefined => {
    if (value === undefined) return undefined
    const text = clip(displayInlineText(value).trim(), limit)
    return text === '' ? undefined : text
  }
  const prompt = inline(payload.prompt, FIELD_LIMITS.prompt)
  if (prompt !== undefined) body.prompt = prompt
  const toolName = inline(payload.toolName, FIELD_LIMITS.toolName)
  if (toolName !== undefined) body.toolName = toolName
  const toolInput = inline(payload.toolInput, FIELD_LIMITS.toolInput)
  if (toolInput !== undefined) body.toolInput = toolInput
  if (payload.lastAssistantMessage !== undefined) {
    // Keep the paragraph breaks: Orca renders this one as a message preview.
    const message = clip(displayText(payload.lastAssistantMessage).trim(), FIELD_LIMITS.lastAssistantMessage)
    if (message !== '') body.lastAssistantMessage = message
  }
  const model = inline(payload.model, FIELD_LIMITS.model)
  if (model !== undefined) body.model = model
  // Gated on `waiting` so an answered question can never linger: any later
  // report drops the field, which is exactly how Orca clears the card.
  if (payload.state === 'waiting'
    && payload.interactivePrompt !== undefined
    && payload.interactivePrompt.length <= INTERACTIVE_PROMPT_LIMIT) {
    body.interactivePrompt = payload.interactivePrompt
  }
  if (payload.state === 'done') {
    if (payload.interrupted === true) body.interrupted = true
    if (payload.sessionBoundary === true) body.sessionBoundary = true
  }
  return `\x1b]${ORCA_STATUS_OSC};${JSON.stringify(body)}\x07`
}

/** Whether this process runs inside a pane Orca owns. */
export function isOrcaPane(env: NodeJS.ProcessEnv = process.env): boolean {
  const paneKey = env[ORCA_PANE_ENV]
  return typeof paneKey === 'string' && paneKey.trim() !== ''
}

/**
 * A TUI lifecycle fact. The TUI translates its own events into these; the
 * reporter owns the resulting state machine so the mapping stays in one place
 * and is testable without a live agent.
 */
export type OrcaStatusSignal =
  /** The TUI settled into an idle session (startup, resume, `/new`, `/resume`). */
  | { kind: 'boundary' }
  /** The foreground session changed; forget the previous session's turn. */
  | { kind: 'reset' }
  /** A user message opened (or steered) a turn. */
  | { kind: 'prompt'; text: string }
  /** An assistant message settled; its text becomes the turn's preview. */
  | { kind: 'assistant'; text: string }
  /** A tool call started. */
  | { kind: 'tool'; name: string; input?: string }
  /** A turn closed; `aborted` marks a cancellation rather than completion. */
  | { kind: 'turn-end'; aborted: boolean }
  /** The agent loop entered or left its running phase. */
  | { kind: 'running'; running: boolean }
  /**
   * A tool call is waiting to be approved. Both fields are required reading
   * for the user: a bare `waiting` row cannot say what is being approved.
   */
  | { kind: 'approval'; toolName: string; toolInput?: string }
  /** Questions are on screen waiting for an answer. */
  | { kind: 'questions'; questions: readonly OrcaQuestion[] }
  /** The approval or question modal closed. */
  | { kind: 'attention-cleared' }

/** Reports TUI lifecycle facts to the hosting Orca pane. */
export interface OrcaStatusReporter {
  /** False outside an Orca pane, where every call is a no-op. */
  readonly active: boolean
  /** Report a raw payload, skipping a repeat of the previous one. */
  report(payload: OrcaStatusPayload): void
  /** Feed one lifecycle fact through the state machine. */
  signal(signal: OrcaStatusSignal): void
}

/** Construction facts for {@link createOrcaStatusReporter}. */
export interface OrcaStatusReporterOptions {
  /** Raw stdout writer, bypassing the differential renderer. */
  readonly write: (data: string) => void
  /** Environment to detect the Orca pane from; defaults to `process.env`. */
  readonly env?: NodeJS.ProcessEnv
  /** Agent identity; the default is what Orca labels "DSH". */
  readonly agentType?: string
  /** Current model, read at report time. */
  readonly model?: () => string | undefined
}

/** A reporter that writes nothing, returned outside an Orca pane. */
const INERT: OrcaStatusReporter = {
  active: false,
  report: () => undefined,
  signal: () => undefined,
}

/**
 * Build the reporter for this process.
 *
 * Reporting is best-effort: a failed write (closed pipe during shutdown) must
 * never surface as a TUI error, so writes are swallowed.
 * @param options - see {@link OrcaStatusReporterOptions}.
 * @returns a live reporter inside an Orca pane, an inert one everywhere else.
 */
export function createOrcaStatusReporter(
  options: OrcaStatusReporterOptions,
): OrcaStatusReporter {
  if (!isOrcaPane(options.env ?? process.env)) return INERT

  let lastLine: string | undefined
  /** The turn's driving prompt, replayed on every `working` report. */
  let prompt: string | undefined
  let tool: { name: string; input?: string } | undefined
  let lastAssistant: string | undefined
  let interrupted = false
  /** What the open modal is asking for; undefined while nothing waits. */
  let attention: { toolName: string; toolInput?: string; interactivePrompt?: string } | undefined
  let running = false

  const report = (payload: OrcaStatusPayload): void => {
    const line = orcaStatusSequence(
      { ...payload, model: payload.model ?? options.model?.() },
      options.agentType ?? ORCA_AGENT_TYPE,
    )
    if (line === lastLine) return
    lastLine = line
    try {
      options.write(line)
    } catch {
      // A pane that can no longer be written to needs no status.
    }
  }

  const clearTurn = (): void => {
    prompt = undefined
    tool = undefined
    lastAssistant = undefined
    interrupted = false
  }

  const working = (): void => {
    report({ state: 'working', prompt, toolName: tool?.name, toolInput: tool?.input })
  }

  const signal = (event: OrcaStatusSignal): void => {
    switch (event.kind) {
      case 'boundary':
        clearTurn()
        attention = undefined
        running = false
        report({ state: 'done', sessionBoundary: true })
        break
      case 'reset':
        clearTurn()
        attention = undefined
        running = false
        // Let the next session announce itself even if it lands on the same
        // state the previous one left behind.
        lastLine = undefined
        break
      case 'prompt':
        clearTurn()
        attention = undefined
        prompt = event.text
        working()
        break
      case 'assistant':
        if (event.text.trim() !== '') lastAssistant = event.text
        // The step's tool calls arrive after the message that requested them,
        // so the previous step's tool must not linger on the activity row.
        tool = undefined
        if (attention === undefined) working()
        break
      case 'tool':
        tool = { name: event.name, input: event.input }
        attention = undefined
        working()
        break
      case 'turn-end':
        // `done` waits for the idle transition: a turn can end while queued
        // input immediately opens the next one.
        if (event.aborted) interrupted = true
        break
      case 'running':
        if (event.running) {
          running = true
          attention = undefined
          interrupted = false
          working()
        } else {
          running = false
          tool = undefined
          attention = undefined
          report({ state: 'done', lastAssistantMessage: lastAssistant, interrupted })
          interrupted = false
        }
        break
      case 'approval':
        attention = { toolName: event.toolName, toolInput: event.toolInput }
        report({ state: 'waiting', prompt, ...attention })
        break
      case 'questions':
        attention = {
          toolName: ORCA_QUESTION_TOOL,
          interactivePrompt: orcaInteractivePrompt(event.questions),
        }
        report({ state: 'waiting', prompt, ...attention })
        break
      case 'attention-cleared':
        if (attention === undefined) break
        attention = undefined
        if (running) working()
        break
    }
  }

  return { active: true, report, signal }
}
