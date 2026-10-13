import { readFile, writeFile, mkdir, rename, cp, unlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { parse, stringify } from 'smol-toml';

const require = createRequire(import.meta.url);
const root = dirname(fileURLToPath(import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
const markerStart = '<!-- rea-light:start -->', markerEnd = '<!-- rea-light:end -->';
const absent = async path => { try { return await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

// Table-like text inside multiline strings must never be treated as config sections.
function headers(source) {
  const found = []; let quote = null; let offset = 0;
  for (const line of source.split(/(?<=\n)/u)) {
    if (!quote && /^\s*\[/u.test(line)) {
      try {
        const value = parse(line.trim());
        const keys = Object.keys(value);
        found.push({ offset, rea: keys.length === 1 && keys[0] === 'mcp_servers' && Object.hasOwn(value.mcp_servers, 'rea') });
      } catch { /* The whole config is validated before editing. */ }
    }
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (quote) {
        if (quote === '"""' && ch === '\\') { i++; continue; }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = null; }
        continue;
      }
      if (ch === '#') break;
      if (line.startsWith('"""', i) || line.startsWith("'''", i)) { quote = line.slice(i, i + 3); i += 2; continue; }
      if (ch === '"' || ch === "'") {
        const single = ch;
        while (++i < line.length) {
          if (single === '"' && line[i] === '\\') { i++; continue; }
          if (line[i] === single) break;
        }
      }
    }
    offset += line.length;
  }
  return found;
}

export function replaceRea(source, entry) {
  parse(source);
  const sections = headers(source);
  let result = '', cursor = 0;
  for (let i = 0; i < sections.length; i++) {
    if (!sections[i].rea) continue;
    result += source.slice(cursor, sections[i].offset);
    cursor = sections[i + 1]?.offset ?? source.length;
  }
  result += source.slice(cursor);
  if (entry !== null && entry !== undefined) result += `\n${stringify({ mcp_servers: { rea: entry } })}`;
  parse(result);
  return result;
}

function isRea(entry) {
  const command = String(entry?.command || '').replaceAll('\\', '/');
  const args = entry?.args || [];
  return /(?:^|\/)rea(?:\.(?:cmd|exe|ps1))?$/iu.test(command) ||
    args.some(arg => /(?:rea-agents|rea-light|rea(?:\.mjs)?)(?:[\/\\]|$)/iu.test(String(arg)));
}

async function atomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  await writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
  try {
    for (let attempt = 0; ; attempt++) {
      try { await rename(temporary, path); break; }
      catch (e) {
        if (attempt >= 3 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        await new Promise(resolve => setTimeout(resolve, (attempt + 1) * 150));
      }
    }
  } finally { await unlink(temporary).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}

function paths(options) {
  const home = options.home || homedir();
  const codexHome = resolve(options.codexHome || process.env.CODEX_HOME || join(home, '.codex'));
  return { home, codexHome, config: join(codexHome, 'config.toml'), state: join(codexHome, 'rea-light-install.json') };
}

export async function install(options = {}) {
  const p = paths(options);
  const originalText = await absent(p.config) || '';
  const config = parse(originalText);
  const previous = await absent(p.state);
  const previousState = previous ? JSON.parse(previous) : null;
  const originalEntry = config.mcp_servers?.rea ?? null;
  if (originalEntry && !isRea(originalEntry)) throw new Error('The "rea" MCP name belongs to a different server. Rename it before installing REA Light.');
  const entry = { ...(originalEntry || {}), enabled: true, command: process.execPath, args: [join(options.root || root, 'server.mjs')], startup_timeout_sec: originalEntry?.startup_timeout_sec ?? 30, tool_timeout_sec: 3600 };
  for (const field of ['url', 'http_headers', 'env_http_headers', 'bearer_token_env_var', 'oauth_resource']) delete entry[field];
  if (entry.env) {
    entry.env = { ...entry.env };
    delete entry.env.REA_LIGHT_COMMAND;
    if (!Object.keys(entry.env).length) delete entry.env;
  }
  const duplicates = Object.entries(config.mcp_servers || {}).filter(([name, value]) => name !== 'rea' && value.enabled !== false && isRea(value));
  if (duplicates.length) throw new Error(`Other active REA MCP registrations would duplicate the catalog: ${duplicates.map(([name]) => name).join(', ')}. Disable those entries first; this installer changes only "rea".`);
  let skillPath = null;
  let skillOriginal = null;
  if (!options.noSkill) {
    const candidates = [join(p.codexHome, 'skills', 'reverse-engineer-anything'), join(p.home, '.agents', 'skills', 'reverse-engineer-anything')];
    for (const path of candidates) {
      const existing = await absent(join(path, 'SKILL.md'));
      if (existing !== null) { skillPath = path; skillOriginal = existing; break; }
    }
    skillPath ||= candidates[0];
  }
  const plan = { config: p.config, command: entry.command, args: entry.args, skill: skillPath, backend: 'bundled REA 6.4.0, launched with Node (no shell)' };
  if (options.dryRun) return plan;
  const backup = join(p.codexHome, 'backups', `rea-light-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}`);
  await mkdir(backup, { recursive: true, mode: 0o700 });
  await writeFile(join(backup, 'config.toml'), originalText, { mode: 0o600 });
  let updatedSkill = null;
  let createdSkill = false;
  if (skillPath) {
    if (skillOriginal === null) {
      const vendorRoot = dirname(require.resolve('rea-agents/package.json'));
      await cp(join(vendorRoot, 'skills', 'reverse-engineer-anything'), skillPath, { recursive: true, force: false, errorOnExist: true });
      await cp(join(vendorRoot, 'LICENSE'), join(skillPath, 'REA-LICENSE'));
      skillOriginal = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
      createdSkill = true;
    }
    await writeFile(join(backup, 'SKILL.md'), skillOriginal, { mode: 0o600 });
    const overlay = await readFile(join(root, 'skill-overlay.md'), 'utf8');
    const marked = `${markerStart}\n${overlay.trim()}\n${markerEnd}`;
    if (skillOriginal.includes(markerStart)) {
      const start = skillOriginal.indexOf(markerStart), end = skillOriginal.indexOf(markerEnd, start);
      if (end < start) throw new Error('The existing REA Light skill block is incomplete. Restore its backup first.');
      updatedSkill = skillOriginal.slice(0, start) + marked + skillOriginal.slice(end + markerEnd.length);
    } else if (skillOriginal.includes('`rea_search`') && skillOriginal.includes('`rea_call`')) {
      updatedSkill = skillOriginal;
    } else {
      const heading = skillOriginal.indexOf('\n# ');
      if (heading < 0) throw new Error('Existing REA skill has no Markdown heading; configuration has not been changed.');
      const end = skillOriginal.indexOf('\n', heading + 1);
      updatedSkill = skillOriginal.slice(0, end) + `\n\n${marked}\n` + skillOriginal.slice(end);
    }
  }
  const reinstall = previousState && canonical(previousState.installedEntry) === canonical(originalEntry);
  const state = {
    version: 1, installedEntry: entry, originalEntry: reinstall ? previousState.originalEntry : originalEntry,
    backup, skillPath, skillOriginal: reinstall && previousState.skillPath === skillPath ? previousState.skillOriginal : skillOriginal,
    skillInstalledHash: updatedSkill === null ? null : hash(updatedSkill), createdSkill: reinstall ? previousState.createdSkill : createdSkill,
  };
  let wroteState = false;
  try {
    if (updatedSkill !== null) await atomic(join(skillPath, 'SKILL.md'), updatedSkill);
    // Do not overwrite a config changed by another process during installation.
    if ((await absent(p.config) || '') !== originalText) throw new Error('Codex configuration changed during installation. Retry after the other write finishes.');
    await atomic(p.state, JSON.stringify(state, null, 2) + '\n');
    wroteState = true;
    await atomic(p.config, replaceRea(originalText, entry));
  } catch (error) {
    if (skillPath && skillOriginal !== null) await atomic(join(skillPath, 'SKILL.md'), skillOriginal);
    if (wroteState) {
      if (previous !== null) await atomic(p.state, previous);
      else await unlink(p.state).catch(e => { if (e.code !== 'ENOENT') throw e; });
    }
    throw error;
  }
  return { ...plan, backup, installed: true };
}

export async function uninstall(options = {}) {
  const p = paths(options), stateText = await absent(p.state);
  if (!stateText) throw new Error('No REA Light installation record was found.');
  const state = JSON.parse(stateText);
  const current = await readFile(p.config, 'utf8');
  if (canonical(parse(current).mcp_servers?.rea) !== canonical(state.installedEntry)) throw new Error('The REA MCP entry was edited after installation. Restore it manually from the recorded backup; other changes will not be overwritten.');
  let skillChanged = false;
  if (state.skillPath) {
    const skill = await absent(join(state.skillPath, 'SKILL.md'));
    skillChanged = skill === null || hash(skill) !== state.skillInstalledHash;
  }
  if (options.dryRun) return { config: p.config, restoreOriginalRea: !!state.originalEntry, skillChanged };
  if ((await readFile(p.config, 'utf8')) !== current) throw new Error('Codex configuration changed during uninstall. Retry after the other write finishes.');
  await atomic(p.config, replaceRea(current, state.originalEntry));
  if (state.skillPath && !skillChanged) await atomic(join(state.skillPath, 'SKILL.md'), state.skillOriginal);
  await rename(p.state, join(dirname(p.state), `rea-light-uninstalled-${randomUUID()}.json`));
  return { uninstalled: true, config: p.config, skillChanged, resultsPreserved: true, backup: state.backup };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--codex-home') { options.codexHome = args[++i]; if (!options.codexHome) throw new Error('--codex-home requires a path.'); }
    else if (args[i] === '--dry-run') options.dryRun = true;
    else if (args[i] === '--no-skill') options.noSkill = true;
    else if (args[i] === '--uninstall') options.uninstall = true;
    else if (args[i] === '--help') { console.log('node install.mjs [--codex-home PATH] [--dry-run] [--no-skill] [--uninstall]'); return; }
    else throw new Error(`Unknown option: ${args[i]}`);
  }
  console.log(JSON.stringify(await (options.uninstall ? uninstall(options) : install(options)), null, 2));
  if (!options.dryRun) console.log('Restart Codex and open a new task to reload MCP tools.');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(`REA Light: ${error.message}`); process.exitCode = 1; });
