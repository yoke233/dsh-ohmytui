import { Container, Spacer, Text } from '@earendil-works/pi-tui'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type { MarkdownTheme, Palette } from '../theme.ts'
import type { Translator } from '../i18n.ts'
import { contentText, hasContentText } from './content.ts'
import { UserMessageComponent } from './transcript.ts'

/** Immediate projection of user input waiting for its durable transcript event. */
export class PendingInputPanel extends Container {
  private static readonly MAX_LINES = 8
  private static readonly MAX_VISIBLE_MESSAGES = 3
  private readonly messages = new Map<string, UserMessage>()

  constructor(
    private readonly palette: Palette,
    private readonly mdTheme: MarkdownTheme,
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
    if (rows.length < PendingInputPanel.MAX_LINES) return [...rows, '']
    const bodyRows = rows.slice(-(PendingInputPanel.MAX_LINES - 3))
    return [
      rows[0]!,
      this.palette.muted(' …'),
      ...bodyRows,
      '',
    ]
  }

  private rebuild(): void {
    this.clear()
    const allMessages = [...this.messages.values()]
    if (allMessages.length === 0) return
    const visibleCount = allMessages.length > PendingInputPanel.MAX_VISIBLE_MESSAGES
      ? PendingInputPanel.MAX_VISIBLE_MESSAGES - 1
      : allMessages.length
    const messages = allMessages.slice(-visibleCount)
    this.addChild(new Text(this.palette.muted(this.t('queuedSteer', { count: this.count })), 1, 0))
    const omitted = allMessages.length - messages.length
    if (omitted > 0) {
      this.addChild(new Text(this.palette.muted(this.t('queuedSteerOmitted', { count: omitted })), 1, 0))
    }
    messages.forEach((message, index) => {
      if (index > 0) this.addChild(new Spacer(1))
      this.addChild(new UserMessageComponent(contentText(message.content), this.palette, this.mdTheme, 0))
    })
  }
}
