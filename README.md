<div align="center">

# dsh-omp-tui

**为 DeepSeek Harness 带来 OMP 风格、可配置、可远程控制的终端界面。**

独立 TUI profile bundle · 动态深浅主题 · 持久会话 · 微信 iLink 桥

[快速开始](#快速开始) · [功能](#为什么使用它) · [命令](#常用操作) · [配置](#配置) · [开发](#参与开发)

</div>

<p align="center">
  <img src="docs/assets/tui-welcome.png" alt="dsh-omp-tui 在 WezTerm 中的欢迎页，展示会话信息、OMP Powerline 状态栏与 DeepSeek 模型状态" width="900">
</p>

`dsh-omp-tui` 是 [DeepSeek Harness（dsh）](https://github.com/deepseek-ai/deepseek-harness) 的独立 TUI profile bundle。它负责终端呈现、输入交互、主题、设置与微信桥；agent、模型、工具、会话持久化和沙箱仍由 dsh harness 提供。

> [!IMPORTANT]
> 当前项目进入低频维护阶段，现有 TUI 与微信远程能力可正常使用。遇到问题请提交 [Issue](https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/issues)，维护者会视情况处理。dsh 本身仍处于 developer preview，建议固定宿主版本与插件 release。

## 为什么使用它

| 能力 | 你会得到什么 |
| --- | --- |
| **OMP 风格界面** | Catppuccin 默认外观、Powerline 状态栏、truecolor 与 Nerd Font 图标 |
| **动态主题** | 98 个 OMP 主题，支持跟随终端明暗、固定主题及逐角色 RGB 覆盖 |
| **完整会话流** | 新建、命名、恢复、切换会话，以及运行中消息 steer |
| **内置控制面板** | 在 TUI 中选择模型、思考等级、agent preset、权限与供应商 |
| **响应式布局** | 窄终端自动压缩次要信息，优先保留模式、目录、Git 与上下文用量 |
| **微信远程桥** | 通过官方 ClawBot / iLink 通道发送任务、查看进度并接收结果 |

界面支持斜杠命令、路径与参数补全、会话/文件引用、可折叠工具卡、思考块、上下文卡以及审批对话框。

<details>
<summary><strong>查看完整帮助面板</strong></summary>

<br>

<p align="center">
  <img src="docs/assets/tui-help.png" alt="dsh-omp-tui 的帮助面板，展示快捷键和斜杠命令" width="1000">
</p>

</details>

## 快速开始

### 环境要求

- Node.js `^22.19.0` 或 `>=24.0.0`
- pnpm 11（仓库锁定 `11.7.0`）
- dsh `0.1.1-rc.2`
- 推荐 truecolor 终端；Nerd Font 用于完整图标显示

### 1. 安装 release

如果尚未安装 pnpm：

```sh
npm install --global pnpm@11.7.0
```

将当前 release 安装到 `tui` profile：

```sh
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile tui add \
  https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi/releases/download/v0.2.3/dsh-omp-tui-0.2.3.tgz
```

release tarball 已包含构建后的 `lib/`，用户机器无需编译。升级、卸载、从 Git tag 安装及常见问题见 [`docs/INSTALL.md`](docs/INSTALL.md)。

### 2. 配置模型

官方 DeepSeek API：

```sh
# Git Bash / zsh
export DEEPSEEK_API_KEY='your-key'

# PowerShell
$env:DEEPSEEK_API_KEY = 'your-key'
```

也可以连接 OpenAI-compatible 本地网关：

```sh
export DEEPSEEK_BASE_URL='http://localhost:3000/v1'       # Git Bash / zsh
$env:DEEPSEEK_BASE_URL = 'http://localhost:3000/v1'      # PowerShell
```

环境变量必须在启动 dsh 的同一个 shell 中可见。启动后可用 `/model` 添加或切换 provider、model 与 reasoning effort。

### 3. 启动

```sh
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 --profile tui

# 恢复已有会话
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 --profile tui --resume <session-id>
```

如果已全局安装官方 dsh，也可直接运行：

```sh
dsh --profile tui
```

验证 profile 是否正确组合：

```sh
dsh --profile tui --dump-config
```

输出中应包含 `dsh-omp-tui` bundle，以及 `dsh-omp-tui/startup`、`dsh-omp-tui/prompt` 和 `dsh-omp-tui`。

## 常用操作

### 快捷键

| 快捷键 | 作用 |
| --- | --- |
| `Ctrl+C` | 中断当前回合；2 秒内再次按下退出 |
| `Ctrl+O` | 工具卡循环：折叠 → 展开 → 隐藏 |
| `Ctrl+R` | 显示或隐藏思考块 |
| `Alt+V`（Windows）· `Ctrl+V`（Linux/macOS） | 将剪贴板图片附加到输入草稿 |
| `Tab` | 补全命令、参数或路径 |
| `@` | 引用会话或文件 |
| 鼠标拖选 + `Ctrl+Shift+C` | 使用终端原生选择复制文本 |

粘贴图片后，输入框会插入 `[Image #N]` 标记；提交时只附加仍保留标记的图片。当前版本暂不在 TUI 中渲染图片预览。

### 核心命令

| 命令 | 作用 |
| --- | --- |
| `/help` | 查看运行中实例的完整命令与快捷键 |
| `/model` | 选择 provider、model 和思考等级 |
| `/new` · `/resume [id]` | 新建或恢复持久化会话 |
| `/mode [preset]` | 切换 `standard`、`minimal`、`code`、`cordis` 或本地 preset |
| `/permission [preset]` | 切换沙箱与审批策略 |
| `/theme` · `/palette` | 切换主题并检查实际颜色角色 |
| `/settings` | 打开可视化设置面板 |
| `/skills` · `skill:<name>` | 浏览或直接调用技能 |

更多命令以运行中的 `/help` 为准。`read-only` 与 `workspace-write` 模式下，越权操作会显示授权原因并等待批准；`full-access` 不显示审批框。

## 微信远程桥

内置微信桥通过腾讯官方 ClawBot / iLink 通道连接当前前台会话，支持扫码登录、白名单/配对码、远程命令、周期进度、结果推送，以及 `wechat_send` / `wechat_status` 工具。

```text
/wechat-login       # 扫码登录
/wechat-pair 123456 # 批准陌生用户收到的 6 位配对码
/wechat-status      # 查看桥状态
/wechat-notify on   # 将终端发起的任务也推送到微信
```

- 微信消息以 `@dsh` 开头时会作为远程命令，不进入对话，例如 `@dsh status`、`@dsh models`、`@dsh think max`。
- 普通消息会注入当前 TUI 前台会话；完成结果会自动回传。
- 状态与配置默认保存在 `~/.dsh/wechat-ilink/`，可用 `DSH_WECHAT_ILINK_STATE` 覆盖。
- 推送频率和终端任务推送开关可在 `/settings` 的 `微信claw` 页面调整。

## 配置

大多数选项可直接通过 `/settings`、`/theme`、`/model` 和 `/permission` 调整。也可以在 profile 的 `cordis.patch.yml` 中配置 `id: tui`：

```yaml
- id: tui
  config:
    mode: standard              # standard | minimal | code | cordis | 本地 preset id
    locale: zh-CN               # zh-CN | en
    defaultReasoningEffort: max
    theme:
      mode: dynamic             # dynamic | selected
      dark: dark-catppuccin
      light: light-catppuccin
      selected: dark-catppuccin
      custom:
        accent: [255, 100, 100]
        userMessageBg: [24, 24, 37]
```

需要注意：

- `mode` 只对空白会话生效；恢复会话时沿用日志中的模式。
- `dynamic` 根据终端明暗在 `dark` / `light` 槽位间切换；`selected` 固定使用 `selected`。
- `theme.custom` 只接受 RGB 三元组；未知角色或非法值会被忽略。
- 官方 settings provider 存在时，界面选择会写入 `$DSH_HOME/settings.yaml`。
- `/permission` 的选项来自当前部署，用户自定义 preset 也会进入提示与补全。

## `omdsh` 启动器

发布包还提供 `omdsh`：它调用系统 `PATH` 中的官方 `dsh`，首次运行时安装本插件，检测到旧版本时自动升级，然后启动 `--profile tui`。

```sh
# 先安装官方 dsh
npm install --global @deepseek-ai/dsh@0.1.1-rc.2

# 将 tui profile 的 .bin 目录加入 PATH 后
omdsh
omdsh --resume <session-id>
```

设置 `OMDSH_NO_BOOTSTRAP=1` 可跳过自动安装/升级；`DSH_REAL` 可指定真实 dsh 可执行文件；`DSH_DEBUG=1` 只打印解析后的命令。

## 参与开发

```sh
git clone https://github.com/mytianyi0712/dsh-tui-plugin-OhMyPi.git
cd dsh-tui-plugin-OhMyPi
pnpm install --frozen-lockfile
pnpm run check
pnpm run prepare
```

测试使用 Node 原生 `node:test` 直接运行 TypeScript 源码。修改源码并生成 `lib/` 后，可将本地仓库链接到 profile：

```sh
npx --yes @deepseek-ai/dsh@0.1.1-rc.2 plugin --profile tui add link:.
dsh --profile tui
```

dsh 上游合约变化时，请先更新 [`docs/contracts.md`](docs/contracts.md)，再同步源码、`cordis.patch.yml`、依赖和测试。

### 项目边界

```text
src/                    TUI、主题、提示、会话、设置与微信桥
src/components/         状态栏、消息、工具卡和转录组件
tests/                  node:test 行为测试
cordis.patch.yml        bundle 与 dsh profile 的组合配置
scripts/omdsh*          跨平台 TUI 启动器
docs/                   安装、发布与 harness 合约文档
```

本仓库不复制 dsh 上游能力：harness 负责 agent、模型、工具、持久化与沙箱，本项目只实现 profile 层的终端体验与桥接。

## 文档

- [`docs/INSTALL.md`](docs/INSTALL.md) — 安装、升级、卸载与排障
- [`docs/contracts.md`](docs/contracts.md) — 当前 dsh 合约的唯一真相源
- [`docs/PUBLISHING.md`](docs/PUBLISHING.md) — release、tarball 与 CI 发布流程
- [`CHANGELOG.md`](CHANGELOG.md) — 完整版本记录

## 许可证

[BSD-3-Clause](LICENSE)。`patches/@earendil-works__pi-tui@0.80.7.patch` vendored from `turtle1999/turtle-ui`（BSD-3），详见 [`patches/NOTICE.md`](patches/NOTICE.md)。
