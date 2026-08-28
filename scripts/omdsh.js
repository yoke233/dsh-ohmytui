#!/usr/bin/env node
// omdsh: @yoke233/omdsh 启动器（Node 实现，跨平台 bin 入口）。
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
import { downloadReleaseAsset, fetchLatestRelease, releaseVersion } from './omdsh-update.js'

const PACKAGE = '@yoke233/omdsh'
const LEGACY_PACKAGES = ['dsh-omp-tui']
const PROFILE = 'tui'
const ownPackageJson = JSON.parse(
  fs.readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
)
const ownVersion = ownPackageJson.version

const launcherHelp = `omdsh — @yoke233/omdsh 启动器

用法:
  omdsh [参数...]
  omdsh update [--force]

说明:
  omdsh 会调用系统 PATH 中的官方 dsh，并启动 --profile tui。
  omdsh update 从 GitHub 最新 Release 下载校验后的 tarball，并安装到 tui profile。
  首次运行时自动把 @yoke233/omdsh 安装到 tui profile；之后若 profile
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
function profileRoot() {
  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  return path.join(dshHome, 'profiles', PROFILE)
}

function missingProfileDependencies() {
  return Object.keys(ownPackageJson.dependencies ?? {}).filter(name =>
    !fs.existsSync(path.join(profileRoot(), 'node_modules', ...name.split('/'), 'package.json')))
}
function profileManifest() {
  try {
    return JSON.parse(fs.readFileSync(path.join(profileRoot(), 'package.json'), 'utf8'))
  } catch {
    return undefined
  }
}

function profilePackageSpecifier() {
  return profileManifest()?.dependencies?.[PACKAGE]
}

function legacyProfilePackages() {
  const manifest = profileManifest()
  return LEGACY_PACKAGES.filter(name => manifest?.dependencies?.[name] !== undefined)
}

function probeInstallTools() {
  const dshProbe = runSync(dsh, ['--version'], { stdio: 'pipe' })
  if (dshProbe.error || dshProbe.status !== 0) {
    fail('未检测到 dsh CLI。请先安装官方客户端：npm install -g @deepseek-ai/dsh')
  }
  const pnpmProbe = runSync('pnpm', ['--version'], { stdio: 'pipe' })
  if (pnpmProbe.error || pnpmProbe.status !== 0) {
    fail('安装或更新需要 pnpm。请先安装：npm install -g pnpm（或启用 corepack：corepack enable pnpm）')
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

function removeLegacyProfilePackages() {
  for (const legacy of legacyProfilePackages()) {
    process.stderr.write(`omdsh: 正在迁移旧 bundle ${legacy} → ${PACKAGE}…\n`)
    const removed = runSync(
      dsh,
      ['plugin', '--profile', PROFILE, 'remove', legacy],
      { stdio: ['inherit', 'inherit', 'pipe'] },
    )
    if (removed.status !== 0) return removed
  }
  return undefined
}

function installStoredTarball(storedTarball) {
  const removalFailure = removeLegacyProfilePackages()
  if (removalFailure !== undefined) return removalFailure

  const linkedPackage = path.join(profileRoot(), 'node_modules', ...PACKAGE.split('/'))
  try {
    if (fs.lstatSync(linkedPackage).isSymbolicLink()) {
      fs.rmSync(linkedPackage, { recursive: true, force: true })
    }
  } catch {
    // Fresh profiles have no installed package to unlink.
  }
  const runAdd = extraArgs => runSync(
    dsh,
    ['plugin', '--profile', PROFILE, 'add', ...extraArgs, storedTarball],
    { stdio: ['inherit', 'inherit', 'pipe'] },
  )
  let result = runAdd([])
  if (result.status !== 0 && String(result.stderr).includes('ERR_PNPM_ADDING_TO_ROOT')) {
    process.stderr.write('omdsh: pnpm 拒绝写入 workspace 根（ERR_PNPM_ADDING_TO_ROOT），带 -w 重试…\n')
    result = runAdd(['-w'])
  }
  return result
}

/** 打包后安装，避免 pnpm 将 file:目录降为不安装依赖的 link:。 */
function addToProfile() {
  const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omdsh-pack-'))
  try {
    const packed = runSync(
      'pnpm',
      ['pack', '--pack-destination', packDir],
      { cwd: packageRoot(), stdio: ['ignore', 'inherit', 'pipe'] },
    )
    if (packed.status !== 0) return packed
    const tarball = fs.readdirSync(packDir)
      .filter(name => name.endsWith('.tgz'))
      .map(name => path.join(packDir, name))[0]
    if (tarball === undefined) {
      return { status: 1, stderr: 'pnpm pack did not produce a .tgz archive' }
    }
    const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    const packageCache = path.join(dshHome, 'profile-packages', PROFILE)
    fs.mkdirSync(packageCache, { recursive: true })
    const storedTarball = path.join(packageCache, path.basename(tarball))
    fs.copyFileSync(tarball, storedTarball)
    return installStoredTarball(storedTarball)
  } finally {
    fs.rmSync(packDir, { recursive: true, force: true })
  }
}

function ensureProfile() {
  if (process.env.OMDSH_NO_BOOTSTRAP === '1') {
    if (installedProfileVersion() === undefined) {
      fail('已跳过 profile 引导安装，但 tui profile 尚未安装 @yoke233/omdsh。')
    }
    return
  }

  const installedVersion = installedProfileVersion()
  if (installedVersion === undefined) {
    // 先探测 dsh 和 pnpm，避免 add 执行到一半才报缺依赖。
    probeInstallTools()

    process.stderr.write(`omdsh: 首次运行，正在初始化 ${PROFILE} profile（${PACKAGE}@${ownVersion}）…\n`)
    const result = addToProfile()
    if (result.status !== 0) {
      fail('插件安装失败。可稍后手工重试：dsh plugin --profile tui add <tgz 或 file:包路径>')
    }
    return
  }

  const removalFailure = removeLegacyProfilePackages()
  if (removalFailure !== undefined) {
    fail(`旧 bundle 迁移失败：${String(removalFailure.stderr || removalFailure.error || 'unknown error').trim()}`)
  }

  const missingDependencies = missingProfileDependencies()
  const linkedInstall = String(profilePackageSpecifier() ?? '').startsWith('link:')
  if (installedVersion === ownVersion && missingDependencies.length === 0 && !linkedInstall) return
  if (installedVersion === ownVersion) {
    const reasons = [
      ...linkedInstall ? ['当前安装是不会携带依赖的 link: 目录'] : [],
      ...missingDependencies.length === 0 ? [] : [`缺少运行依赖 ${missingDependencies.join(', ')}`],
    ]
    process.stderr.write(
      `omdsh: profile ${reasons.join('；')}，正在重新安装 ${PACKAGE}@${ownVersion}…\n`,
    )
    const result = addToProfile()
    if (result.status !== 0) {
      fail(`profile 依赖修复失败：${String(result.stderr || 'unknown error').trim()}`)
    }
    return
  }

  // A launcher older than the already-installed Profile bundle has nothing to
  // repair or upgrade. Keep this normal bootstrap decision silent.
  if (compareVersions(installedVersion, ownVersion) > 0) return

  process.stderr.write(
    `omdsh: 检测到 profile 内 @yoke233/omdsh 为 v${installedVersion}，正在自动更新到 v${ownVersion}…\n`,
  )
  const result = addToProfile()
  if (result.status !== 0) {
    fail(
      `自动更新失败。可稍后手工执行：pnpm pack 后运行 dsh plugin --profile ${PROFILE} add <tgz>`,
    )
  }
  process.stderr.write(`omdsh: profile 已更新为 v${installedProfileVersion() ?? ownVersion}。\n`)
}

async function updateProfileFromGitHub(force) {
  probeInstallTools()
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
  process.stderr.write('omdsh: 正在查询 GitHub 最新 Release…\n')
  const release = await fetchLatestRelease({ token })
  const latestVersion = releaseVersion(release)
  const installedVersion = installedProfileVersion()
  if (
    !force
    && legacyProfilePackages().length === 0
    && installedVersion !== undefined
    && compareVersions(installedVersion, latestVersion) >= 0
  ) {
    process.stderr.write(`omdsh: tui profile 已是最新版本 v${installedVersion}。\n`)
    return
  }

  const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
  const packageCache = path.join(dshHome, 'profile-packages', PROFILE)
  process.stderr.write(`omdsh: 正在下载 @yoke233/omdsh v${latestVersion}…\n`)
  const downloaded = await downloadReleaseAsset(release, packageCache, { token })
  const result = installStoredTarball(downloaded.path)
  if (result.status !== 0) {
    fail(`GitHub Release 安装失败：${String(result.stderr || 'unknown error').trim()}`)
  }
  const installed = installedProfileVersion()
  if (installed !== latestVersion) {
    fail(`安装校验失败：期望 v${latestVersion}，实际 ${installed === undefined ? '未安装' : `v${installed}`}`)
  }
  process.stderr.write(`omdsh: tui profile 已更新为 v${installed}。当前 TUI 请执行 /reload。\n`)
}

if (args[0] === 'update') {
  const updateArgs = args.slice(1)
  if (updateArgs.some(arg => arg !== '--force')) fail('update 仅支持可选参数 --force。')
  try {
    await updateProfileFromGitHub(updateArgs.includes('--force'))
    process.exit(0)
  } catch (error) {
    fail(`更新失败：${error instanceof Error ? error.message : String(error)}`)
  }
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
    const announceReload = () => {
      if (announced) return
      announced = true
      process.stderr.write('\nomdsh: 正在重启 TUI 并恢复当前会话…\n')
    }
    fs.watchFile(handoffPath, { interval: 300 }, (curr) => {
      if (curr.mtimeMs !== 0) announceReload()
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
    child.on('exit', (code, signal) => {
      if (code === RELOAD_EXIT_CODE && fs.existsSync(handoffPath)) announceReload()
      finish({ code, signal })
    })
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
      // 重启前重跑引导检查：profile 内刚更新的插件版本由新一代进程载入。
      ensureProfile()
      innerArgs = nextArgs
      continue
    }
    // 没有 handoff 的 75 不属于 reload 契约，按普通退出码透传。
  }
  process.exit(result.code ?? 0)
}
