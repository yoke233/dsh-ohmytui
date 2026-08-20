[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Scenario,

  [string]$ProjectRoot,

  [switch]$KeepArtifacts,

  [switch]$AllowModelRequests
)

$ErrorActionPreference = 'Stop'
$skillRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = [IO.Path]::GetFullPath((Join-Path $skillRoot '..\..\..'))
}
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

if (Test-Path -LiteralPath $Scenario -PathType Leaf) {
  $scenarioPath = (Resolve-Path -LiteralPath $Scenario).Path
} else {
  $scenarioPath = Join-Path $skillRoot "scenarios\$Scenario.mjs"
  if (-not (Test-Path -LiteralPath $scenarioPath -PathType Leaf)) {
    throw "Unknown scenario '$Scenario'. Use a built-in name or a .mjs path."
  }
}

foreach ($command in @('node', 'pnpm', 'dsh')) {
  if ($null -eq (Get-Command $command -ErrorAction SilentlyContinue)) {
    throw "Required command '$command' is not available on PATH."
  }
}

function Invoke-Logged {
  param(
    [Parameter(Mandatory = $true)][string]$Command,
    [Parameter(Mandatory = $true)][string[]]$Arguments,
    [Parameter(Mandatory = $true)][string]$WorkingDirectory,
    [Parameter(Mandatory = $true)][string]$LogPath
  )

  Push-Location -LiteralPath $WorkingDirectory
  try {
    # Windows PowerShell wraps native stderr records as non-terminating errors;
    # keep them in the command log and let the process exit code own failure.
    $ErrorActionPreference = 'Continue'
    & $Command @Arguments *> $LogPath
    $status = $LASTEXITCODE
  } finally {
    Pop-Location
  }
  if ($status -ne 0) {
    Get-Content -LiteralPath $LogPath | Out-Host
    throw "$Command exited with code $status."
  }
}

$id = 'dsh-tui-live-' + [Guid]::NewGuid().ToString('N')
$testRoot = Join-Path ([IO.Path]::GetTempPath()) $id
$dshHome = Join-Path $testRoot 'dsh-home'
$artifacts = Join-Path $testRoot 'artifacts'
$harnessRoot = Join-Path $testRoot 'harness'
New-Item -ItemType Directory -Path $dshHome, $artifacts, $harnessRoot -Force | Out-Null

$hadDshHome = Test-Path Env:DSH_HOME
$previousDshHome = $env:DSH_HOME
$success = $false

try {
  Invoke-Logged -Command 'pnpm' `
    -Arguments @('pack', '--pack-destination', $artifacts) `
    -WorkingDirectory $ProjectRoot `
    -LogPath (Join-Path $artifacts 'pack-tui.log')

  $tuiPackage = Get-ChildItem -LiteralPath $artifacts -Filter 'dsh-omp-tui-*.tgz' |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1 -ExpandProperty FullName
  if ([string]::IsNullOrWhiteSpace($tuiPackage)) {
    throw 'pnpm pack did not produce a dsh-omp-tui tarball.'
  }

  $env:DSH_HOME = $dshHome
  Invoke-Logged -Command 'dsh' `
    -Arguments @('plugin', '--profile', 'tui', 'add', $tuiPackage) `
    -WorkingDirectory $ProjectRoot `
    -LogPath (Join-Path $artifacts 'install-tui.log')

  '{"private":true,"type":"module"}' |
    Set-Content -LiteralPath (Join-Path $harnessRoot 'package.json') -NoNewline
  $harnessPackages = @('add', 'node-pty@1.1.0', '@xterm/headless@5.5.0')
  if ($KeepArtifacts) { $harnessPackages += 'sharp@0.34.5' }
  Invoke-Logged -Command 'pnpm' `
    -Arguments $harnessPackages `
    -WorkingDirectory $harnessRoot `
    -LogPath (Join-Path $artifacts 'install-harness.log')

  $config = [ordered]@{
    id = $id
    projectRoot = $ProjectRoot
    dshHome = $dshHome
    artifacts = $artifacts
    harnessRoot = $harnessRoot
    keepArtifacts = [bool]$KeepArtifacts
    allowModelRequests = [bool]$AllowModelRequests
  }
  $configPath = Join-Path $testRoot 'config.json'
  $config | ConvertTo-Json | Set-Content -LiteralPath $configPath

  & node (Join-Path $PSScriptRoot 'run-scenario.mjs') $configPath $scenarioPath
  if ($LASTEXITCODE -ne 0) {
    throw "Live TUI scenario exited with code $LASTEXITCODE."
  }
  $success = $true
} finally {
  if ($hadDshHome) {
    $env:DSH_HOME = $previousDshHome
  } else {
    Remove-Item Env:DSH_HOME -ErrorAction SilentlyContinue
  }

  if ($success -and -not $KeepArtifacts) {
    Remove-Item -LiteralPath $testRoot -Recurse -Force
    Write-Host "Live TUI artifacts cleaned: $testRoot"
  } else {
    Write-Host "Live TUI artifacts retained: $testRoot"
  }
}
