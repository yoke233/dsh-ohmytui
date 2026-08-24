import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  RELOAD_EXIT_CODE,
  RELOAD_HANDOFF_ENV,
  nextGenerationArgs,
  writeReloadHandoff,
} from '../src/respawn.ts'

const RESPAWN_MODULE_URL = new URL('../src/respawn.ts', import.meta.url).href

/** Run one inline module script in a child Node process and report its exit. */
function runChild(script: string): { status: number | null; durationMs: number } {
  const started = Date.now()
  const result = spawnSync(process.execPath, [
    '--experimental-transform-types',
    '--input-type=module',
    '--eval', script,
  ], { encoding: 'utf8', timeout: 15_000 })
  if (result.error !== undefined) throw result.error
  return { status: result.status, durationMs: Date.now() - started }
}

describe('respawn contract constants', () => {
  it('keeps the supervisor contract stable', () => {
    // scripts/omdsh.js hardcodes both values; a change here must change there.
    assert.equal(RELOAD_EXIT_CODE, 75)
    assert.equal(RELOAD_HANDOFF_ENV, 'OMDSH_RELOAD_HANDOFF')
  })
})

describe('nextGenerationArgs', () => {
  it('resumes the live session from a bare invocation', () => {
    assert.deepEqual(nextGenerationArgs([], 'tui-abc'), ['--resume', 'tui-abc'])
  })

  it('replaces a previous --resume identity', () => {
    assert.deepEqual(
      nextGenerationArgs(['--resume', 'old-id'], 'new-id'),
      ['--resume', 'new-id'],
    )
  })

  it('replaces a previous --session identity', () => {
    assert.deepEqual(
      nextGenerationArgs(['--session', 'old-id'], 'new-id'),
      ['--resume', 'new-id'],
    )
  })

  it('replaces inline --resume=/--session= forms', () => {
    assert.deepEqual(
      nextGenerationArgs(['--resume=old', '--session=older'], 'new-id'),
      ['--resume', 'new-id'],
    )
  })

  it('keeps foreign app flags in argv order', () => {
    assert.deepEqual(
      nextGenerationArgs(['--wechat', 'on', '--session', 'old', '--verbose'], 'new-id'),
      ['--wechat', 'on', '--verbose', '--resume', 'new-id'],
    )
  })

  it('does not consume a value for a trailing identity flag', () => {
    assert.deepEqual(nextGenerationArgs(['--flag', '--resume'], 'new-id'), ['--flag', '--resume', 'new-id'])
  })

  it('recreates a blank session fresh under the same id via --session', () => {
    assert.deepEqual(
      nextGenerationArgs(['--session', 'blank-id'], 'blank-id', '--session'),
      ['--session', 'blank-id'],
    )
  })

  it('switches an originally resumed session to --session when it stays blank', () => {
    assert.deepEqual(
      nextGenerationArgs(['--resume', 'blank-id'], 'blank-id', '--session'),
      ['--session', 'blank-id'],
    )
  })
})

describe('armExitWatchdog', () => {
  it('force-exits a process whose event loop is held by a leaked handle', () => {
    const { status } = runChild(`
      const { armExitWatchdog } = await import(${JSON.stringify(RESPAWN_MODULE_URL)})
      setInterval(() => {}, 1_000) // the leaked keep-alive handle
      armExitWatchdog(75, 400)
    `)
    assert.equal(status, 75)
  })

  it('never delays a clean natural exit (the timer is unref’d)', () => {
    const { status, durationMs } = runChild(`
      const { armExitWatchdog } = await import(${JSON.stringify(RESPAWN_MODULE_URL)})
      armExitWatchdog(75, 60_000)
    `)
    assert.equal(status, 0)
    assert.ok(durationMs < 10_000, `natural exit took ${durationMs}ms`)
  })
})

describe('writeReloadHandoff', () => {
  it('round-trips the next generation arguments as JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'respawn-spec-'))
    try {
      const file = join(dir, 'handoff.json')
      writeReloadHandoff(file, { args: ['--resume', 'tui-abc'] })
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as { args: string[] }
      assert.deepEqual(parsed, { args: ['--resume', 'tui-abc'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
