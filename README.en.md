# REA Light MCP

[简体中文](README.md) · [繁體中文](README.zh-Hant.md) · English

A stateful lightweight gateway for [REA](https://github.com/morluto/rea).
Codex sees four tools at startup and retrieves individual schemas only when
needed. All backend operations remain available. This is an independent adapter,
not an official REA or OpenAI project.

Measured with REA 6.8.0 on Windows: the serialized tool catalog drops from 229 tools /
3,504,966 characters to four tools / 2,784 characters, about 99.92% smaller.
These are character counts, not exact token savings. Other instructions, tools
and conversation history still consume context.

## Install

The source version requires Node.js ^22.23.4, ^24.22.1, or >=26.12.1. Pinned REA 6.8.0 is installed as a
dependency; a global REA CLI is unnecessary. Native analysis still needs the
appropriate user-configured engine. The installer does not install external
engines or modify unrelated software.

The release commands below still install v1.0.0 with REA 6.4.0. Use the source installation below for REA 6.8.0.

Windows PowerShell:

```powershell
$p = Join-Path $env:TEMP 'rea-light-install.ps1'; Invoke-WebRequest 'https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.ps1' -OutFile $p; powershell -NoProfile -ExecutionPolicy Bypass -File $p
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/funkeyyou/rea-light-mcp/v1.0.0/install.sh -o /tmp/rea-light-install.sh && bash /tmp/rea-light-install.sh
```

The installer verifies the release SHA-256, creates a separate version directory,
installs pinned dependencies, verifies MCP, backs up Codex config, replaces
`mcp_servers.rea`, and adds lightweight instructions to the existing REA skill
(or installs the upstream skill if absent). Unrelated config and REA environment
variables are preserved. `CODEX_HOME` is supported. Other active REA registrations
must be disabled first to avoid duplicate catalogs; project or managed settings
can also override user configuration.

Fully quit and restart Codex, then open a new task. Existing conversation history
does not shrink automatically. MCP runs over stdio under Codex; no persistent
CMD or terminal window is required.

Source installation:

```bash
git clone https://github.com/funkeyyou/rea-light-mcp.git
cd rea-light-mcp
npm ci --ignore-scripts --no-audit --no-fund
node verify.mjs
node install.mjs
```

Keep that source directory in place. Supported installer options:
`--codex-home PATH`, `--dry-run`, `--no-skill`, and `--uninstall`.

## Tools and state

| Tool | Purpose |
|---|---|
| `rea_search` | Discover operations by English keywords |
| `rea_schema` | Retrieve one complete input schema and annotations |
| `rea_call` | Execute the operation with schema-matching arguments |
| `rea_result` | Read saved JSON pointers / character-offset pages |

One lazy backend persists for the MCP connection. Execution serializes; backend
loss is explicit and never silently restarts or retries an operation. The generic
execution tool is marked potentially destructive because actual operations can
modify data, access networks, launch processes or interact with UI.

Results over 24,000 serialized characters are saved completely under
`$CODEX_HOME/rea-light/results`. Inline summaries explicitly indicate partial
display and provide paths and IDs. `complete_on_disk` is not a completeness claim
for the displayed summary. Unix files use owner-only permissions; Windows files
inherit the user's directory ACLs. Images are also saved for local viewing.

`rea_call.result_refs` injects stored JSON into later operation arguments without
putting complete Evidence back into context. Each entry uses `result_id`,
`result_pointer` (default `/structuredContent`), and `argument_pointer`.
Inspect the actual result shape before choosing pointers.

Results may contain application data and are not automatically deleted. A Codex
restart discards the backend's in-memory target; export needed Evidence/snapshots
first. Restore registration using `node install.mjs --uninstall` from the install
directory. Later unrelated config edits are retained; manually changed REA
entries stop automatic restoration. Modified skills are preserved. Code,
analysis results and external engines are not deleted.

## Validation

Run `npm test` and `npm run smoke`. CI tests Windows, macOS and Linux, with an
additional PowerShell install/restore test on Windows. Smoke analysis uses
synthetic JavaScript and does not launch user applications or call model APIs.

The default backend is the pinned npm dependency, launched with Node without a
shell. Set `REA_LIGHT_COMMAND` in the MCP environment only to deliberately select
another absolute launcher; standard Windows npm shims resolve to JavaScript.
Revalidate dependency changes rather than assuming future versions are compatible.

MIT · [Third-party notices](THIRD_PARTY.md) ·
[Official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)
