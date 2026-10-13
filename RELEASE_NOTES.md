REA Light MCP v1.0.0

首次发布独立的 REA 轻量 MCP 适配器，支持 Windows、macOS 和 Linux。

- Codex 常驻加载 4 个工具；REA 6.4.0 的全部 170 个后端工具按需调用。
- 实测序列化工具定义从 1,954,674 字符缩小到 2,784 字符（约 99.86%）；不是精确 token 数。
- 保留分析目标及 Evidence 状态；大型结果完整存档，支持分段读取与直接复用。
- 提供 PowerShell 和 Bash 安装命令、发布包 SHA-256 校验、配置备份及连接还原。
- 固定依赖版本并通过 Node 启动后端，支持 Windows npm shim 与带空格的路径。
- 保留现有 REA skill，并加入轻量调用指引；新机器自动安装原始 skill 与参考文件。
- 提供简体中文、繁体中文、英语文档。

验证：17 项测试，以及真实 REA JavaScript 分析、目标状态延续、Evidence 复用和结果分页。GitHub CI 同时验证三种操作系统，Windows 另测 PowerShell 安装和还原。

需要 Node.js 24.11+ LTS（也支持 22.19+ 或 26+）；原生分析引擎仍需自行配置。安装后完全退出并重开 Codex，再开新任务。
