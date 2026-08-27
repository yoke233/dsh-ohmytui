# pi-tui patch 可删除性研究报告（findings）

> 结论先行：**可以删除，而且工作树里已经删了**。本仓库已用只依赖公开 API 的本地适配器
> `PromptEditor`（`src/components/prompt-editor.ts`）替代被补丁的 pi-tui Editor 用法，
> 并已删除 `patches/@earendil-works__pi-tui@0.84.3.patch`、`patches/NOTICE.md` 及 pnpm 接线。
> 研究基线：npm `latest` 上的 `@earendil-works/pi-tui@0.84.3`；官方文档 https://pi.dev/docs/latest/tui；
> 官方仓库 https://github.com/earendil-works/pi（`packages/tui`）。只使用官方文档、官方源码、
> npm registry 元数据与仓库内一手文件。

## 1. TL;DR

1. **当前 pi-tui（0.84.3，npm latest）原生能力**：完整的终端 UI 框架 API —— `Component` / `Focusable`（IME）
   接口、差分渲染 `TuiMainScreen` / `TuiAltScreen`、内置组件（`Text`、`TruncatedText`、`Input`、`Editor`、`Markdown`、`Loader`、`SelectList`、`SettingsList`、`Spacer`、`Image`、`Box`、`Container`、`VStack`、`HStack`、`ScrollView`）、
   overlay、键位/宽度工具、主题接口、自动补全（路径 + 斜杠命令）。
2. **旧 patch 补的是上游没有的 Editor API**：`EditorOptions.frame: "horizontal" | "none"`、`EditorOptions.prompt`（首行/续行前缀）、`Editor#setPrompt()`、`wordWrapLine(..., continuationWidth)`。
   上游 0.84.3 发布提交与 `main` 源码均无这些 API（`EditorOptions` 只有 `paddingX` / `autocompleteMaxVisible`）。
3. **可删除，且删除已在工作树中进行**：新适配器 `PromptEditor extends Editor` 只调用 pi-tui 公开 API，
   在 `render()` 外层去掉横向边框并加上提示符前缀；`src/index.ts` 已切换为 `PromptEditor`，
   patch 文件、`patchedDependencies`、`package.json` 的 `patches` 发布项及 README/PUBLISHING 的补丁说明均已删除。
4. **剩余动作是验证**（非本报告职责）：用无 patch 的干净安装跑 `pnpm install --frozen-lockfile`、`pnpm run check`、`pnpm run prepare`。本报告撰写时 `pnpm run check` 已在工作树（node_modules 仍是旧补丁安装）上启动（结果见 §9）。

## 2. 仓库研究笔记目录惯例与本文件

- 本仓库研究笔记目录为 **`.research/pi-tui/`**（未跟踪）。
- 按 research skill 要求，最终只保留**一个** Markdown 结论文件：`.research/pi-tui/pi-tui-patch.md`；
  研究过程中抓取的官方文档/README/CHANGELOG/npm manifest/上游源码等临时材料已删除，不再保留本地副本。
- `docs/` 下是面向用户的安装/发布/合约文档（`INSTALL.md`、`PUBLISHING.md`、`contracts.md`、`hooks.md`、`orca.md`、`RELOAD_ISSUE.md`），不是研究笔记目录。

## 3. 方法与一手来源

| 来源类型 | 地址 | 用途 |
| --- | --- | --- |
| 官方文档 | https://pi.dev/docs/latest/tui | pi-tui 组件系统官方说明 |
| 官方 README | https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/README.md | 内置组件/能力清单 |
| 官方源码（main） | https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/src/components/editor.ts | Editor 原生 API |
| 官方源码（0.84.3 发布提交） | https://raw.githubusercontent.com/earendil-works/pi/bfb004d4418ff05c6f909eaaab856cbe75c1fde0/packages/tui/src/components/editor.ts | 0.84.3 发布物与 main 一致 |
| npm registry latest | https://registry.npmjs.org/@earendil-works/pi-tui/latest | latest=0.84.3、gitHead bfb004d… |
| npm dist-tags | https://registry.npmjs.org/-/package/@earendil-works/pi-tui/dist-tags | `{"latest":"0.84.3","legacy-node20":"0.74.2"}` |
| 工作树改动 | `git status/diff`（§6） | 删除 patch 的改动清单 |

## 4. 当前 pi-tui 原生 API / 能力（官方口径）

