# SSH 项目源码补丁

此补丁用于 Herdr App v0.1.15，macOS 和 Windows 共用。应用补丁后重新构建 App，并用对应平台的恢复脚本安装 `workspace-folders` 布局及其 Mod。

macOS 在本仓库运行

```sh
git -C /path/to/herdr-app apply "$PWD/desktop/projects/ssh-projects-v0.1.15.patch"
```

Windows 在 PowerShell 中运行

```powershell
git -C $HerdrSource apply (Resolve-Path desktop/projects/ssh-projects-v0.1.15.patch).Path
```

在 Herdr App 源码树执行 `cargo build --locked`。Windows 需启用 OpenSSH Client，并确保 `ssh.exe` 可从终端启动。SSH 主机需提供 POSIX 目录及 Shell。已有的远程 Herdr Core 工作区仍可使用。
