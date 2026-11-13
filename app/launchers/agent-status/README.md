# Herdr 的 CLI 状态接入

支持 OSC 7501 的 CLI 可以直接在 Herdr 终端里上报状态。若原生自动探测失效，优先使用 CLI 自己提供的开关，例如 Qoder 的 QODER_PROGRAM_STATUS=1。

对于提供生命周期 hooks 的 CLI，菜单的 run 可以配置为 [node.exe, bridge.cjs 的绝对路径, app-id, CLI 可执行文件, 参数…]。Windows 下请使用真实 exe，Node CLI 可用 node.exe 加脚本路径。app-id 应与 programs.json 中的应用键一致。

bridge.cjs 只在 Herdr Core 终端内给子进程设置 HERDR_AGENT_STATUS_PIPE。适配器可以连接该本地命名管道，发送一条 JSON 后关闭连接。可用状态为 idle、working、blocked、done、error、clear。blocked 可以附带 kind（permission、question、auth），状态也可附带短 title。只发送 CLI 实际产生的事件。CodeBuddy 的 codebuddy-hooks.json 和 hook.cjs 是一组可参考的适配器。

原生 Agents 面板根据这些报告显示状态、定位终端并应用提醒。工作区信任、登录、子代理和会话恢复仍取决于 CLI 提供的接口。