- **组件模型**：`Component`（`render` / `handleInput` / `wantsKeyRelease` / `invalidate`）；`Focusable`（IME，`CURSOR_MARKER`、`showHardwareCursor`、`PI_HARDWARE_CURSOR=1`）。
  来源：官方文档 `#component-interface`、`#focusable-interface-ime-support`。
- **内置组件**：`Text`、`TruncatedText`、`Input`、`Editor`、`Markdown`、`Loader`、`SelectList`、`SettingsList`、`Spacer`、`Image`、`Box`、`Container`、`VStack`、`HStack`、`ScrollView`。
  来源：官方 README `## Features`。
- **渲染器/TUI**：`TuiMainScreen` / `TuiAltScreen`、差分渲染、CSI 2026 同步输出、bracketed paste、`showOverlay` + `overlayOptions`。来源：官方 README `## Core API`。
- **工具/交互**：`matchesKey` / `Key.*`、`visibleWidth`、`truncateToWidth`、`wrapTextWithAnsi`；路径与斜杠命令自动补全。
  来源：官方文档 `#built-in-components`、官方 README `## Features`。
- **主题**：组件接受主题接口（`EditorTheme` 等），主题变化时 `invalidate()` 重建缓存。
  来源：官方文档 `#invalidation-and-theme-changes`。
- **pi-coding-agent 层（不属于 pi-tui 包）**：`ctx.ui.custom`、`SelectList` + `DynamicBorder`、`SettingsList`、`setWidget` / `setFooter`、`CustomEditor`（替换主输入编辑器）。
  来源：官方文档 `#creating-custom-components`、`#pattern-1-selection-dialog-selectlist`、`#pattern-3-settings-toggles-settingslist`、`#pattern-5-widgets-above-below-editor`、`#pattern-7-custom-editor-vim-mode-etc`。
- **上游 Editor 原生选项**（0.84.3 与 main 一致）：

```ts
export interface EditorOptions {
    paddingX?: number;
    autocompleteMaxVisible?: number;
}
```

  无 `frame`、无 `prompt`、无 `setPrompt`、`wordWrapLine` 无 `continuationWidth` 参数（源码探测为 false）。

## 5. 旧补丁内容与原有接线（背景）

- 文件：`patches/@earendil-works__pi-tui@0.84.3.patch`，只改 `dist/components/editor.d.ts` 与 `editor.js`。
- 新增 API：`wordWrapLine(..., continuationWidth?)`；`EditorOptions.frame`；`EditorOptions.prompt`；`Editor#setPrompt()`；`frame:"none"` 的滚动指示器与续行布局；历史浏览光标行为修复。
- 来源/许可证：`patches/NOTICE.md`（已删）说明源自 turtle1999/turtle-ui commit `b08ed69`（BSD-3-Clause）；CHANGELOG 0.5.5 记录 0.84.3 升级时“把无边框提示符编辑器补丁重放到新版 pi-tui”。
- 接线（已删）：`pnpm-workspace.yaml` 的 `patchedDependencies`、`package.json` 的 `patches` 发布项、README/PUBLISHING 的补丁说明。

## 6. 工作树现状：删除 patch 的改动（git status / diff）

研究结束时工作树（未提交）包含完整删除改动：

| 文件 | 改动 |
| --- | --- |
| `patches/@earendil-works__pi-tui@0.84.3.patch` | 删除（已不在磁盘） |
| `patches/NOTICE.md` | 删除 |
| `pnpm-workspace.yaml` | 移除 `patchedDependencies` 块 |
| `package.json` | `files` 移除 `"patches"`；`@earendil-works/pi-tui@0.84.3` devDependency 保留（构建期 bundle 仍需） |
| `pnpm-lock.yaml` | 移除 patch hash 相关条目 |
| `README.md` | 移除 vendored patch 许可证说明 |
| `docs/PUBLISHING.md` | 发布清单移除 `patches/NOTICE.md` |
| `src/components/prompt-editor.ts` | 新增 `PromptEditor extends Editor` 适配器（见下） |
| `tests/prompt-editor.spec.ts` | 新增适配器测试 |
| `src/index.ts` | `new Editor(...)` 改为 `new PromptEditor(...)`，构造选项移除 `frame` / `prompt`；`editor.setPrompt(...)` 调用保持不变（落到适配器方法） |

### PromptEditor 适配器要点（`src/components/prompt-editor.ts`）

