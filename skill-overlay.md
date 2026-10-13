## Lightweight Codex connection

When the server exposes `rea_search`, `rea_schema`, `rea_call`, and `rea_result`,
use this lightweight adapter. All REA operation names in this skill remain
available as backend operations. For a known name, read `rea_schema`, then use
`rea_call` with that exact name and schema-matching `arguments`. Use `rea_search`
with English keywords only when discovery is needed. Do not load every schema
or the entire catalog at the beginning of a task.

One persistent backend retains the active target and Evidence for the MCP
connection. Prefer summary analyses and focused retained-Evidence views.
Responses with `result_id` and `complete_on_disk: true` are complete on disk,
not complete inline. Use `rea_result` with a JSON pointer and character offsets
to read the needed part; follow `next_offset` when complete text is required.
Read the actual result structure before choosing a JSON pointer. Use
`rea_call.result_refs` to pass saved JSON without loading full Evidence into
context: each entry has `result_id`, `result_pointer` (default
`/structuredContent`) and `argument_pointer`. For an inline Evidence source,
set `source.kind` to `inline` and inject its Evidence at `/source/evidence`.
Saved image paths can be viewed with a normal local image tool.

Read the selected operation's annotations and respect its effects and user
scope. Generic execution can modify data, launch processes or interact with
UI. Errors, limitations and partial coverage remain authoritative. Backend
loss never silently restarts or retries an analysis. Standard REA setup can
overwrite this custom registration and skill overlay; rerun this adapter's
installer after intentionally refreshing standard REA setup.
