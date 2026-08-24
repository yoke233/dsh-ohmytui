/**
 * tui-startup: parses the launcher's immutable command-line snapshot and
 * provides the `tuiStartup` service consumed by the agent-loop and TUI rows.
 * The launcher parses only its own flags; everything after them reaches us
 * verbatim through `ctx.cmdlineArgs`.
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'
import { SessionId } from '@deepseek-ai/dsh-session'
import { Command } from 'commander'

declare module '@deepseek-ai/cordis' {
  interface Context {
    tuiStartup: TuiStartup
  }
}

/** The resolved session identity for this invocation. */
export interface TuiStartupValues {
  /** Fresh-session identity: `--session <id>`, or a minted id when neither flag was given. */
  readonly sessionId: SessionId | undefined
  /** Persisted-session identity: `--resume <id>`. */
  readonly resumeSessionId: SessionId | undefined
  /** `--yolo`: pin every foreground session to the unrestricted preset. */
  readonly skipPermissions: boolean
}

/** Service provided by the startup row; the session fields are mutually exclusive. */
export class TuiStartup extends Service {
  static inject = ['cmdlineArgs']

  readonly sessionId: SessionId | undefined
  readonly resumeSessionId: SessionId | undefined
  readonly skipPermissions: boolean

  constructor(ctx: Context) {
    super(ctx, 'tuiStartup')
    let sessionId: SessionId | undefined
    let resumeSessionId: SessionId | undefined
    let skipPermissions = false
    const program = new Command()
    program
      .name('dsh tui')
      .description('omp-styled interactive terminal front door for DeepSeek Harness')
      .option('--resume <sessionId>', 'resume a persisted session')
      .option('--session <sessionId>', 'name a fresh session explicitly')
      .option('--yolo', 'start with the unrestricted permission preset (no sandbox, no approval prompts)')
      .action((options: { resume?: string; session?: string; yolo?: boolean }) => {
        if (options.resume !== undefined && options.session !== undefined) {
          program.error('--resume and --session are mutually exclusive')
          return
        }
        if (options.resume !== undefined) resumeSessionId = SessionId(options.resume)
        if (options.session !== undefined) sessionId = SessionId(options.session)
        skipPermissions = options.yolo === true
      })
    parseCmdline(ctx, program)
    this.skipPermissions = skipPermissions
    // A bare `dsh --profile tui` mints a fresh identity so the TUI row always
    // knows which agent to mount, instead of racing the agent-loop's own
    // `${id}-session-<uuid>` fallback. With `--resume`, only resumeSessionId is
    // set — agent-loop rejects a row carrying both fields.
    this.sessionId = resumeSessionId === undefined
      ? sessionId ?? SessionId(`tui-${crypto.randomUUID()}`)
      : undefined
    this.resumeSessionId = resumeSessionId
  }
}

export default TuiStartup
