# /reload：整个 Profile Runtime 的无感重载

## 状态

**设计问题已记录，当前暂停实现。尚未完成修复或最终验收。**

当前 bundle 已暂时关闭 reload：`cordis.patch.yml` 中的 `tui-reload` 行为 disabled，TUI 不注入 `tuiReload`，也不展示或处理 `/reload`。用户需要退出并重新启动 `dsh --profile tui` 才能载入 Profile 或代码变化。

`src/reload.ts`、包导出、专项源码测试和历史场景仍作为调查 WIP 保留，便于后续恢复；这些内容不能视为当前运行时能力。恢复工作时必须先区分 reload 改动与同工作树中的其他并行功能。

## 原始目标

`/reload` 的目标不是只刷新 `dsh-omp-tui`，而是重新加载当前 Profile 的完整插件运行时，包括：

- 当前 TUI bundle 的代码与配置；
- 后续安装的任意第三方 bundle/plugin；
- Profile 中新增或移除的插件；
- npm/file/link 插件升级后的新代码；
- `link:` 开发插件在原路径上的代码变化；
- Bundle patch、Profile patch 和 Home patch；
- 插件依赖发生变化后的运行时代码。

期望用户在同一个终端会话中执行 `/reload` 后看到新 generation 生效，并尽量保持：

- 当前 Agent 与 Session；
- 会话历史和持久化状态；
- 终端交互连续性；
- 当前 workspace；
- 无需手动退出并重新执行 `dsh --profile tui`。

是否强制要求“同一个 Node PID/Realm”仍需最终决策。对于任意第三方插件，保持终端和 Session 连续比保持插件 Realm 更现实。

## 当前实现覆盖范围

原有 `src/reload.ts` 能够：

1. 重新读取 Bundle 清单；
2. 重新读取 Bundle/Profile/Home patch；
3. 保留 launcher overlay；
4. 通过根 Include 事务性应用配置树；
5. 添加、删除或更新配置发生变化的 Cordis rows；
6. 保护当前 TUI 及活动服务提供者，避免 Profile 配置更新破坏当前会话。

它不能可靠处理：

- row 的 `id/name/config` 未变化，但模块代码已变化；
- npm 插件版本或 pnpm 实际入口路径变化，但 entry 文本相同；
- `link:` 插件路径相同、内容变化；
- 插件的传递依赖变化；
- 需要销毁旧模块 Realm/全局副作用的插件更新。

因此当前实现本质上是 **Profile 配置重组**，不是完整的 **Profile Runtime generation 切换**。

## Pi 的 /reload 如何工作

已检查本机 `@earendil-works/pi-coding-agent@0.84.2`。Pi 的 `/reload` 并不会重新加载整个 Pi 主程序或 `InteractiveMode`，而是保留稳定宿主并重建受控的 extension runtime：

1. streaming 或 compaction 期间拒绝 reload；
2. 向旧 `ExtensionRunner` 发送 `session_shutdown(reason: "reload")`；
3. 调用 `oldRunner.invalidate()` 清理扩展监听与绑定；
4. 重新读取 settings；
5. 清空 extension factory cache 并递增 cache generation；
6. ResourceLoader 重新解析 extensions、skills、prompts、themes 和 context files；
7. 使用 Jiti 且设置 `moduleCache: false` 重新导入扩展；
8. 创建新的 `ExtensionRunner`，重新绑定 core、tools、commands 和 events；
9. 重建 chat，并刷新 keybindings、theme、autocomplete 与 extension shortcuts；
10. 保留原来的 InteractiveMode、Session 与进程。

关键结论：

> Pi 能稳定 reload，是因为它只 reload 明确定义生命周期的 extension/runtime 层，而不是任意核心模块。

修改 Pi 自己的 reload 引擎或稳定宿主仍然需要重启。该模式可以借鉴生命周期设计，但不能直接满足“任意 Profile 插件更新”。

## 正确抽象：Profile Runtime Generation

每次 Profile 加载应形成一个可比较的 generation：

```text
ProfileGeneration
├─ bundle manifest
├─ composed Cordis entries
├─ resolved module URLs
├─ package versions
├─ lockfile/package fingerprints
├─ entry module fingerprints
├─ dependency fingerprints
└─ running fibers/runtime instance
```

