#!/usr/bin/env node
// omdsh: dsh-omp-tui 启动器（Node 实现，跨平台 bin 入口）。
// 只负责调用系统 PATH 中官方 dsh 的独立进程，并启动 tui profile。
// 本项目不下载、不缓存 dsh；首次运行时自动把本包安装进 tui profile，
// 之后检测到 profile 内版本低于启动器版本时自动更新。
//
// 环境变量：
//   DSH_REAL             显式指定 dsh 可执行文件
//   DSH_DEBUG=1          只打印将要执行的命令
//   OMDSH_NO_BOOTSTRAP=1 跳过首次运行/自动更新的 profile 引导

import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const PACKAGE = 'dsh-omp-tui'
const PROFILE = 'tui'
const ownPackageJson = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)
const ownVersion = ownPackageJson.version

const launcherHelp = `omdsh — dsh-omp-tui 启动器

用法:
  omdsh [参数...]

说明:
  omdsh 会调用系统 PATH 中的官方 dsh，并启动 --profile tui。
  首次运行时自动把 dsh-omp-tui 安装到 tui profile；之后若 profile
  内版本低于启动器版本，也会自动更新（可通过 OMDSH_NO_BOOTSTRAP=1
  跳过）。所有参数原样透传给 dsh（例如 --resume <session>、
  --session <session>）。
  官方 dsh 命令（web/plugin/--profile/--patch 等）请直接使用 dsh。

环境变量:
  DSH_REAL             显式指定 dsh 可执行文件
  DSH_DEBUG=1          只打印将要执行的命令
  OMDSH_NO_BOOTSTRAP=1 跳过 profile 引导安装/自动更新
`

const args = process.argv.slice(2)
if (args[0] === '-h' || args[0] === '--help') {
  process.stdout.write(launcherHelp)
  process.exit(0)
}

const dsh = process.env.DSH_REAL || 'dsh'
const spawnArgs = ['--profile', PROFILE, ...args]
const isWin = process.platform === 'win32'
const EXPERIMENTAL_WARNING_OPTION = '--disable-warning=ExperimentalWarning'
const dshNodeOptions = process.env.NODE_OPTIONS?.includes(EXPERIMENTAL_WARNING_OPTION)
  ? process.env.NODE_OPTIONS
  : `${process.env.NODE_OPTIONS ?? ''} ${EXPERIMENTAL_WARNING_OPTION}`.trim()

function fail(message, code = 1) {
  process.stderr.write(`omdsh: ${message}\n`)
  process.exit(code)
}

/** cmd.exe 以空格拼接参数；含空格/元字符的参数需要双引号包裹。 */
function shellQuote(arg) {
  return /[ \t"^&|<>()]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg
}

/**
 * Windows：Node ≥18 的安全限制要求 .cmd 经 shell 启动；Node ≥22 对
 * `shell:true + 非空 args 数组` 会告警（DEP0190）。因此把转义后的命令
 * 拼成一个字符串传入，非 Windows 保持数组直传。
 */
function runSync(command, args, opts = {}) {
  if (isWin) {
    const line = [command, ...args].map(shellQuote).join(' ')
    return spawnSync(line, [], { ...opts, shell: true })
  }
  return spawnSync(command, args, opts)
}

function run(command, args, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv }
  if (isWin) {
    const line = [command, ...args].map(shellQuote).join(' ')
    return spawn(line, [], { stdio: 'inherit', shell: true, env })
  }
  return spawn(command, args, { stdio: 'inherit', env })
}

function packageRoot() {
  const root = fileURLToPath(new URL('..', import.meta.url))
  return root.replace(/\\/g, '/').replace(/\/+$/, '')
}

function installedProfileVersion() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const pkgPath = path.join(dshHome, 'profiles', PROFILE, 'node_modules', PACKAGE, 'package.json')
  try {
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version
  } catch {
    return undefined
  }
}

function compareVersions(a, b) {
  const aParts = a.split('-')[0].split('.').map(Number)
  const bParts = b.split('-')[0].split('.').map(Number)
  const length = Math.max(aParts.length, bParts.length)
  for (let i = 0; i < length; i++) {
    const av = aParts[i] ?? 0
    const bv = bParts[i] ?? 0
    if (av !== bv) return av - bv
  }
  return 0
}

/** 用 dsh plugin add 把当前启动器目录安装/更新到 tui profile。 */
function addToProfile() {
  const runAdd = extraArgs => runSync(
    dsh,
    ['plugin', '--profile', PROFILE, 'add', ...extraArgs, `file:${packageRoot()}`],
    { stdio: ['inherit', 'inherit', 'pipe'] },
  )
  let result = runAdd([])
  if (result.status !== 0 && String(result.stderr).includes('ERR_PNPM_ADDING_TO_ROOT')) {
    process.stderr.write('omdsh: pnpm 拒绝写入 workspace 根（ERR_PNPM_ADDING_TO_ROOT），带 -w 重试…\n')
    result = runAdd(['-w'])
  }
  return result
}

