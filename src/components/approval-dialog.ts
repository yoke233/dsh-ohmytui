/**
 * Dedicated approval prompt for one-shot permission escalations.
 * Escape rejects, abort cancels, and only an explicit choice can grant access.
 */

import {
  SelectList,
  wrapTextWithAnsi,
  type Component,
  type OverlayHandle,
  type TUI,
} from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { Translator } from '../i18n.ts'
import { frameBlock, selectTheme, type Palette } from '../theme.ts'
import { displayText } from './text.ts'

/** Permission escalation prompt. Escape is an explicit rejection (fail closed). */
export class ApprovalDialog implements Component {
  private readonly list: SelectList

  constructor(
    private readonly toolName: string,
    private readonly reason: string | undefined,
    private readonly palette: Palette,
    private readonly t: Translator,
    private readonly onDone: (outcome: ApprovalOutcome) => void,
  ) {
    this.list = new SelectList([
      {
        value: 'allowed-once',
        label: t('approvalAllowOnce'),
        description: t('approvalAllowOnceHint'),
      },
      {
        value: 'rejected',
        label: t('approvalReject'),
        description: t('approvalRejectHint'),
      },
    ], 2, selectTheme(palette))
    this.list.onSelect = item => onDone(item.value as ApprovalOutcome)
    this.list.onCancel = () => onDone('rejected')
  }

  handleInput(data: string): void {
    this.list.handleInput(data)
  }

  invalidate(): void {
    this.list.invalidate()
  }

  render(width: number): string[] {
    const bodyWidth = Math.max(1, width - 8)
    const tool = displayText(this.toolName)
    const reason = displayText(this.reason?.trim() || this.t('approvalReasonFallback'))
    const rows = [
      ...wrapTextWithAnsi(this.palette.bold(this.palette.accent(this.t('approvalTool', { tool }))), bodyWidth),
      ...wrapTextWithAnsi(this.t('approvalReason', { reason }), bodyWidth),
      '',
      ...this.list.render(bodyWidth),
      '',
      ...wrapTextWithAnsi(this.palette.dim(this.t('approvalHint')), bodyWidth),
    ]
    return frameBlock(rows, width, this.palette.accent, undefined, this.t('approvalTitle'))
  }
}

/**
 * Show one abortable approval popup. A dismissed popup rejects the operation;
 * an aborted tool call closes the overlay and reports cancellation.
 */
export function runApprovalFlow(
  ui: TUI,
  palette: Palette,
  t: Translator,
  toolName: string,
  reason: string | undefined,
  signal: AbortSignal | undefined,
): Promise<ApprovalOutcome> {
  return new Promise((resolve, reject) => {
    let settled = false
    let handle: OverlayHandle | undefined
    const finish = (outcome: ApprovalOutcome): void => {
      if (settled) return
      settled = true
      signal?.removeEventListener('abort', onAbort)
      handle?.hide()
      ui.requestRender()
      resolve(outcome)
    }
    const onAbort = (): void => finish('cancelled')

    if (signal?.aborted) {
      finish('cancelled')
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      handle = ui.showOverlay(
        new ApprovalDialog(toolName, reason, palette, t, finish),
        { anchor: 'bottom-center', width: '100%', maxHeight: '85%', margin: { bottom: 4 } },
      )
      ui.requestRender()
    } catch (error) {
      settled = true
      signal?.removeEventListener('abort', onAbort)
      reject(error)
    }
  })
}
