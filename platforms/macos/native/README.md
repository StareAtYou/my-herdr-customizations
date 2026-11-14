# macOS 原生毛玻璃

对 Herdr App v0.1.15 源码应用 `desktop-glass-v0.1.15.patch`。使用支持上游版本的 Rust、Xcode 和 Zig 构建桌面 App。

```sh
git checkout v0.1.15
git submodule update --init --recursive
git apply /path/to/my-herdr-customizations/platforms/macos/native/desktop-glass-v0.1.15.patch
cargo build --locked
```

安装本仓库的共享布局后，在工作区外观选择 **macOS Glass**。侧栏与标签栏可透出窗口后的模糊内容，终端正文使用实色。全屏或系统「降低透明度」开启时使用实色窗口。此补丁只应用于 Herdr App。配置包可在官方 App 上使用纯色、渐变和背景图片。

已有 Apple Silicon 构建包时，可解压后打开 `Herdr Glass.app`。它使用 Herdr 的现有配置目录。要切换桌面程序，先退出正在打开的 Herdr 窗口，再打开 Herdr Glass。
