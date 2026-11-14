# 版本升级与回滚

## 官方基线

| 组件 | 官方标签 | Git 对象 |
| --- | --- | --- |
| Herdr App | [v0.1.15](https://github.com/herdrdev/herdr-app/tree/v0.1.15) | 9950887361af3ba218b9ce7a347cb8ec7b66c71d |
| Herdr Core | [v0.1.21](https://github.com/herdrdev/herdr-core/tree/v0.1.21) | 1b0393f80c35b1dae34f37934d33d0144a8fc8d7 |

共享布局和 Mod 可用于官方二进制。原生 Settings 外观、SSH 项目和 macOS 毛玻璃需要应用各自的补丁后重新构建桌面版。以 `app/` 作为可恢复快照，以 `patches/` 作为与上游的改动记录。

## 适配新版本

1. 阅读 [App 更新记录](https://github.com/herdrdev/herdr-app/blob/master/CHANGELOG.md) 和 [Core 更新记录](https://github.com/herdrdev/herdr-core/blob/master/CHANGELOG.md)。在单独目录取得目标版本的 App 源码。重点比对下表中的文件和该版本的 herdr.d.ts。
2. 在目标源码根目录对补丁逐个运行 git apply --check，参数传入本仓库 patches/ 中相应补丁的绝对路径。能干净应用时，在临时源码副本应用后把派生文件复制回 app/ 下对应的自定义路径。遇到冲突时，按补丁的功能意图合并到新的官方默认文件。
3. 更新布局和派生 Mod 清单里的 cloned_from.version，刷新 platforms/windows/baseline/keys.windows.json 与对应补丁。用新版本的 Herdr App 对 4 个 Mod 运行检查，并在隔离的 HERDR_APP_HOME 验收。
4. 验收后提交，更新基线和已验证版本，打一个新标签。旧标签可继续恢复旧版本配置。

| 官方默认路径 | 补丁 | 定制安装路径 |
| --- | --- | --- |
| defaults/layouts/main.json | layout.patch | app/layouts/workspace-folders.json |
| defaults/mods/new-menu/ | new-menu.patch | app/mods/new-menu-with-folder-picker/ |
| defaults/mods/spaces/ | spaces.patch | app/mods/spaces-with-folder-picker/ |
| defaults/mods/tabs/ | tabs.patch | app/mods/tabs-with-folder-picker/ |

工作区文件夹选择器、状态桥、Qoder 启动脚本和 DeepSeek TUI 启动配置直接保存在 app/ 中。换上游版本时继续携带这些定制，并检查 pickFolder、space.new、agents、pane.focus 和程序配置字段的兼容性。更新 CodeBuddy 后验证恢复脚本仍能在 npm 包中找到图标。

## 验收清单

- 从 **Spaces +**、新建标签菜单和 Ctrl+Shift+N 分别打开目录选择器。打开一个含空格或中文的测试目录，确认 Files 指向所选根目录。
- 在两个测试工作区各启动 AI CLI，确认每个会话显示在正确的 Spaces 条目下，且可从 Agents 或 Spaces 跳转。
- 右键未选中的项目，新建终端和 Agent，确认标签属于该项目且工作目录是项目根目录。对 SSH 项目检查终端与 Agent 均连接目标主机，并从远端项目根目录启动。
- 检查 CodeBuddy 图标，验证状态随提交提示、等待批准和结束响应变化。验证 Qoder 状态上报，以及 DeepSeek TUI 连续发送两轮提示。
- 开一个新的 Herdr 终端，运行 [Environment]::Is64BitProcess，确认返回 True。切换目录后检查 [Environment]::CurrentDirectory。
- 在 App 的终端里运行 herdr-app status，检查布局、按键、程序配置和 Mod 的加载错误。

## 回滚

1. 在 Herdr 切回 **main** 布局。快捷键是 Ctrl+Shift+L，也可以运行 herdr-app do layout.switch --name main。
2. 打开本次应用产生的 restore-manifest.json。对每个条目，将 backup 指向的相对文件从该备份目录复制回 path。backup 为 null 的条目表示本次新建，确认该路径仍是本次生成的文件后可删除。备份包含目标机旧配置，只保存在目标机。
3. 已打开的终端保留启动时使用的 Shell。打开新终端检查回滚后的 Shell 配置。

`patches/core-persistence-v0.1.21.patch` 是独立的 Core 源码补丁。它增加终端登记落盘失败提示，涉及 Unix 的终端持久化测试。正常安装只更新 App 配置。Windows 如需移植 Core 改动，可先按平台检查终端保活测试。
