#!/usr/bin/env bash
set -euo pipefail
version=1.0.0
codex_dir="${CODEX_HOME:-$HOME/.codex}"
node_path=$(command -v node) || { echo 'Install Node.js 24.11+ LTS first.' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required.' >&2; exit 1; }
"$node_path" -e 'const [a,b]=process.versions.node.split(".").map(Number);if(!((a===22&&b>=19)||(a===24&&b>=11)||a>=26))process.exit(1)' || { echo 'Install Node.js 24.11+ LTS first.' >&2; exit 1; }
task_temp=$(mktemp -d)
asset="rea-light-mcp-v$version.tar.gz"
release="https://github.com/funkeyyou/rea-light-mcp/releases/download/v$version"
curl -fsSL "$release/$asset" -o "$task_temp/$asset"
curl -fsSL "$release/SHA256SUMS" -o "$task_temp/SHA256SUMS"
expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$task_temp/SHA256SUMS")
if command -v shasum >/dev/null; then actual=$(shasum -a 256 "$task_temp/$asset" | awk '{print $1}'); else actual=$(sha256sum "$task_temp/$asset" | awk '{print $1}'); fi
[ -n "$expected" ] && [ "$actual" = "$expected" ] || { echo 'Release checksum mismatch.' >&2; exit 1; }
install_dir="$codex_dir/rea-light/versions/v$version-$(basename "$task_temp")"
mkdir -p "$install_dir"
tar -xzf "$task_temp/$asset" -C "$install_dir"
cd "$install_dir"
npm ci --ignore-scripts --no-audit --no-fund
"$node_path" verify.mjs
"$node_path" install.mjs --codex-home "$codex_dir"
printf 'Installed at: %s\nRestart Codex and open a new task.\n' "$install_dir"
# The uniquely-created temporary download directory is kept for troubleshooting.