function ensureProfile() {
  if (process.env.OMDSH_NO_BOOTSTRAP === '1') {
    if (installedProfileVersion() === undefined) {
      fail('已跳过 profile 引导安装，但 tui profile 尚未安装 dsh-omp-tui。')
    }
    return
  }

  const installedVersion = installedProfileVersion()
  if (installedVersion === undefined) {
    // 先探测 dsh 和 pnpm，避免 add 执行到一半才报缺依赖。
    const dshProbe = runSync(dsh, ['--version'], { stdio: 'pipe' })
    if (dshProbe.error || dshProbe.status !== 0) {
      fail('未检测到 dsh CLI。请先安装官方客户端：npm install -g @deepseek-ai/dsh')
    }
    const pnpmProbe = runSync('pnpm', ['--version'], { stdio: 'pipe' })
    if (pnpmProbe.error || pnpmProbe.status !== 0) {
      fail('首次安装需要 pnpm。请先安装：npm install -g pnpm（或启用 corepack：corepack enable pnpm）')
    }

    process.stderr.write(`omdsh: 首次运行，正在初始化 ${PROFILE} profile（${PACKAGE}@${ownVersion}）…\n`)
    const result = addToProfile()
    if (result.status !== 0) {
      fail('插件安装失败。可稍后手工重试：dsh plugin --profile tui add <tgz 或 file:包路径>')
    }
    return
  }

  if (installedVersion === ownVersion) return

  if (compareVersions(installedVersion, ownVersion) > 0) {
    process.stderr.write(
      `omdsh: 提示：profile 内运行的是 v${installedVersion}，而启动器是 v${ownVersion}。` +
      `启动器较旧，跳过自动更新。\n`,
    )
    return
  }

  process.stderr.write(
    `omdsh: 检测到 profile 内 dsh-omp-tui 为 v${installedVersion}，正在自动更新到 v${ownVersion}…\n`,
  )
  const result = addToProfile()
  if (result.status !== 0) {
    fail(
      `自动更新失败。可稍后手工执行：dsh plugin --profile ${PROFILE} add file:${packageRoot()}`,
    )
  }
  process.stderr.write(`omdsh: profile 已更新为 v${installedProfileVersion() ?? ownVersion}。\n`)
}

if (process.env.DSH_DEBUG === '1') {
  ensureProfile()
  process.stdout.write(`omdsh → ${dsh} ${spawnArgs.join(' ')}\n`)
  process.exit(0)
}

ensureProfile()

// --- 世代重启（/reload）--------------------------------------------------
// omdsh 是稳定监督进程：dsh 子进程以 RELOAD_EXIT_CODE 优雅退出并把下一代
// 的内层参数写入 handoff 文件后，omdsh 在同一终端上启动新一代 dsh 进程。
// 新进程 = 全新模块图，任何插件/依赖/配置变化都随之生效；会话通过
// handoff 中的 --resume 续接。
const RELOAD_EXIT_CODE = 75
const handoffPath = path.join(os.tmpdir(), `omdsh-reload-${process.pid}.json`)

/** 读取并消费一次 handoff；缺失或损坏时返回 undefined（按普通退出处理）。 */
function readHandoffArgs() {
  let raw
  try {
    raw = fs.readFileSync(handoffPath, 'utf8')
  } catch {
    return undefined
  }
  try {
    fs.unlinkSync(handoffPath)
  } catch {
    // 留下的临时文件在下一次读取时会被消费或忽略。
  }
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.args) && parsed.args.every(item => typeof item === 'string')) {
      return parsed.args
    }
  } catch {
    // 损坏的 handoff 不阻止退出码原样透传。
  }
  return undefined
}

/** 运行一代交互式 dsh，等待其退出并回报退出方式。 */
function runGeneration(innerArgs) {
  return new Promise((settle) => {
    // /reload 的第一时间反馈：TUI 在请求退出前先写 handoff 文件，而旧进程的
    // 优雅析构（最长 10s 看门狗）会推迟退出码路径。监视 handoff 出现即播报，
    // 让用户在析构空窗期就知道 reload 已被受理，而不是等子进程真正退出。
    let announced = false
    fs.watchFile(handoffPath, { interval: 300 }, (curr) => {
      if (announced || curr.mtimeMs === 0) return
      announced = true
      process.stderr.write('\nomdsh: 收到重载请求，正在关闭当前进程…\n')
    })
    const finish = (outcome) => {
      fs.unwatchFile(handoffPath)
      settle(outcome)
    }
    const child = run(dsh, ['--profile', PROFILE, ...innerArgs], {
      OMDSH_RELOAD_HANDOFF: handoffPath,
      NODE_OPTIONS: dshNodeOptions,
    })
    child.on('error', (err) => {
      if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
        process.stderr.write('omdsh: 未在 PATH 中找到官方 dsh。\n')
        process.stderr.write('omdsh: 请先安装 @deepseek-ai/dsh（例如: npm install -g @deepseek-ai/dsh）。\n')
        finish({ failedCode: 127 })
        return
      }
      process.stderr.write(`omdsh: 启动 dsh 失败: ${String(err)}\n`)
      finish({ failedCode: 1 })
    })
    child.on('exit', (code, signal) => finish({ code, signal }))
  })
}

// 交互期间监督进程忽略 SIGINT：raw 模式下 Ctrl+C 由 TUI 子进程自行处理
// （双击退出），非 raw 阶段信号发给整个前台进程组，子进程退出后监督进程
// 通过退出码路径收尾——它必须活到那一刻才能在 reload 上重启新一代。
process.on('SIGINT', () => {})

let innerArgs = args
for (;;) {
  const result = await runGeneration(innerArgs)
  if (result.failedCode !== undefined) process.exit(result.failedCode)
  if (result.signal !== null && result.signal !== undefined) {
    process.exit(result.signal === 'SIGINT' ? 130 : 1)
  }
  if (result.code === RELOAD_EXIT_CODE) {
    const nextArgs = readHandoffArgs()
    if (nextArgs !== undefined) {
      process.stderr.write('omdsh: 正在启动新一代进程并续接会话…\n')
      // 重启前重跑引导检查：profile 内刚更新的插件版本由新一代进程载入。
      ensureProfile()
      innerArgs = nextArgs
      continue
    }
    // 没有 handoff 的 75 不属于 reload 契约，按普通退出码透传。
  }
  process.exit(result.code ?? 0)
}
