REA Light MCP v1.2.0

- 更新内置 REA 至 6.9.0；255 个后端工具按需访问，Codex 仍只常驻加载 4 个入口。
- Windows 实测工具定义由 4,655,032 字符降至 2,784 字符，减少约 99.94%；不是精确 token 数。
- REA 6.9 默认限制 MCP 输入为 1,024 个元素。完整 Evidence 超限时使用 retained-evidence 或 evidence-file；转接器保留上游限制与错误，不自动重试。
- 完整 inline Evidence 回传的 smoke test 明确设置较高输入额度；正式安装不提高默认额度。
- 安装器保留已有 skill 与参考文件，备份 Codex 配置，并使用独立版本目录。

需要 Node.js ^22.23.4、^24.22.1 或 >=26.12.1。安装后完全退出并重开 Codex，再开新任务。

验证：17 项单元测试、真实 REA JavaScript 分析、目标状态保留、Evidence 复用、分页与引用回传。发布前须通过 Windows、macOS、Linux CI，Windows 另测安装与卸载。
