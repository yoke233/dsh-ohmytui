import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  it('uses one clear reload message and silently accepts a newer Profile bundle', () => {
    const launcher = readFileSync(new URL('../scripts/omdsh.js', import.meta.url), 'utf8')
    assert.equal((launcher.match(/正在重启 TUI 并恢复当前会话/g) ?? []).length, 1)
    assert.equal(launcher.includes('启动器较旧，跳过自动更新'), false)
    assert.equal(launcher.includes('正在启动新一代进程并续接会话'), false)
  })

  it('keeps the supervisor contract stable', () => {
    // scripts/omdsh.js hardcodes both values; a change here must change there.
    assert.equal(RELOAD_EXIT_CODE, 75)
    assert.equal(RELOAD_HANDOFF_ENV, 'OMDSH_RELOAD_HANDOFF')
  })
})

describe('launcher Profile migration', () => {
  it('removes a legacy bundle even when the current package version is already installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'omdsh-profile-migration-'))
    const profileRoot = join(root, 'profiles', 'tui')
    const manifestPath = join(profileRoot, 'package.json')
    const launcherPackage = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string; dependencies?: Record<string, string> }
    const dependencies = {
      '@yoke233/omdsh': 'file:current.tgz',
      'dsh-omp-tui': 'file:legacy.tgz',
    }
    const bundles = ['@deepseek-ai/dsh-base', '@yoke233/omdsh', 'dsh-omp-tui']

    try {
      mkdirSync(profileRoot, { recursive: true })
      writeFileSync(manifestPath, `${JSON.stringify({
        name: 'dsh-profile-tui',
        private: true,
        dependencies,
        dsh: { profile: { bundles } },
      }, undefined, 2)}\n`)

      const installedPackages = ['@yoke233/omdsh', ...Object.keys(launcherPackage.dependencies ?? {})]
      for (const name of installedPackages) {
        const packageJson = join(profileRoot, 'node_modules', ...name.split('/'), 'package.json')
        mkdirSync(dirname(packageJson), { recursive: true })
        writeFileSync(packageJson, JSON.stringify({
          name,
          version: name === '@yoke233/omdsh' ? launcherPackage.version : '0.0.0',
        }))
      }

      const fakeDshModule = join(root, 'fake-dsh.mjs')
      writeFileSync(fakeDshModule, `
        import fs from 'node:fs'
        import path from 'node:path'
        const args = process.argv.slice(2)
        if (args.slice(0, 5).join(' ') !== 'plugin --profile tui remove dsh-omp-tui') process.exit(2)
        const manifestPath = path.join(process.env.DSH_HOME, 'profiles', 'tui', 'package.json')
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
        delete manifest.dependencies['dsh-omp-tui']
        manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(
          name => name !== 'dsh-omp-tui',
        )
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\\n')
      `)
      const fakeDsh = process.platform === 'win32'
        ? join(root, 'dsh.cmd')
        : join(root, 'dsh')
      if (process.platform === 'win32') {
        writeFileSync(fakeDsh, `@echo off\r\n"${process.execPath}" "${fakeDshModule}" %*\r\n`)
      } else {
        writeFileSync(fakeDsh, `#!/bin/sh\nexec "${process.execPath}" "${fakeDshModule}" "$@"\n`)
        chmodSync(fakeDsh, 0o755)
      }

      const result = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/omdsh.js', import.meta.url))], {
        encoding: 'utf8',
        env: {
          ...process.env,
          DSH_DEBUG: '1',
          DSH_HOME: root,
          DSH_REAL: fakeDsh,
        },
      })
      assert.equal(result.status, 0, result.stderr)
      const migrated = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        dependencies: Record<string, string>
        dsh: { profile: { bundles: string[] } }
      }
      assert.equal(migrated.dependencies['dsh-omp-tui'], undefined)
      assert.equal(migrated.dsh.profile.bundles.includes('dsh-omp-tui'), false)
      assert.match(result.stderr, /正在迁移旧 bundle dsh-omp-tui/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
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

  it('keeps --yolo across generations', () => {
    assert.deepEqual(
      nextGenerationArgs(['--yolo', '--session', 'old-id'], 'new-id'),
      ['--yolo', '--resume', 'new-id'],
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
