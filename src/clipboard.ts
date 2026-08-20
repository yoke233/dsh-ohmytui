import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { contentText } from './components/content.ts'

/** Return the latest non-empty assistant response as plain text. */
export function latestAssistantText(events: readonly SessionEvent[]): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]!
    if (event.type !== 'assistant/message') continue
    const text = contentText(event.data.message.content).trim()
    if (text !== '') return text
  }
  return undefined
}

/** Build an OSC 52 sequence supported by Windows Terminal and modern terminals. */
export function osc52ClipboardSequence(text: string): string {
  return `\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`
}
