import { Container, Text } from '@earendil-works/pi-tui'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { MarkdownTheme, Palette } from '../theme.ts'
import type { Translator } from '../i18n.ts'
import { contentText, hasContentText } from './content.ts'

/** Only inputs added to an already-running turn are steer projections. */
export function shouldProjectPendingInput(status: string): boolean {
  return status === 'running'
}

/** Idle submissions render immediately as normal transcript messages, never Steering. */
export function shouldProjectImmediateUserInput(status: string): boolean {
  return status === 'idle'
}

/** Merge editable queued user text with any current draft, preserving order. */
export function mergePendingInput(messages: readonly UserMessage[], draft = ''): string {
  return [...messages
    .filter(message => message.source.kind === 'user' && hasContentText(message.content))
    .map(message => contentText(message.content).trim()), draft.trim()]
    .filter(Boolean)
    .join('\n\n')
}

/** Immediate projection of user input waiting for its durable transcript event. */
export class PendingInputPanel extends Container {
  private static readonly MAX_LINES = 8
  private static readonly MAX_VISIBLE_MESSAGES = 3
  private readonly messages = new Map<string, UserMessage>()

  constructor(
    private readonly palette: Palette,
    _mdTheme: MarkdownTheme,
    private readonly t: Translator,
  ) {
    super()
  }

  get count(): number {
    return this.messages.size
  }

  insert(message: UserMessage): boolean {
    if (message.source.kind !== 'user' || !hasContentText(message.content)) return false
    this.messages.set(message.id, message)
    this.rebuild()
    return true
  }

  remove(id: string): boolean {
    const removed = this.messages.delete(id)
    if (removed) this.rebuild()
    return removed
  }

  sync(messages: readonly UserMessage[]): void {
    this.messages.clear()
    for (const message of messages) {
      if (message.source.kind === 'user' && hasContentText(message.content)) {
        this.messages.set(message.id, message)
      }
    }
    this.rebuild()
  }

  override render(width: number): string[] {
    const rows = super.render(width)
    if (rows.length === 0) return rows
    const contentRows = rows.length < PendingInputPanel.MAX_LINES
      ? rows
      : [
          rows[0]!,
          this.palette.muted(' …'),
          ...rows.slice(-(PendingInputPanel.MAX_LINES - 2)),
        ]
    return ['', ...contentRows, '']
  }

  private rebuild(): void {
    this.clear()
    const allMessages = [...this.messages.values()]
    if (allMessages.length === 0) return
    const visibleCount = allMessages.length > PendingInputPanel.MAX_VISIBLE_MESSAGES
      ? PendingInputPanel.MAX_VISIBLE_MESSAGES - 1
      : allMessages.length
    const messages = allMessages.slice(-visibleCount)
    const omitted = allMessages.length - messages.length
    if (omitted > 0) {
      this.addChild(new Text(this.palette.muted(this.t('queuedSteerOmitted', { count: omitted })), 2, 0))
    }
    messages.forEach((message, index) => {
      const prefix = index === 0 ? this.t('queuedSteer', { count: this.count }) : '          '
      this.addChild(new Text(
        `${this.palette.accent(prefix)}${this.palette.text(contentText(message.content).trim())}`,
        2,
        0,
      ))
    })
    this.addChild(new Text(this.palette.muted(this.t('queuedSteerEditHint')), 2, 0))
  }
}
