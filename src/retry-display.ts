export interface SessionEventLike {
  type: string
  data: unknown
}

interface TurnStepData {
  turn: number
  step: number
}

function turnStepData(value: unknown): TurnStepData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = value as Record<string, unknown>
  return typeof data.turn === 'number' && typeof data.step === 'number'
    ? { turn: data.turn, step: data.step }
    : undefined
}

/** Count the initial model request plus retries for the turn's final step. */
export function requestAttemptForTurn(events: readonly SessionEventLike[], turn: number): number {
  let finalStep: number | undefined
  for (const event of events) {
    if (event.type !== 'step/start') continue
    const data = turnStepData(event.data)
    if (data?.turn === turn) finalStep = data.step
  }
  if (finalStep === undefined) return 1

  let retries = 0
  for (const event of events) {
    if (event.type !== 'llm/retry') continue
    const data = turnStepData(event.data)
    if (data?.turn === turn && data.step === finalStep) retries += 1
  }
  return retries + 1
}

export interface RetryActivity {
  retry: number
  maximum: string
  delayMs: number
}

export function retryActivity(value: unknown): RetryActivity | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const data = value as Record<string, unknown>
  if (!Number.isSafeInteger(data.retry) || typeof data.retry !== 'number' || data.retry < 1) return undefined
  if (typeof data.delayMs !== 'number' || !Number.isFinite(data.delayMs) || data.delayMs < 0) return undefined
  const maximum = data.mode === 'normal' && Number.isSafeInteger(data.maxRetries)
    ? String(data.maxRetries)
    : '∞'
  return { retry: data.retry, maximum, delayMs: data.delayMs }
}

/** Compact retry wait duration used by the live activity indicator. */
export function formatRetryDelay(delayMs: number): string {
  const seconds = Math.max(0, delayMs) / 1_000
  return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`
}
