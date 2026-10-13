# REA Light MCP

简体中文 · [繁體中文](README.zh-Hant.md) · [English](README.en.md)

给 [REA](https://github.com/morluto/rea) 加一层轻量 MCP 入口。Codex 启动时只加载 **4 个工具**，需要某项逆向功能时再读取它的参数和调用它，避免一次把完整工具清单塞进上下文。

这是独立适配器，并非 REA 或 OpenAI 官方项目。

## 效果

REA 6.4.0 的工具清单实测：

| | 原始 REA MCP | REA Light MCP |
|---|---:|---:|
| 常驻工具 | 170 | 4 |
| 序列化工具定义 | 1,954,674 字符 | 2,784 字符 |

工具定义大小减少约 **99.86%**。这是字符数，不是精确 token 数；系统指令、其他工具和历史消息仍会占用上下文。

- 保留全部 REA 后端工具，按需搜索和调用。
- 同一个 MCP 连接保留一个后端进程，延续当前目标和 Evidence。
- 大型结果完整存到本机，支持分段读取与直接传给下一次调用。
- 错误和限制照常返回；后端丢失状态时不会偷偷重启、重试。
- 支持 Windows、macOS、Linux，安装器备份配置并附带 skill。

## 安装

需要 Node.js 24.11+ LTS（也支持 22.19+ 或 26+）。无须先安装全局 REA；固定版本 REA 6.4.0 会作为项目依赖安装。原生分析仍需要相应分析引擎；安装器不会自动安装 Hopper、Ghidra、IDA、Java 等软件。

### Windows PowerShell

```powershell
$p = Join-Path $env:TEMP 'rea-light-install.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.sh -o /tmp/rea-light-install.sh && bash /tmp/rea-light-install.sh
```

安装器校验发布包的 SHA-256，下载到独立版本目录，安装依赖并测试 MCP，最后替换 `[mcp_servers.rea]`。旧版正在运行时不会覆盖它的程序文件。`CODEX_HOME` 自定义路径也支持。

完成后**完全退出并重新打开 Codex，再开一个新任务**。旧对话已经包含的工具定义和历史不会自动缩小。MCP 随 Codex 以 stdio 启动，不需要常驻终端/CMD 窗口。

如果配置中还有其他名称的完整 REA 服务器，安装器会提示先禁用，避免重复加载。项目级 `.codex/config.toml` 或托管配置也可能覆盖用户配置；请确认当前项目没有另一个 REA 注册。

### 从源码安装

```bash
git clone https://github.com/funkeyyou/rea-light-mcp.git
cd rea-light-mcp
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
node install.mjs
```

此方式直接使用这个目录，不要安装后删除或移动它。

```bash
node install.mjs --dry-run
node install.mjs --codex-home "path/to/.codex"
node install.mjs --no-skill
```

已有的 REA skill 会保留并加上轻量调用指引；没有时从依赖中的原始 skill 安装，保留参考文件与许可证。其他 Codex 配置和 REA 环境变量保留。安装器操作的是用户级配置；[Codex 官方 MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp)说明了用户级与项目级配置方式。

## 使用

| 工具 | 用途 |
|---|---|
| `rea_search` | 按英文关键词寻找功能，返回名称、简述与操作标注 |
| `rea_schema` | 读取某一个工具的完整输入 Schema |
| `rea_call` | 使用对应参数执行工具；操作保持顺序 |
| `rea_result` | 按 JSON pointer 和字符偏移读取存档 |

执行器可能修改数据、访问网络、启动程序或操作 UI，因此不是只读工具。需要遵守实际操作的用户授权与 REA 标注。

超过 24,000 字符的结果存到 `$CODEX_HOME/rea-light/results`，返回 `result_id`、路径与 `complete_on_disk: true`。这表示文件完整，不表示显示的摘要完整。Unix 文件权限设为仅所有者可读写；Windows 使用用户目录继承的 ACL。

`rea_call.result_refs` 可把保存的 JSON 直接填入后续操作的参数，避免再次塞进上下文。每项指定 `result_id`、`result_pointer` 和 `argument_pointer`；默认结果指针为 `/structuredContent`。先确认真实结果结构，不能仅凭文件名推断 Evidence 位置。

结果不会自动删除，可能含被分析的应用数据。卸载连接也保留这些文件。重启 Codex 会结束后端的内存状态；需要保留的原生分析应先导出 Evidence／快照。

## 还原连接

在安装器最后显示的安装目录中运行：

```bash
node install.mjs --uninstall
```

还原原来的 REA 注册及未被手动编辑的 skill，保留其他配置和结果。如果安装后手动修改过 REA 注册，安装器会停止自动覆盖，并指向备份。它不会删除 Node.js、分析引擎或项目代码。

## 测试与维护

```bash
npm test
npm run smoke
```

GitHub CI 在 Windows、macOS、Linux 上执行单元测试与真实 REA JavaScript 流程；Windows 另测 PowerShell 安装和还原。测试不调用模型 API，也不启动用户应用。

默认后端固定为依赖中的 REA。确有需要时可以在 `[mcp_servers.rea.env]` 设 `REA_LIGHT_COMMAND` 指向另一份 REA；标准 Windows npm shim 会转成 Node 启动，避免 shell 路径问题。依赖更新需要重新验证，不能假设所有新版本都兼容。

MIT · [第三方许可说明](THIRD_PARTY.md)
