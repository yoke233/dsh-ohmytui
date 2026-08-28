# Live TUI scenario API

A scenario is an ESM file exporting `async function run(tui)`. It must start the TUI and return a JSON-serializable acceptance report containing at least one successful boolean assertion; throw when an assertion fails. The runner always stops the terminal and saves `pty-output.log` on retained or failed runs.

## Lifecycle

```js
await tui.start(['--optional-dsh-argument'])
await tui.waitForOutput(/欢迎回来|Welcome back/, { timeoutMs: 30_000 })
// assertions
return { behaviorObserved: true }
```

Call `start()` once. The runner calls `stop()` in `finally`.

## Input

```js
tui.submit('/help')       // text plus Enter
tui.key('\x1b')           // Escape
tui.key('\x1b[A')         // Up
tui.key('\x1b[B')         // Down
tui.key('\t')             // Tab
tui.key(' ')              // one raw character
tui.key('\x03')           // Ctrl+C
```

Use `submit()` for slash commands and normal prompts. Use `key()` for dialogs, completion, and control sequences.

## Assertions

```js
const offset = tui.mark()
await tui.waitForOutput(/transient notice/, {
  since: offset,
  timeoutMs: 15_000,
  label: 'notice',
})

await tui.waitForScreen(/currently visible dialog/, {
  timeoutMs: 15_000,
  label: 'dialog',
})

const screen = await tui.screenText()
const output = tui.plainOutput(offset)
```

`waitForOutput()` observes the VT stream and can match content that has since been overwritten. `waitForScreen()` and `screenText()` inspect the reconstructed current viewport and are the correct seam for dialogs, autocomplete menus, and full-screen replacement.

For autocomplete scenarios, the welcome frame is not a readiness signal. Agent preset composition can replace the autocomplete provider after that frame and cancel an in-flight menu request. Probe until a slash menu survives the refresh:

```js
await tui.waitForSlashMenu()
// The editor now contains `/` and a visible command menu. Continue with key().
```

The helper clears the draft and retries `/` until a current-screen menu assertion passes. Use it instead of a fixed startup sleep.

For a non-text side effect:

```js
import { existsSync } from 'node:fs'
const marker = tui.marker('feature-completed')
await tui.waitFor(() => existsSync(marker), 10_000, 'feature marker')
```

## Screenshots

Invoke the runner with `-KeepArtifacts`, then call:

```js
const files = await tui.snapshot('settings-dialog')
```

Without `-KeepArtifacts`, `snapshot()` returns `{ captured: false }` and avoids image encoding. With retained artifacts it writes:

- `settings-dialog.txt`: current visible cells;
- `settings-dialog.svg`: deterministic cell/color rendering;
- `settings-dialog.png`: rasterized SVG for issue or PR attachment.

The renderer fixes each glyph to its xterm cell span and preserves RGB/256-color cell state, producing a deterministic layout/color artifact. Use a native Windows Terminal screenshot only when the claim concerns OS font rasterization, ligatures, or window chrome.

## Process continuity

```js
const before = tui.pid()
// interaction
const after = tui.pid()
if (before !== after) throw new Error(`PID changed: ${before} -> ${after}`)
```

Check PID whenever the feature promises to preserve the live TUI or process state.

## Isolated Profile operations

```js
tui.runDsh(['plugin', '--profile', 'tui', 'add', tarball])
tui.runDsh(['plugin', '--profile', 'tui', 'remove', packageName])
```

All commands inherit the temporary `DSH_HOME`.

Create a package fixture without touching the repository:

```js
const tarball = tui.packFixture({
  name: 'dsh-live-fixture',
  patch: `- insert:\n    - id: live-fixture\n      name: 'dsh-live-fixture'\n`,
  source: `export function apply(ctx) { /* observable behavior */ }\n`,
})
```

Use a unique package and row id per scenario. Make fixture execution observable through output, a marker, or a registered service.

## Artifact inspection

Use `-KeepArtifacts` on the PowerShell runner. `report.json`, screenshots, package/install logs, the isolated Profile, and `pty-output.log` are written below the printed artifact directory. Custom scenarios are trusted code rather than an OS sandbox. The TUI child receives no common key/token/secret environment variables unless the runner is explicitly invoked with `-AllowModelRequests`.
