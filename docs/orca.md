# Orca 集成（agent 状态上报）

在 [Orca](https://github.com/) 的 pane 里运行时，本 TUI 会把自己的 agent 状态
上报给宿主，于是 Orca 左侧 workspace 列表里会出现这个会话那一行
（`● Working – DSH` / `✓ Done – DSH`）。Orca 侧不需要任何配置或改动。

## 传输

状态走 OSC 9999：把 JSON 内嵌进 PTY 输出流，Orca 解析后从流里剥离，不占屏幕
单元格，alt-screen 下同样有效。

```
ESC ] 9999 ; <JSON> BEL
```

字节由 `src/orca-status.ts` 直接写进程 stdout（`ProcessTerminal.write`，与
`setTitle` / OSC 52 剪贴板走同一条路），**不经过 pi-tui 的差分渲染器** ——
否则下一帧重绘会把它吞掉或当成普通文本参与 diff。

Orca 的另一条状态通道（`POST /hook/<agent>` HTTP hook）需要在 Orca 内部为每个
agent 注册专属 pathname 与归一化器，本 bundle 刻意不走。

## 启用条件

只在环境变量 `ORCA_PANE_KEY` 非空时上报（Orca 给它管理的每个 pane 注入）。
普通终端里一个字节都不写，不会漏出裸序列。这个判定在
`isOrcaPane()`，不在 Orca 里时 `createOrcaStatusReporter()` 直接返回哑实现。

## 上报的字段

| 字段 | 来源 |
|---|---|
| `state` | `working` / `waiting` / `done`（本 bundle 不发 `blocked`） |
| `agentType` | 固定 `dsh`，决定 Orca 显示的名字与图标 |
| `prompt` | 本轮 `user/message`（仅 `source.kind === 'user'`），整轮沿用 |
| `toolName` / `toolInput` | 当前工具调用，与 TUI 工具卡的标题、摘要行同源（`toolLabel` / `toolDetail`） |
| `lastAssistantMessage` | 本轮最后一条非空 `assistant/message` |
| `model` | 当前模型选择，上报时读取 |
| `interrupted` | `turn/end` 的 `reason.kind === 'aborted'`（Ctrl+C） |
| `sessionBoundary` | 启动 / `/resume` / `/new` 落到空闲态，不是一轮任务完成 |
| `interactivePrompt` | 选项式提问，见下 |

字段长度上限：`prompt` 1000、`toolName` 60、`toolInput` 160、
`lastAssistantMessage` 8000、`model` 120，超出按码点截断（不会劈开代理对）。
所有文本先过 `displayText` / `displayInlineText` 去控制序列。

## 状态机

| TUI 事实 | 上报 |
|---|---|
| 挂载完成 / 切换会话后落到空闲 | `done` + `sessionBoundary` |
| `agent/status` → running | `working` |
| `user/message`（用户来源） | `working` + `prompt` |
| `assistant/message` | 记下预览；清掉上一步的工具，重发 `working` |
| `tool/call` | `working` + `toolName` / `toolInput` |
| `turn/end` | 只记录是否被打断；等空闲再收尾 |
| `agent/status` → idle | `done` + `lastAssistantMessage`（打断则带 `interrupted`） |

`done` 等的是 `agent/status` 空闲而不是 `turn/end`：一轮结束时队列里可能立刻
有 steer 消息开下一轮。相同的序列不会重复写。

## 等待用户输入

权限确认与选项式提问一律上报 `waiting`（Orca 里 `waiting` 与 `blocked` 只差
一句无障碍文案，Orca 自己的 Claude Code 归一化器也把两者合并成 `waiting`）。

- **权限确认**：必须带 `toolName` + `toolInput` 说明在批准什么 —— 只发裸
  `waiting` 那一行说不出所以然。`ApprovalRequest` 只带 `callId`，所以摘要是回
  session log 里找到对应 `tool/call` 再用工具卡同一套 `toolDetail` 生成的。
- **选项式提问**（`ctx.userQuestions`）：额外带 `interactivePrompt` —— 一个
  **JSON 字符串**（不是对象），形状是 Claude `AskUserQuestion` 的 tool input，
  `toolName` 用 `AskUserQuestion` 走 Orca 注册好的解析器，Orca 会渲染成可点击
  的卡片。上限 16000 字符且**不截断**：超了整条丢弃，降级成普通 `waiting`。
  没有选项、纯等打字的场景不带这个字段。

`interactivePrompt` 是「还没答」的活状态，因此只在 `state: "waiting"` 上序列
化：用户答完后的下一条状态（`working` 或新的 `waiting`）自然把卡片清掉。

## 验证

- 单元测试：`tests/orca-status.spec.ts`（线格式、JSON 转义、字段截断、非 Orca
  环境静默、各状态转换）。
- 真实终端：`.agents/skills/test-dsh-tui/scenarios/orca-status.mjs` 在 ConPTY
  里跑真 dsh，从原始 PTY 流里解析 OSC 9999，断言启动边界、`working` + prompt、
  工具行、权限确认的 `waiting` + `toolName`/`toolInput`、以及收尾的 `done`。
  该场景需要从 Orca 内的终端运行（继承 `ORCA_PANE_KEY`）：

  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .agents/skills/test-dsh-tui/scripts/run-live-test.ps1 -Scenario orca-status -KeepArtifacts
  ```
