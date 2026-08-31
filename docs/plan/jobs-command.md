# /jobs 命令与后台任务状态计划

## 目标

为 OMP TUI 增加 `/jobs` 斜杠命令，用于查看当前会话已经启动的后台任务；同时在底部状态栏以内联方式提示正在运行的任务数量。

本仓库只实现 TUI 命令注册、文本呈现和状态栏展示。后台任务注册、隔离、读取和取消继续复用 dsh harness 的 `ctx.jobs`，不在本仓库复制任务管理逻辑。

## 已有上游能力

当前 dsh `0.1.2-alpha.2` 已提供：

- `@deepseek-ai/dsh-jobs`：`ctx.jobs` 抽象服务。
- `@deepseek-ai/dsh-jobs-local`：进程内任务 registry 实现，已由 dsh base profile 挂载。
- `@deepseek-ai/dsh-tool-jobs`：模型侧的 `job_list`、`job_output`、`job_kill` 工具，已由 dsh base profile 挂载。
- `@deepseek-ai/dsh-client-ui-jobs`：Web 会话标题栏任务列表，仅适用于 React/Web，不能直接复用于本 TUI。

`ctx.jobs` 可用接口包括：`list`、`get`、`read`、`kill`、`wait`、`onJobDone`、`onJobsChanged`。任务状态为 `running | stopping | completed | killed | failed`。

目前上游没有现成的 `/jobs` 斜杠命令包。

## 交互设计

### `/jobs`

首版只提供无参数命令，通过 `ctx.jobs.list(invocation.agent)` 读取任务，确保沿用上游的会话 owner 隔离。

展示顺序与上游 Web UI 保持一致：

1. `running`、`stopping` 在前，按启动时间升序。
2. 已结束任务在后，按结束时间降序。

建议输出：

```text
后台任务（2 个运行中，共 4 个）

● pwsh-1      running    1m 23s  pnpm run check
◐ subagent-2  stopping     42s   Review command design
✓ pwsh-3      completed     8s   Run unit tests
✗ pwsh-2      failed        3s   Build package — exit code 1
```

没有任务时：

```text
暂无后台任务。
```

每行至少包含任务 id、状态、已运行时长或最终耗时、label，以及可选 detail。

首版不加入子命令。后续可按需要扩展 `/jobs active`、`/jobs output <id>`、`/jobs kill <id>`，并直接调用对应的 `ctx.jobs` 接口。

### 状态栏

任务数量直接接在现有状态栏后面，不另起一行：

```text
gpt-5.6-sol · medium · ctx 53.2k/272k · workspace-write · jobs 2
```

规则：

- 数量只统计 `running + stopping`。
- 活跃任务数为 0 时隐藏整个 `jobs` 项。
- 活跃时使用适度强调色；存在 `stopping` 时可使用 warning 色。
- 文案保持为 `jobs N`，不长期显示 `/jobs` 提示。
- 窄终端下将该项视为低优先级信息，可在空间不足时隐藏，不能挤压输入区域。

## 实施步骤

1. 完整核对并更新 `docs/contracts.md`，补充 `ctx.jobs`、`JobSnapshot`、状态集合和 owner 隔离合约。
2. 为 TUI 插件增加 `jobs` 服务注入及相应的类型声明导入。
3. 通过 `ctx.commands.register()` 注册全局 `jobs` 命令，description 使用“查看后台任务”等简短文案。
4. 抽出纯展示逻辑，负责任务排序、状态标记、持续时间、detail 拼接及空状态输出。
5. 在状态组件中订阅 `ctx.jobs.onJobsChanged()`，只在当前 agent 可见任务发生变化时刷新。
6. 状态栏根据当前 agent 调用 `ctx.jobs.list(agent)`，计算活跃任务数并以内联 token 呈现。
7. 确保插件卸载或 TUI reload 时释放命令注册和任务变更监听器。
8. 同步源码测试、构建入口和必要的 profile/依赖声明；不要直接修改生成的 `lib/`。

## 测试计划

### 源码测试

覆盖以下行为：

- 无任务时的空状态。
- 单个和多个运行中任务，且 `stopping` 计入活跃数量。
- 五种状态的标记与文案。
- 活跃任务优先及稳定排序；已结束任务按结束时间倒序。
- 持续时间的秒、分钟、小时边界。
- label/detail 过长及窄宽度处理。
- owner 隔离：命令只展示 `invocation.agent` 可见任务。
- `onJobsChanged` 触发状态栏刷新，并在卸载后正确解绑。
- 活跃数为 0 时状态栏不显示 `jobs`。

### 验证命令

先运行相关单文件测试，再运行：

```powershell
pnpm run check
pnpm run prepare
```

由于涉及斜杠命令、状态栏和可见 TUI 行为，还需按 `.agents/skills/test-dsh-tui/SKILL.md` 执行真实 ConPTY 测试，至少验证：

- 后台任务启动后出现内联 `jobs N`。
- 输入 `/jobs` 能看到对应任务。
- 任务结束后活跃数量下降或隐藏。
- reload 后命令和监听器不重复注册。
- 窄终端下状态栏不换行、不破坏输入区域。

## 完成标准

- `/jobs` 能准确展示当前会话可见的后台任务。
- 状态栏以内联 `jobs N` 显示活跃数量，零任务时隐藏。
- 不绕过 `ctx.jobs` 的 owner 隔离，不复制上游 registry。
- 源码测试、`pnpm run check`、`pnpm run prepare` 和要求的真实 TUI smoke 均通过。