- 注释原文：“Keeps OMP’s inline prompt while using the public, unpatched pi-tui Editor.”
- `setPrompt(prompt)`：校验 `visibleWidth(first) === visibleWidth(continuation)`，仅存字段；
- `render(width)`：对 `super.render(innerWidth)` 的结果去掉上下横框行，首行加 `first` 前缀、后续行加等宽空格前缀，再补上补全列表行；
- 只使用公开 API：`Editor`、`truncateToWidth`、`visibleWidth`、`EditorOptions` / `EditorTheme` / `TUI` 类型。

## 7. 判定：能否删除 patch

**推荐方案（无 patch）**：采用当前工作树已落地的本地适配器路线 —— 新增 `src/components/prompt-editor.ts`（`PromptEditor extends Editor`），只调用 pi-tui 公开 API（`Editor`、`render()`、`truncateToWidth`、`visibleWidth`），在渲染层去掉横向边框并为首行/续行加提示符前缀；配套 `tests/prompt-editor.spec.ts`。不再依赖上游不提供的 `EditorOptions.frame` / `prompt` / `setPrompt`。若未来上游原生支持这些选项，再升级依赖并移除适配器。

**可以删除，且工作树已经删除。** 依据：

1. 补丁 API 上游没有：0.84.3（npm latest，gitHead `bfb004d…`）与 `main` 的 `editor.ts` 均无 `frame` / `prompt` / `setPrompt` / `continuationWidth`；
2. 源码使用点已消除：`src/index.ts` 改用 `PromptEditor`，不再向 `Editor` 传被补丁选项；
3. 适配器只依赖公开 API，`tests/prompt-editor.spec.ts` 覆盖“无横框、续行对齐、宽度不超限”；
4. 接线与发布物已同步清理（`patchedDependencies`、`files`、README、PUBLISHING、lockfile）。

**验证清单（删除后应跑）**：

```powershell
pnpm install --frozen-lockfile   # 无 patch 的干净安装
pnpm run check                   # 类型检查 + 全部源码测试
pnpm run prepare                 # 重新生成 lib/（发布前）
pnpm pack --dry-run              # 确认发布物不再含 patches/
```

## 8. 来源链接逐项对照表

| 事实 | 来源 |
| --- | --- |
| 官方 TUI 组件文档 | https://pi.dev/docs/latest/tui |
| Component / Focusable / IME | https://pi.dev/docs/latest/tui#component-interface 、#focusable-interface-ime-support |
| 内置组件 | https://pi.dev/docs/latest/tui#built-in-components 、官方 README（https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/README.md） |
| 主题失效机制 | https://pi.dev/docs/latest/tui#invalidation-and-theme-changes |
| SettingsList / setWidget / CustomEditor 模式 | https://pi.dev/docs/latest/tui#pattern-3-settings-toggles-settingslist 、#pattern-5-widgets-above-below-editor 、#pattern-7-custom-editor-vim-mode-etc |
| 官方仓库 | https://github.com/earendil-works/pi/tree/main/packages/tui |
| 上游 Editor 源码（main，无补丁 API） | https://raw.githubusercontent.com/earendil-works/pi/main/packages/tui/src/components/editor.ts |
| 上游 Editor 源码（0.84.3 发布提交 bfb004d…） | https://raw.githubusercontent.com/earendil-works/pi/bfb004d4418ff05c6f909eaaab856cbe75c1fde0/packages/tui/src/components/editor.ts |
| npm latest / dist-tags（0.84.3） | https://registry.npmjs.org/@earendil-works/pi-tui/latest 、https://registry.npmjs.org/-/package/@earendil-works/pi-tui/dist-tags |
| 工作树删除改动 | `git status --porcelain`、`git diff`（§6） |
| 适配器与测试 | `src/components/prompt-editor.ts`、`tests/prompt-editor.spec.ts` |
| 旧补丁来源/许可证说明 | `patches/NOTICE.md`（已删除；历史版本见 git） |
| 0.84.3 升级与补丁重放记录 | `CHANGELOG.md`（0.5.5） |
| pi-tui 被 bundle 进 lib | `tsdown.config.ts:3-7` |

## 9. 验证状态与备注

- 研究开始时工作树仍保留补丁与旧用法；研究过程中工作树被更新为上述删除状态，本报告按最终状态撰写。
- 本报告撰写时曾在工作树启动 `pnpm run check`（后台 job）作为冒烟验证，但长时间无输出，已主动停止；需在无 patch 的干净安装（`pnpm install --frozen-lockfile`）后重跑验证。
- 按 research skill 与上级指示，`.research/pi-tui/` 下研究期间产生的临时抓取材料（官方文档/README/CHANGELOG/npm manifest/上游源码副本等）已全部删除，仅保留本 findings 文件。
