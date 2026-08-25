import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { visibleWidth, type OverlayOptions, type TUI } from '@earendil-works/pi-tui'
import type { ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import { ApprovalDialog, runApprovalFlow } from '../src/components/approval-dialog.ts'
import { createTranslator } from '../src/i18n.ts'
import { createPalette } from '../src/theme.ts'

const palette = createPalette(false, 'dark', true)
const t = createTranslator('en')

function dialog(...reasons: [reason?: string]) {
  const reason = reasons.length === 0 ? 'The command needs process access.' : reasons[0]
  const state = { outcome: undefined as ApprovalOutcome | undefined }
  const view = new ApprovalDialog('pwsh', reason, palette, t, (outcome) => {
    state.outcome = outcome
  })
  return { view, state }
}

describe('ApprovalDialog', () => {
  it('renders the tool, reason, choices, and keyboard hint within the frame', () => {
    const { view } = dialog()
    const rows = view.render(52)
    const text = rows.join('\n')

    assert.ok(text.includes('pwsh'))
    assert.ok(text.includes('process access'))
    assert.ok(text.includes(t('approvalAllowOnce')))
    assert.ok(text.includes(t('approvalReject')))
    assert.ok(text.includes('Esc'))
    assert.ok(rows.every(row => visibleWidth(row) === 52))

    assert.ok(rows[0]?.includes(palette.accent('╭───')))
    assert.ok(text.includes(palette.bold(palette.accent(t('approvalTool', { tool: 'pwsh' })))))
  })

  it('allows only the current call when the default choice is confirmed', () => {
    const { view, state } = dialog()
    view.handleInput('\r')
    assert.equal(state.outcome, 'allowed-once')
  })

  it('rejects when the reject choice is selected', () => {
    const { view, state } = dialog()
    view.handleInput('\x1b[B')
    view.handleInput('\r')
    assert.equal(state.outcome, 'rejected')
  })

  it('fails closed when Escape dismisses the popup', () => {
    const { view, state } = dialog()
    view.handleInput('\x1b')
    assert.equal(state.outcome, 'rejected')
  })

  it('uses a localized fallback when no reason is supplied', () => {
    const { view } = dialog(undefined)
    const rendered = view.render(64).join('').replace(/[│╭╮╰╯─]/g, '').replace(/\s/g, '')
    assert.ok(rendered.includes(t('approvalReasonFallback').replace(/\s/g, '')))
  })

  it('returns cancelled without opening an overlay when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    let overlays = 0
    const ui = {
      showOverlay: () => { overlays++; throw new Error('unexpected overlay') },
      requestRender: () => {},
    } as unknown as TUI

    const outcome = await runApprovalFlow(ui, palette, t, 'pwsh', undefined, controller.signal)
    assert.equal(outcome, 'cancelled')
    assert.equal(overlays, 0)
  })

  it('opens full-width above the composer at the bottom center of the terminal', async () => {
    const controller = new AbortController()
    let options: OverlayOptions | undefined
    const ui = {
      showOverlay: (_component: unknown, next: OverlayOptions) => {
        options = next
        return { hide: () => {} }
      },
      requestRender: () => {},
    } as unknown as TUI

    const outcomePromise = runApprovalFlow(ui, palette, t, 'pwsh', 'reason', controller.signal)
    assert.deepEqual(options, {
      anchor: 'bottom-center',
      width: '100%',
      maxHeight: '85%',
      margin: { bottom: 4 },
    })
    controller.abort()
    assert.equal(await outcomePromise, 'cancelled')
  })

  it('closes the overlay and cancels when the tool call is aborted', async () => {
    const controller = new AbortController()
    let hidden = 0
    const ui = {
      showOverlay: () => ({ hide: () => { hidden++ } }),
      requestRender: () => {},
    } as unknown as TUI

    const outcomePromise = runApprovalFlow(ui, palette, t, 'pwsh', 'reason', controller.signal)
    controller.abort()
    assert.equal(await outcomePromise, 'cancelled')
    assert.equal(hidden, 1)
  })

  it('propagates an overlay setup failure instead of leaving the request pending', async () => {
    const ui = {
      showOverlay: () => { throw new Error('overlay failed') },
      requestRender: () => {},
    } as unknown as TUI

    await assert.rejects(
      runApprovalFlow(ui, palette, t, 'pwsh', 'reason', undefined),
      /overlay failed/,
    )
  })
})
