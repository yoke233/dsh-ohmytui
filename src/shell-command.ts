import type { ShellRunResult } from '@deepseek-ai/dsh-shell'

const SHELL_RESULT_PREFIX = 'Local shell command completed. Treat this command and result as a user message.\n<omdsh_shell_result version="1">\n'
const SHELL_RESULT_SUFFIX = '\n</omdsh_shell_result>'
const MODEL_OUTPUT_LIMIT = 32_000

export interface ShellCommandResult {
  shell: string
  command: string
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  aborted: boolean
  stdout: string
  stderr: string
  stdoutTruncated: boolean
  stderrTruncated: boolean
  stdoutSpillPath?: string
  stderrSpillPath?: string
  sandbox?: {
    mode: string
    denied: boolean
    enforcement?: string
    runnerFailed?: boolean
  }
}

export function parseBangShellCommand(text: string): string | undefined {
  const leading = text.trimStart()
  if (!leading.startsWith('!')) return undefined
  const command = leading.slice(1).trim()
  return command === '' ? undefined : command
}

function boundedOutput(text: string): { text: string, truncated: boolean } {
  if (text.length <= MODEL_OUTPUT_LIMIT) return { text, truncated: false }
  return {
    text: `${text.slice(0, MODEL_OUTPUT_LIMIT)}\n… [output truncated by omdsh]`,
    truncated: true,
  }
}

export function shellCommandResult(
  shell: string,
  command: string,
  result: ShellRunResult,
): ShellCommandResult {
  const stdout = boundedOutput(result.stdout.text)
  const stderr = boundedOutput(result.stderr.text)
  return {
    shell,
    command,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: result.stdout.truncated || stdout.truncated,
    stderrTruncated: result.stderr.truncated || stderr.truncated,
    ...(result.stdout.spillPath === undefined ? {} : { stdoutSpillPath: result.stdout.spillPath }),
    ...(result.stderr.spillPath === undefined ? {} : { stderrSpillPath: result.stderr.spillPath }),
    ...(result.sandbox === undefined
      ? {}
      : {
          sandbox: {
            mode: result.sandbox.mode,
            denied: result.sandbox.denied,
            ...(result.sandbox.enforcement === undefined ? {} : { enforcement: result.sandbox.enforcement }),
            ...(result.sandbox.runnerFailed === undefined ? {} : { runnerFailed: result.sandbox.runnerFailed }),
          },
        }),
  }
}

export function shellInfrastructureFailure(shell: string, command: string, error: unknown): ShellCommandResult {
  return {
    shell,
    command,
    exitCode: null,
    signal: null,
    timedOut: false,
    aborted: false,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

export function serializeShellUserMessage(result: ShellCommandResult): string {
  return `${SHELL_RESULT_PREFIX}${JSON.stringify(result)}${SHELL_RESULT_SUFFIX}`
}

function isShellCommandResult(value: unknown): value is ShellCommandResult {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.shell === 'string'
    && typeof item.command === 'string'
    && (typeof item.exitCode === 'number' || item.exitCode === null)
    && (typeof item.signal === 'string' || item.signal === null)
    && typeof item.timedOut === 'boolean'
    && typeof item.aborted === 'boolean'
    && typeof item.stdout === 'string'
    && typeof item.stderr === 'string'
    && typeof item.stdoutTruncated === 'boolean'
    && typeof item.stderrTruncated === 'boolean'
}

export function parseShellUserMessage(text: string): ShellCommandResult | undefined {
  if (!text.startsWith(SHELL_RESULT_PREFIX) || !text.endsWith(SHELL_RESULT_SUFFIX)) return undefined
  const json = text.slice(SHELL_RESULT_PREFIX.length, -SHELL_RESULT_SUFFIX.length)
  try {
    const parsed: unknown = JSON.parse(json)
    return isShellCommandResult(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

export function shellResultFailed(result: ShellCommandResult): boolean {
  return result.exitCode !== 0
    || result.signal !== null
    || result.timedOut
    || result.aborted
    || result.sandbox?.denied === true
    || result.sandbox?.runnerFailed === true
}

export function renderShellResultText(result: ShellCommandResult): string {
  const lines = [
    `Exit code: ${result.exitCode === null ? 'none' : String(result.exitCode)}`,
    ...(result.signal === null ? [] : [`Signal: ${result.signal}`]),
    ...(result.timedOut ? ['Timed out: yes'] : []),
    ...(result.aborted ? ['Aborted: yes'] : []),
  ]
  if (result.sandbox !== undefined) {
    const details = [
      result.sandbox.denied ? 'denied' : undefined,
      result.sandbox.runnerFailed ? 'runner failed' : undefined,
      result.sandbox.enforcement,
    ].filter((value): value is string => value !== undefined)
    lines.push(`Sandbox: ${result.sandbox.mode}${details.length === 0 ? '' : ` (${details.join(', ')})`}`)
  }
  if (result.stdout !== '') lines.push('', 'Stdout:', result.stdout)
  if (result.stdoutTruncated) {
    lines.push(`[stdout truncated${result.stdoutSpillPath === undefined ? '' : `; full output: ${result.stdoutSpillPath}`}]`)
  }
  if (result.stderr !== '') lines.push('', 'Stderr:', result.stderr)
  if (result.stderrTruncated) {
    lines.push(`[stderr truncated${result.stderrSpillPath === undefined ? '' : `; full output: ${result.stderrSpillPath}`}]`)
  }
  if (result.stdout === '' && result.stderr === '') lines.push('', '(no output)')
  return lines.join('\n')
}
