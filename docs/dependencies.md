# Windows 依赖

下面记录生成快照时的 CLI 版本，供复现与定位版本变更。目标机可以使用相同版本。升级第三方 CLI 后，按 [验收清单](upgrading.md#验收清单) 验证路径和状态事件。

| 入口 | 依赖 |
| --- | --- |
| Codex | Windows 的 codex.exe。脚本先从 PATH 查找，再查找 Codex 桌面版安装目录中的版本化 CLI。 |
| CodeBuddy Code | Node.js 和 npm 全局包 @tencent-ai/codebuddy-code@2.183.0 |
| OpenCode | npm 全局包 @opencode/cli@2.2.7，或 PATH 上的 opencode.exe |
| Pi | Node.js 和 npm 全局包 @earendil-works/pi-coding-agent@1.5.2 |
| DeepSeek Harness | Node.js、@deepseek-ai/dsh@0.2.2-rc.1、dsh-tui profile 中的 @deepseek-harness-tui/dsh-tui@0.19.0 |
| Qoder | Qoder CLI 安装在 %USERPROFILE%\.qoder\bin\qodercli\qodercli.exe。首次使用时在 CLI 登录。 |

需要复现 npm 版本时，按所需入口选择以下命令：

~~~powershell
npm.cmd install -g '@tencent-ai/codebuddy-code@2.183.0'
npm.cmd install -g '@opencode/cli@2.2.7'
npm.cmd install -g '@earendil-works/pi-coding-agent@1.5.2'
npm.cmd install -g '@deepseek-ai/dsh@0.2.2-rc.1'
dsh.cmd plugin --profile dsh-tui add --save-exact '@deepseek-harness-tui/dsh-tui@0.19.0'
~~~

DeepSeek 使用目标机自己的账号认证。安装插件后，在 Herdr 的 **DeepSeek Harness** 入口按 CLI 提示完成登录。DSH_HOME 可以指定其他 DSH 配置目录。脚本检测 dsh-tui profile 的安装状态。

恢复脚本从已安装的 CodeBuddy npm 包复制 vendor/assets/icon.png。包内缺少该资源时，沿用已有图标，或让 Herdr 为新入口使用默认图标。CodeBuddy 的菜单入口为这一进程注入状态桥接和 hooks。新增支持事件的 CLI 时，可以参考 [状态接入说明](../app/launchers/agent-status/README.md)。Agents 的显示依赖 CLI 上报真实事件。登录、权限交互和会话恢复由各 CLI 实现。

如果另需将 **Windows Terminal** 默认终端设置为 64 位 PowerShell 7，先运行下列命令取得实际路径：

~~~powershell
[Environment]::Is64BitProcess
Join-Path $PSHOME 'pwsh.exe'
~~~

第一行应返回 True。在 Windows Terminal 的配置文件设置中将命令行设为第二行返回的真实 pwsh.exe 路径，再在“启动”里将该配置文件设为默认。这个系统设置单独管理。
