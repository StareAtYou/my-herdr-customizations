# macOS 原生毛玻璃

对 Herdr App v0.1.15 应用本目录的毛玻璃补丁和[跨平台 Look 集成](../../../desktop/look/README.md)。

```sh
git checkout v0.1.15
git submodule update --init --recursive
git apply /path/to/my-herdr-customizations/platforms/macos/native/desktop-glass-v0.1.15.patch
/path/to/my-herdr-customizations/desktop/look/apply.sh macos "$PWD"
cargo build --locked
```

在 **Settings → Look → Workspace appearance** 选择 **macOS Glass** 并应用。侧栏与标签栏可透出窗口后的模糊内容，终端正文使用实色。全屏或系统「降低透明度」开启时使用实色窗口。

Apple Silicon 构建包可解压后打开 `Herdr Glass.app`。它使用 Herdr 的现有配置目录。切换桌面程序时，先退出正在打开的 Herdr 窗口，再打开 Herdr Glass。
