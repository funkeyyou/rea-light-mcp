REA Light MCP v1.1.0

- 将内置 REA 从 6.4.0 更新至 6.8.0。按需访问 229 个后端工具，Codex 仍只常驻加载 4 个工具。
- Windows 实测序列化工具定义从 3,504,966 字符缩小到 2,784 字符（约 99.92%）；字符数不是精确 token 数。
- REA 6.8 的 `analyze_function` 默认返回保留的摘要；需要旧式完整内联结果时指定 `detail: "complete"`。
- 安装器保留已有 REA skill，不会自动将现有 skill 替换为新版；无现有 skill 时安装随 REA 6.8 附带的版本。

需要 Node.js ^22.23.4、^24.22.1 或 >=26.12.1。原生分析引擎仍需自行配置。安装后完全退出并重开 Codex，再开新任务。

验证：Windows、macOS、Linux CI 通过 17 项测试和真实 REA JavaScript smoke test；Windows 另测 PowerShell 安装和卸载。
