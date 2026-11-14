# Herdr 工作区定制

这是 Herdr App **0.1.15** 和 Herdr Core **0.1.21** 的本地 Git 快照。只收录 Herdr 定制代码、便携配置和恢复工具。工作区目录、终端状态、AI 对话、账号凭据和 AI 全局配置均不在归档范围内。

## 安装

两个系统共用 `app/` 下的布局、面板和状态桥，安装器再覆盖 `platforms/macos/app/` 或 `platforms/windows/app/`。平台目录包含各自的壁纸导入器和 Qoder 启动器。

macOS 在 Herdr 首次启动并生成配置后，于仓库根目录执行：

```sh
./platforms/macos/apply.sh --dry-run
./platforms/macos/apply.sh
herdr-app do layout.switch --name workspace-folders
```

macOS 使用 Python 3.9+，在配置目录内生成恢复点。回滚时运行 `./platforms/macos/apply.sh --rollback <恢复点目录>`。如果 `herdr-app` 不在 PATH，可使用应用提供的命令行程序。原生玻璃模式的单独构建说明见 [macOS 原生毛玻璃](platforms/macos/native/README.md)。

### Windows

先安装 Herdr App 和 Core，打开一次 Herdr 让它生成当前版本的默认文件。准备目标机上的 **64 位 PowerShell 7.3+**，按需安装 AI CLI。恢复脚本沿用目标机上的 CLI 和登录状态。已验证的 CLI 版本及 DeepSeek TUI 安装命令见 [依赖说明](docs/dependencies.md)。

在仓库根目录运行：

~~~powershell
pwsh -NoProfile -File .\Restore-Herdr.ps1 -ValidateMods
pwsh -NoProfile -File .\Restore-Herdr.ps1 -Apply
~~~

第一条命令在临时目录检查工作区 Mod，并预览将写入的文件。第二条命令写入配置，保留未纳入定制的 JSON 字段和 Core 配置，备份发生覆盖的文件。缺少 CLI 时，脚本会提示并跳过对应菜单覆盖项。装好后重跑即可。重复恢复相同配置不会生成新的备份。备份和变更清单位于 %LOCALAPPDATA%\herdr-customizations\backups，或者由 -BackupRoot 指定。

脚本支持单行 Core shell 数组。若目标机的 shell 数组跨行，或脚本无法确定顶层 TOML 的边界，使用 -SkipCoreShell 应用 App 配置，再参考 platforms/windows/config/core-shell.json 手动合并 Shell 设置。

恢复后，在运行中的 Herdr 里切到 **workspace-folders** 布局。可用 Ctrl+Shift+L 切换，也可在目标机 PowerShell 运行：

~~~powershell
herdr-app do layout.switch --name workspace-folders
~~~

若 Herdr 的命令未加入 PATH，请用安装目录下的 herdr-app.exe。若收到 no Herdr window，先打开桌面 App，再检查 CLI 和 App 是否使用同一个 HERDR_APP_HOME。脚本默认遵循 HERDR_APP_HOME 和 XDG_CONFIG_HOME。自定义位置也可以用 -AppHome、-CoreConfig、-AppExe、-NpmRoot 指定。已有会话照常使用其启动时的配置，状态接入验证请开新会话。

## 保存的定制

| 定制 | 行为 |
| --- | --- |
| 工作区文件夹选择 | Spaces 的新增按钮、新建标签菜单和 Ctrl+Shift+N 打开本机文件夹选择器。所选文件夹作为新工作区根目录，Files 跟随活动工作区。远程机器保留其默认新建流程。 |
| Spaces 中的 AI 会话 | 按 Herdr 提供的 agent.space 将已识别会话挂到对应工作区。点击可定位相应终端。 |
| AI 一键菜单 | Codex、CodeBuddy Code、OpenCode、Pi、DeepSeek Harness、Qoder。恢复时从已安装的 CodeBuddy npm 包获取图标，DeepSeek 走交互式 TUI。 |
| Agents 状态 | CodeBuddy 通过生命周期 hooks 和 OSC 状态桥接上报。Qoder 启动时启用自己的状态上报。其余入口使用 CLI 和 Herdr 已提供的状态能力。 |
| Windows 终端 | Herdr Core 的新终端使用真实的 64 位 PowerShell 7，提示符同步当前文件系统目录。独立 Windows Terminal 的系统配置可按依赖说明手动设置。 |
| 应用偏好 | 当前缩放、深色外观、字体字号及连字、最低对比度和声音开关。 |

## 工作区界面

- 标签栏右侧齿轮打开外观设置。可预览纯色、渐变、图片和紧凑侧栏。输入本地图片的绝对路径后点 Import。导入的图片保存在本机 Herdr 配置目录的 `backgrounds/` 中。
- Changes 支持按路径筛选、暂存分组和展开 Diff。筛选只影响视图，提交范围仍由暂存状态或明确确认的全部文件决定。
- Files 支持文件名搜索、仅显示变更和隐藏常见构建目录。在 Git 项目中搜索索引和未忽略文件，在其他目录中搜索已加载的文件夹。
- Tasks 显示项目任务、退出码和最近输出。没有 `.herdr/tasks.json` 时读取 `package.json` 的 `dev`、`test` 和 `build`。自定义任务以命令及参数数组声明，点击后才运行。配置示例见下方。
- 标签栏搜索图标打开工作区命令，可进入 Tasks、选择 Git worktree，或跳到需要处理的 Agent。

```json
{
  "check": ["node", "--test"],
  "build": ["cargo", "build"]
}
```

## 维护与回滚

日常修改继续提交到这个仓库。需要保留 Git 历史时，在另一台机器克隆这个仓库，或将整个仓库连同 .git 目录一起复制。ZIP 用于直接恢复。升级 Herdr 时按 [版本升级与回滚](docs/upgrading.md) 检查上游变化并重新验证。

上游基线见 [Herdr App v0.1.15](https://github.com/herdrdev/herdr-app/tree/v0.1.15) 和 [Herdr Core v0.1.21](https://github.com/herdrdev/herdr-core/tree/v0.1.21)。

本仓库的原创定制采用 [MIT 许可](LICENSE)。派生自 Herdr App 的默认快捷键、布局、Mod 和补丁包含采用 [Apache 2.0 许可](licenses/herdr-app-0.1.15.txt) 的上游代码。CodeBuddy 的品牌和图标归原权利方。
