import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Prove the supervisor-based /reload: under omdsh, /reload replaces the dsh
 * process (new module graph, so changed installed plugin code takes effect),
 * resumes the same session through --resume with its transcript replayed, and
 * keeps the supervisor — and therefore the terminal — alive across generations.
 *
 * A controlled network-free model settles one turn first, so the session
 * crosses the persistence gate and the reload takes the --resume path.
 */
export async function run(tui) {
  const packageName = 'dsh-live-reload-fixture'
  const turnEnded = tui.marker('reload-turn-ended')
  const nodeOptionsMarker = tui.marker('reload-node-options')
  rmSync(turnEnded, { force: true })
  rmSync(nodeOptionsMarker, { force: true })

  const fixture = tui.packFixture({
    name: packageName,
    patch: [
      '- insert:',
      '    - id: live-reload-llm',
      `      name: '${packageName}'`,
      '- id: agent-default-model',
      '  config:',
      '    provider: reload-fixture',
      '    model: controlled',
      '',
    ].join('\n'),
    source: [
      "import { writeFileSync } from 'node:fs'",
      "import { join } from 'node:path'",
      "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
      "export const inject = ['llm']",
      'class ControlledAdapter extends LlmAdapter {',
      '  async resolveModel(provider, model) {',
      "    return { provider, id: model, name: model, reasoning: { efforts: [{ id: 'max', name: 'Max' }], defaultEffort: 'max' } }",
      '  }',
      '  async * stream() {',
      "    yield { type: 'block-start', index: 0, blockType: 'text' }",
      "    yield { type: 'text-delta', index: 0, text: 'CONTROLLED_REPLY_OK' }",
      "    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'CONTROLLED_REPLY_OK' } }",
      "    yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }",
      "    yield { type: 'finish', reason: { kind: 'stop' } }",
      '  }',
      '}',
      'export function apply(ctx) {',
      "  writeFileSync(join(process.env.DSH_HOME, 'reload-node-options'), process.env.NODE_OPTIONS ?? '')",
      "  ctx.llm.registerAdapter(['reload-fixture'], new ControlledAdapter())",
      "  ctx.on('session/event', (session, event) => {",
      "    if (event.type !== 'turn/end') return",
      "    writeFileSync(join(process.env.DSH_HOME, 'reload-turn-ended'), String(process.pid))",
      '  })',
      '}',
      '',
    ].join('\n'),
  })
  tui.runDsh(['plugin', '--profile', 'tui', 'add', fixture])

  await tui.startSupervised()
  await tui.waitForOutput(/欢迎回来|Welcome back/, {
    timeoutMs: 60_000,
    label: 'first-generation welcome screen',
  })
  const pidBefore = tui.pid()
  const supervisorPid = tui.terminal.pid
  await tui.waitFor(() => existsSync(nodeOptionsMarker), 5_000, 'launcher warning suppression marker')
  const nodeOptions = readFileSync(nodeOptionsMarker, 'utf8')
  if (!nodeOptions.includes('--disable-warning=ExperimentalWarning')) {
    throw new Error(`TUI process did not inherit warning suppression: ${nodeOptions}`)
  }

  // One settled turn moves the session across the persistence gate, so the
  // reload can prove real --resume continuity instead of blank re-creation.
  tui.submit('RELOAD_CONTINUITY_PROBE')
  await tui.waitForOutput('CONTROLLED_REPLY_OK', { timeoutMs: 30_000, label: 'controlled model reply' })
  await tui.waitFor(() => existsSync(turnEnded), 15_000, 'settled first turn')

  // Change the INSTALLED plugin code. Only a fresh process (fresh module
  // graph) can render the marker; the running generation already imported
  // the old module and can never show it.
  const entry = join(
    tui.config.dshHome, 'profiles', 'tui', 'node_modules', 'dsh-omp-tui', 'lib', 'index.js',
  )
  const source = readFileSync(entry, 'utf8')
  const changed = source
    .replaceAll('欢迎回来！', 'RESPAWN_RELOAD_OK')
    .replaceAll('Welcome back!', 'RESPAWN_RELOAD_OK')
  if (changed === source) throw new Error('installed TUI entry did not contain a welcome marker')
  writeFileSync(entry, changed)

  const offset = tui.mark()
  const reloadStartedAt = Date.now()
  tui.submit('/reload')
  await tui.waitForOutput(/正在启动新一代进程|starting a new generation/i, {
    since: offset,
    timeoutMs: 30_000,
    label: 'supervisor starts replacement generation',
  })
  const shutdownMs = Date.now() - reloadStartedAt
  await tui.waitForOutput('RESPAWN_RELOAD_OK', {
    since: offset,
    timeoutMs: 60_000,
    label: 'second-generation welcome marker',
  })
  // The resumed transcript replays the first generation's conversation.
  await tui.waitForOutput('RELOAD_CONTINUITY_PROBE', {
    since: offset,
    timeoutMs: 30_000,
    label: 'replayed user message after resume',
  })

  let pidAfter
  await tui.waitFor(() => {
    try {
      pidAfter = tui.pid()
    } catch {
      return false
    }
    return pidAfter !== pidBefore
  }, 15_000, 'a replacement DSH process id')

  if (tui.terminal.pid !== supervisorPid) {
    throw new Error(`supervisor process changed: ${supervisorPid} -> ${tui.terminal.pid}`)
  }
  const commandLine = tui.commandLine(pidAfter)
  if (!commandLine.includes(`--resume ${tui.session}`) && !commandLine.includes(`--resume "${tui.session}"`)) {
    throw new Error(`second generation did not resume the session: ${commandLine}`)
  }

  const reloadMs = Date.now() - reloadStartedAt
  const startupMs = reloadMs - shutdownMs
  const screenshot = await tui.snapshot('reload-respawn')
  return {
    reloadMs,
    shutdownMs,
    startupMs,
    experimentalWarningsSuppressed: true,
    newCodeLoaded: true,
    processReplaced: true,
    sessionResumed: true,
    transcriptReplayed: true,
    supervisorStable: true,
    pidBefore,
    pidAfter,
    supervisorPid,
    screenshot,
  }
}