不能只比较 entry 配置，还应至少比较：

```ts
interface RuntimeEntryFingerprint {
  id: string
  name: string
  config: unknown
  resolvedModuleUrl: string
  packageName?: string
  packageVersion?: string
  moduleFingerprint: string
  dependencyFingerprint?: string
}
```

即使配置仍然是：

```yaml
id: some-plugin
name: some-plugin
```

只要解析后的代码 generation 改变，也必须替换对应 runtime/fiber。

## Reload Coordinator 的归属

完整 Profile reload 不能长期由 `dsh-omp-tui/reload` 所有，因为：

- TUI 自身可能被更新、移除或加载失败；
- reload coordinator 不能可靠地负责替换自己；
- 其他 Profile 可能不安装该 TUI；
- 通用插件重载属于 Loader/App Boot/Host 的职责。

合理结构：

```text
Stable DSH Host / Supervisor
├─ ProfileReloadCoordinator   # 不参与普通 Profile reload
├─ Loader / generation resolver
├─ Session persistence bridge
├─ Terminal bridge
└─ Profile Runtime Generation
   ├─ TUI
   ├─ auth plugins
   ├─ tools
   ├─ custom bundles
   └─ other profile plugins
```

TUI 中的 `/reload` 只应调用稳定服务，例如：

```ts
await ctx.profileReload.reload()
```

最终能力更适合进入 dsh base/app-boot/loader，或由独立 supervisor 提供；本插件可以先做原型，但不应成为永久控制平面。

## 可选实现路线

### 路线 A：进程内、generation-aware 的事务式重载

1. 等待当前回合和插件调用进入 quiescent 状态；
2. 重新读取 Profile、patch、package manifest 和 lockfile；
3. 解析所有 entry 的实际模块 URL 与 fingerprint；
4. 计算新旧 generation diff；
5. 使用版本化 URL 预加载变化模块，例如：

   ```ts
   import(`${moduleUrl}?dsh_generation=${fingerprint}`)
   ```

6. 在提交前验证新插件可导入、配置可解析；
7. 按依赖逆序 dispose 受影响 fibers；
8. 按依赖正序创建新 fibers；
9. 刷新 commands、tools、TUI、autocomplete 等聚合视图；
10. 失败时恢复旧 generation。

优点：

- 可以保持主进程、Agent 和 Session；
- 对生命周期良好的插件切换快；
- 可以复用 Cordis fiber/Include 事务能力。

限制：

- Node ESM 不支持真正卸载旧模块；多 generation 会保留旧模块对象；
- 任意第三方插件可能修改全局变量、启动线程、注册不可撤销监听器；
- 不能保证所有插件都能在同一 JS Realm 中安全替换；
- 需要正式的 quiesce/dispose/snapshot/restore 合约。

### 路线 B：稳定 Supervisor + 可替换 Profile Worker

```text
Stable process
├─ terminal/session/reload bridge
└─ Worker: complete Cordis Profile runtime
```

Reload 时：

1. 主进程读取并准备新 generation；
2. 启动新 Worker 并加载完整 Profile；
3. 新 Worker 初始化成功后切换 terminal/session bridge；
4. 销毁旧 Worker，从而真正释放旧插件 Realm；
5. 新 Worker 失败则继续使用旧 Worker。

优点：

- 最接近“任意插件都能更新”；
- 旧 ESM cache、全局变量、线程和监听器随 Worker 一起销毁；
- 失败回滚边界清晰；
- 终端与 Session 可以保持连续。

代价：

- 架构改动较大；
- 插件运行 Worker PID 会变化；
- 需要定义 Session、terminal、approval、tool call 等跨 Worker bridge。

### 路线 C：混合策略（推荐方向）

```ts
reloadPolicy: 'hot' | 'runtime-restart' | 'process-restart'
```

- 明确支持生命周期的无状态插件：进程内 hot reload；
- TUI、认证、复杂工具等：必要时重启 Profile Worker；
- Loader、Supervisor 或稳定 Host 自身：提示完整 process restart。

用户仍只执行一个 `/reload`；由 coordinator 根据 generation diff 和插件能力选择策略。

## 插件生命周期合约建议

为了支持进程内重载，可考虑约定：

