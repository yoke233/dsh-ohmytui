---
name: test-dsh-tui
description: Use when testing or diagnosing any real terminal behavior in this repository's TUI, including startup, rendering, keyboard input, slash commands, autocomplete, dialogs, state retention, process continuity, or Profile plugin changes.
---

# Test the real DSH TUI

Test at the narrowest seam that proves the behavior, then use the packaged ConPTY harness when the claim depends on a live terminal, raw input, process identity, or assembled Profile.

## Safety boundary

Every live run uses a uniquely named `DSH_HOME`; the supplied runner enforces this and removes successful runs. Built-in fixtures perform no model request and write only inside that temporary root. The runner isolates DSH state, not the operating system: custom scenarios are trusted code and can access the repository, network, and parent process environment.

On PowerShell, name paths `$dshHome`; `$HOME` is a case-insensitive, read-only built-in. Install packed `.tgz` files in Windows test Profiles. A `file:D:/...` package spec can be resolved relative to the Profile and become an invalid mixed path.

## Choose the test seam

- Pure formatting, component behavior, key mapping, or state transition: add or run a focused `node:test` case.
- Real Loader composition without terminal input: use a Loader integration test such as `tests/reload.spec.ts`.
- Raw keyboard input, screen replacement, focus-sensitive flow, packaged exports, plugin discovery, or “same process” claims: use the ConPTY runner.
- Pixel/color appearance: combine the ConPTY screen snapshot with the relevant component width/theme tests. Text snapshots do not prove font rendering.

## Fast checks

From the repository root:

```powershell
pnpm run typecheck
pnpm exec node --test --experimental-transform-types "tests/<focused>.spec.ts"
```

Run `pnpm run check` before committing. Completion criterion: the focused behavior and every source-suite test pass.

## Live ConPTY tests

Run the packaged startup/help smoke scenario:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-dsh-tui/scripts/run-live-test.ps1 -Scenario smoke
```

The `reload` and `reload-code` scenarios are retained only as investigation fixtures while the bundle's reload module is disabled. Do not treat them as current acceptance tests; run them only when explicitly resuming the reload design.

Run the network-free, controlled-model scenario for running-turn input, immediate preview, and steer delivery:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-dsh-tui/scripts/run-live-test.ps1 -Scenario steer -KeepArtifacts
```

The runner builds and packs the current working tree, initializes an isolated `tui` Profile, starts real `dsh` in ConPTY, feeds input, and reconstructs the current terminal screen. With `-KeepArtifacts`, it records raw output plus text/SVG/PNG snapshots and installs `sharp` for PNG conversion; `node-pty` and `@xterm/headless` live only in the temporary harness. Common key/token/secret environment variables are withheld from the TUI by default.

A successful JSON report is the acceptance artifact. For process-continuity scenarios, every observed DSH PID must be identical; a rendered success message alone is insufficient. Use `-AllowModelRequests` only for an explicit real-model scenario that needs inherited credentials.

Use `-KeepArtifacts` to generate and retain `pty-output.log`, `.txt`/`.svg`/`.png` screen snapshots, the packed package, and the isolated Profile:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-dsh-tui/scripts/run-live-test.ps1 -Scenario smoke -KeepArtifacts
```

Failed runs are retained automatically and print their artifact directory.

## Custom scenarios

When a built-in scenario does not cover the behavior, read [references/scenario-api.md](references/scenario-api.md), copy [scenarios/template.mjs](scenarios/template.mjs), and pass its path:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-dsh-tui/scripts/run-live-test.ps1 -Scenario C:\path\to\scenario.mjs -KeepArtifacts
```

A scenario must assert observable behavior rather than merely sleep and exit. Prefer current-screen assertions for dialogs and replaced views, incremental-output assertions for transient notices, marker files for command execution, and PID comparison for process continuity.

## Manual operation

When reproducing against an already running TUI:

1. Record the DSH process PID.
2. Perform the external setup, such as installing a package with `dsh plugin --profile tui add <tarball>`.
3. Return to the same terminal and submit the relevant keys or slash command.
4. Assert both the terminal result and a second observable effect where practical.
5. Record the PID again and verify continuity when the behavior promises in-process state.
6. Exit with Ctrl+C twice and confirm the process tree is gone.

A running model turn intentionally blocks `/reload`; wait for the turn to settle before retrying.

## Linux branch

On Linux with `dsh` and `script` available, the repository also carries an opt-in launcher smoke test:

```sh
DSH_E2E=1 pnpm exec node --test --experimental-transform-types tests/e2e-smoke.spec.ts
```

## Failure triage

- Failure before the welcome screen: inspect `pty-output.log` for the complete plugin-tree error.
- Correct raw output but wrong current screen: assert with `screenText()` and inspect the saved snapshot; stale scrollback is not current UI state.
- Input has no effect: use `submit()` for a line, `key()` for raw control sequences, and wait for the welcome screen before sending input.
- Packaged import failure: check `package.json` exports, `cordis.patch.yml`, and prepare-build entries rather than source-only resolution.
- PID changes: treat the test as failed even if the final command succeeds.
- A Profile package is installed but absent after reload: inspect the temporary Profile's `package.json` and `dsh.profile.bundles`.

## Reporting

Report the scenario, exact command, source-test totals, terminal assertions, observed PIDs, artifact location when retained, and cleanup status. Distinguish a source test from a packaged live test.
