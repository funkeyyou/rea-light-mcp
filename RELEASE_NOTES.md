REA Light MCP v1.3.0

- 更新内置 REA 至 6.10.1；263 个后端工具按需访问，Codex 仍只常驻加载 4 个入口。
- Windows 实测工具定义由 352,122 字符降至 2,784 字符，减少约 99.21%（REA 6.10 默认关闭输出 schema 并使用紧凑输入 schema）；不是精确 token 数。
- 保留 REA 6.10 的 Evidence revision 2 与默认 1,024 元素 MCP 输入限制；完整 Evidence 超限时使用 retained-evidence 或 evidence-file，转接器保留上游限制与错误，不自动重试。
- 完整 inline Evidence 回传的 smoke test 明确设置较高输入额度；正式安装不提高默认额度。
- 安装器保留已有 skill 与参考文件，备份 Codex 配置，并使用独立版本目录。

需要 Node.js ^22.23.4、^24.22.1 或 >=26.12.1。安装后完全退出并重开 Codex，再开新任务。

验证：Windows、macOS、Linux CI 通过 17 项单元测试、真实 REA JavaScript 分析、目标状态保留、Evidence 复用、分页与引用回传；Windows 另测 PowerShell 安装与卸载。
