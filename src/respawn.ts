/**
 * Generation-respawn contract between the omdsh supervisor
 * (`scripts/omdsh.js`) and the TUI's `/reload` command.
 *
 * The supervisor owns the terminal and stays alive across generations. On
 * `/reload` the TUI writes the next generation's inner arguments to the
 * handoff file the supervisor named through {@link RELOAD_HANDOFF_ENV}, then
 * requests a bounded exit with {@link RELOAD_EXIT_CODE}. The supervisor
 * re-launches `dsh --profile tui` with those arguments, so a fresh process —
 * and therefore a fresh module graph, covering any plugin, dependency, or
 * config change — resumes the same session on the same terminal.
 */

import { writeFileSync } from 'node:fs'

/** Exit code the supervisor treats as a respawn request rather than an exit. */
export const RELOAD_EXIT_CODE = 75

/** Environment variable through which the supervisor names the handoff file. */
export const RELOAD_HANDOFF_ENV = 'OMDSH_RELOAD_HANDOFF'

/** Next generation's launch facts, written by the TUI and read by the supervisor. */
export interface ReloadHandoff {
  /** Inner (post-launcher) arguments for the next generation, in argv order. */
  readonly args: readonly string[]
}

/** Inner-argument flags naming a session identity; replaced on every respawn. */
const IDENTITY_FLAGS = ['--resume', '--session']

/**
 * The next generation's session-identity flag. `--resume` rehydrates persisted
 * history; `--session` recreates the same id fresh — required for a blank
 * session the persistence gate never materialized, where agent-loop's strict
 * config resume would fail and no agent would ever publish.
 */
export type IdentityFlag = '--resume' | '--session'

/**
 * Compose the next generation's inner arguments: keep every foreign app flag,
 * drop any previous session-identity flag, and re-attach `sessionId`.
 * @param current - this generation's inner arguments (`ctx.cmdlineArgs`).
 * @param sessionId - the live session the next generation must continue.
 * @param flag - how the next generation attaches to it (default `--resume`).
 * @returns the next generation's inner arguments.
 */
export function nextGenerationArgs(
  current: readonly string[],
  sessionId: string,
  flag: IdentityFlag = '--resume',
): string[] {
  const kept: string[] = []
  for (let index = 0; index < current.length; index++) {
    const argument = current[index]!
    if (IDENTITY_FLAGS.includes(argument)) {
      index++
      continue
    }
    if (IDENTITY_FLAGS.some(identity => argument.startsWith(`${identity}=`))) continue
    kept.push(argument)
  }
  return [...kept, flag, sessionId]
}

/**
 * Persist the handoff for the supervisor. Synchronous on purpose: the caller
 * requests process exit immediately afterwards, and the write must not race it.
 * @param path - the handoff file named by {@link RELOAD_HANDOFF_ENV}.
 * @param handoff - the next generation's launch facts.
 */
export function writeReloadHandoff(path: string, handoff: ReloadHandoff): void {
  writeFileSync(path, `${JSON.stringify(handoff)}\n`)
}

/** Worst-case delay between a requested exit and the watchdog's forced exit. */
export const EXIT_WATCHDOG_MS = 10_000

/**
 * Guarantee a requested exit actually terminates the process. The launcher's
 * bounded shutdown force-exits only while disposal hangs; once disposal
 * succeeds it merely sets `process.exitCode` and waits for the event loop to
 * drain — a keep-alive handle leaked by any profile plugin then hangs the
 * process forever (observed with third-party bundles). The timer is unref'd,
 * so a clean drain still exits naturally and immediately.
 * @param code - exit code to force after the deadline.
 * @param delayMs - watchdog deadline, {@link EXIT_WATCHDOG_MS} by default.
 */
export function armExitWatchdog(code: number, delayMs = EXIT_WATCHDOG_MS): void {
  const watchdog = setTimeout(() => { process.exit(code) }, delayMs)
  watchdog.unref()
}