```ts
interface ReloadLifecycle<State = unknown> {
  policy: 'hot' | 'runtime-restart'
  quiesce?(ctx: Context): Promise<void>
  snapshot?(ctx: Context): Promise<State> | State
  dispose?(ctx: Context): Promise<void>
  restore?(ctx: Context, state: State): Promise<void>
}
```

没有声明或无法证明安全的插件，应默认使用 runtime restart，而不是乐观地在同一 Realm 中替换。

## 当前 HMR WIP 的结论

调查期间尝试过：

- 通过 `loader.entries()` 查找嵌套 `tui` entry；
- 解析当前模块 URL；
- 将 URL 加入 Cordis HMR 的私有 `stashed` 集合；
- 调用私有 `partialReload()`；
- 检查 Node 22/24 loader cache 是否替换。

已确认的问题：

1. `loader.resolve('tui')` 无法解析根 Include 下的嵌套 entry；
2. `@deepseek-ai/cordis-plugin-hmr@1.0.16` 默认跳过 `node_modules`；
3. `stashed` / `partialReload()` 是私有 API；
4. 文件 HMR 关注 changed file，不负责完整 Profile generation；
5. 无法覆盖任意插件升级、依赖变化与不可撤销副作用。

因此该 WIP 只能作为技术调查，不应直接成为通用 `/reload` 的最终实现。

## 一次性启动悖论

无论选择哪种实现，正在运行的旧版 reload coordinator 都无法保证加载“新的 reload coordinator 自身”。首次部署新架构时可能仍需一次性重启。

之后：

- 普通 Profile 插件变化应由新 coordinator 处理；
- coordinator/Loader/Supervisor 自身变化仍可能要求完整重启。

这与 Pi 相同：稳定宿主本身不属于它的 extension reload 范围。

## 历史验证记录

在隔离的 dsh 0.1.1-rc.2 环境中曾完成：

- TypeScript 类型检查；
- reload helper、Node 22/24 URL 解析、嵌套 entry 查找测试；
- i18n 测试；
- `pnpm run prepare` 构建。

真实 ConPTY 曾复现：

```text
cannot resolve entry tui
```

以及：

```text
tui reload: Cordis HMR did not replace the live module
```

这些结果只证明当前 HMR WIP 的边界，不能证明完整 Profile reload 已实现。

当时全量测试曾运行到 134 项：131 通过、2 失败、1 跳过；两个失败来自同工作树并行开发的 `ApprovalDialog` 和 `context-usage-screen`，与 reload 专项无关。

## 当前 WIP 文件

以下文件含 reload 调查改动，并可能同时包含其他并行任务内容：

- `src/reload.ts`
- `src/index.ts`
- `src/i18n.ts`
- `tests/reload.spec.ts`
- `tests/i18n.spec.ts`
- `docs/contracts.md`
- `.agents/skills/test-dsh-tui/SKILL.md`
- `.agents/skills/test-dsh-tui/scenarios/reload-code.mjs`

不要整体回滚这些文件；应逐块审查。

## 恢复工作前需要确定

1. “无重启”是否要求主 Node PID 不变，还是只要求终端/Session 无感；
2. reload coordinator 应上移到 dsh 哪一层；
3. 是否允许引入稳定 Supervisor + Profile Worker；
4. 插件默认策略是 hot reload 还是 runtime restart；
5. generation fingerprint 的来源：package version、lockfile、入口 hash 或完整依赖图；
6. 哪些服务必须跨 generation 保持：Agent、Session、Storage、Terminal、Approval、Tool calls；
7. 失败回滚和插件状态迁移合约。

## 建议的下一步

1. 暂停继续完善当前私有 HMR WIP；
2. 在 dsh host/app-boot 层写一个最小 `ProfileGeneration` 设计；
3. 用三个 fixture 验证 diff：
   - 新增/删除 bundle；
   - npm 插件版本升级但 entry 配置不变；
   - `link:` 插件路径不变但代码内容变化；
4. 做两个原型对比：
   - versioned module URL + Cordis fiber replacement；
   - stable supervisor + disposable Profile Worker；
5. 根据任意第三方插件的安全边界选择混合策略；
6. 确定架构后再清理或重写当前 WIP，并重新设计 ConPTY 验收场景。
