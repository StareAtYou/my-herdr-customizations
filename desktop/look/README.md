# 将工作区外观加入 Settings → Look

Herdr App v0.1.15 在启动时从二进制重建原生 Settings。应用本补丁后重新构建 App。

macOS 和 Windows 共用 `workspace-appearance.js` 及原生 Settings 插入点，用各自的 `platforms/<平台>/desktop/look-platform.js` 导入图片。原生毛玻璃通过 [macOS 补丁](../../platforms/macos/native/README.md) 启用。

macOS 在本仓库运行：

```sh
./desktop/look/apply.sh macos /path/to/herdr-app
```

Windows 在 PowerShell 中运行：

```powershell
git -C $HerdrSource apply (Resolve-Path desktop/look/native-settings-v0.1.15.patch).Path
$FrameSettings = Join-Path $HerdrSource 'defaults/frame/settings'
Copy-Item desktop/look/workspace-appearance.js $FrameSettings
Copy-Item platforms/windows/desktop/look-platform.js $FrameSettings
```

用 Herdr App 源码树执行 `cargo build --locked`。安装共享布局后，切到 `workspace-folders`，再打开 Settings 的 Look 页。
