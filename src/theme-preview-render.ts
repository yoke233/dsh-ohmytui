import type { Terminal, TUI } from '@earendil-works/pi-tui'

const BEGIN_SYNCHRONIZED_OUTPUT = '\u001b[?2026h'
const CLEAR_VISIBLE_VIEWPORT = '\u001b[2J\u001b[H'

/** Clear and repaint a theme preview as one terminal frame to avoid flashing. */
export function redrawThemePreview(
  terminal: Pick<Terminal, 'write'>,
  ui: Pick<TUI, 'renderNow'>,
): void {
  // TUI's full render emits the matching synchronized-output terminator. By
  // opening the transaction before clearing, the terminal never presents the
  // empty viewport between the clear and the replacement frame.
  terminal.write(BEGIN_SYNCHRONIZED_OUTPUT + CLEAR_VISIBLE_VIEWPORT)
  ui.renderNow(true)
}
