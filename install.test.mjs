import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse } from 'smol-toml';
import { replaceRea, install, uninstall } from './install.mjs';
import { backendLaunch } from './sdk.mjs';
const plain = value => JSON.parse(JSON.stringify(value));

async function context(t) {
  const home = await mkdtemp(join(tmpdir(), 'rea-light-install spaces-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const codexHome = join(home, '.codex'); await mkdir(codexHome);
  return { home, codexHome, config: join(codexHome, 'config.toml') };
}

test('targeted TOML replacement preserves comments, quoted tables, other servers and multiline text', () => {
  const before = `# keep this comment\nmodel = "test"\nmessage = '''\n[mcp_servers.rea]\nthis is text\n'''\n[mcp_servers.other]\ncommand = "other" # untouched\n[mcp_servers."rea"]\ncommand = "rea"\nargs = ["mcp"]\n[mcp_servers.rea.env]\nREA_GHIDRA_COMMAND = "custom path"\n[projects."project with spaces"]\ntrust_level = "trusted"\n`;
  const entry = { command: 'C:\\Program Files\\nodejs\\node.exe', args: ['C:\\Users\\A\\.codex\\rea-light\\server.mjs'] };
  const after = replaceRea(before, entry);
  assert.ok(after.includes('# keep this comment'));
  assert.ok(after.includes('command = "other" # untouched'));
  assert.ok(after.includes("message = '''\n[mcp_servers.rea]\nthis is text\n'''"));
  const expected = parse(before); expected.mcp_servers.rea = entry;
  assert.deepEqual(plain(parse(after)), plain(expected));
  delete expected.mcp_servers.rea;
  assert.deepEqual(plain(parse(replaceRea(after, null))), plain(expected));
});

test('installation retains original REA policy and environment; uninstall keeps later unrelated changes', async t => {
  const p = await context(t);
  const original = '# config comment\nmodel = "control"\n[mcp_servers.rea]\ncommand = "rea"\nargs = ["mcp"]\ndefault_tools_approval_mode = "prompt"\n[mcp_servers.rea.env]\nREA_GHIDRA_COMMAND = "custom ghidra"\n';
  await writeFile(p.config, original);
  const result = await install({ ...p, noSkill: true });
  assert.equal(result.installed, true);
  const current = await readFile(p.config, 'utf8'), config = parse(current);
  assert.equal(config.mcp_servers.rea.command, process.execPath);
  assert.equal(config.mcp_servers.rea.default_tools_approval_mode, 'prompt');
  assert.equal(config.mcp_servers.rea.env.REA_GHIDRA_COMMAND, 'custom ghidra');
  assert.equal(await readFile(join(result.backup, 'config.toml'), 'utf8'), original);
  await writeFile(p.config, current + '\n[projects."new project"]\ntrust_level = "trusted"\n');
  await uninstall(p);
  const expected = parse(original); expected.projects = { 'new project': { trust_level: 'trusted' } };
  assert.deepEqual(plain(parse(await readFile(p.config, 'utf8'))), plain(expected));
});

test('fresh install and repeated install restore the original missing registration', async t => {
  const p = await context(t);
  await writeFile(p.config, 'model = "untouched"\n');
  const options = { ...p, noSkill: true, root: join(p.home, 'custom checkout with spaces') };
  await install(options);
  await install(options);
  await uninstall(p);
  assert.deepEqual(plain(parse(await readFile(p.config, 'utf8'))), { model: 'untouched' });
});

test('dry run writes nothing and duplicate/foreign registrations are not overwritten', async t => {
  const p = await context(t);
  const result = await install({ ...p, dryRun: true });
  assert.equal(result.config, p.config);
  await assert.rejects(readFile(p.config), { code: 'ENOENT' });
  await writeFile(p.config, '[mcp_servers.rea]\ncommand = "unrelated"\n');
  await assert.rejects(install({ ...p, noSkill: true }), /different server/);
  await writeFile(p.config, '[mcp_servers.old_rea]\ncommand = "rea"\nargs = ["mcp"]\n');
  await assert.rejects(install({ ...p, noSkill: true }), /duplicate the catalog/);
});

test('a later user edit to the managed entry blocks automatic uninstall', async t => {
  const p = await context(t);
  await install({ ...p, noSkill: true });
  const current = await readFile(p.config, 'utf8');
  await writeFile(p.config, current.replace('tool_timeout_sec = 3600', 'tool_timeout_sec = 1200'));
  await assert.rejects(uninstall(p), /edited after installation/);
  assert.ok((await readFile(p.config, 'utf8')).includes('tool_timeout_sec = 1200'));
});

test('existing skill is overlaid once and restored; later user edits are preserved', async t => {
  const p = await context(t), skillPath = join(p.home, '.agents', 'skills', 'reverse-engineer-anything');
  await mkdir(skillPath, { recursive: true });
  const original = '---\nname: reverse-engineer-anything\ndescription: Existing REA skill\n---\n\n# REA\n\nExisting instructions.\n';
  await writeFile(join(skillPath, 'SKILL.md'), original);
  await install(p); await install(p);
  const installed = await readFile(join(skillPath, 'SKILL.md'), 'utf8');
  assert.equal(installed.split('<!-- rea-light:start -->').length, 2);
  await uninstall(p);
  assert.equal(await readFile(join(skillPath, 'SKILL.md'), 'utf8'), original);
  await install(p);
  await writeFile(join(skillPath, 'SKILL.md'), (await readFile(join(skillPath, 'SKILL.md'), 'utf8')) + '\nUser additions.\n');
  const result = await uninstall(p);
  assert.equal(result.skillChanged, true);
  assert.ok((await readFile(join(skillPath, 'SKILL.md'), 'utf8')).includes('User additions.'));
});

test('missing REA skill is installed with upstream references and license', async t => {
  const p = await context(t); await install(p);
  const skillPath = join(p.codexHome, 'skills', 'reverse-engineer-anything');
  assert.ok((await readFile(join(skillPath, 'SKILL.md'), 'utf8')).includes('`rea_schema`'));
  assert.ok((await readFile(join(skillPath, 'REA-LICENSE'), 'utf8')).includes('MIT'));
  assert.ok((await readFile(join(skillPath, 'references', 'javascript-applications.md'), 'utf8')).length > 100);
  await uninstall(p);
  assert.ok(!(await readFile(join(skillPath, 'SKILL.md'), 'utf8')).includes('<!-- rea-light:start -->'));
});

test('bundled REA and Windows npm shims launch through Node without shell interpolation', async t => {
  const p = await context(t);
  const bundled = backendLaunch();
  assert.equal(bundled.command, process.execPath); assert.equal(bundled.args.at(-1), 'mcp');
  const shim = join(p.home, 'rea.cmd'), launcher = join(p.home, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
  await mkdir(dirname(launcher), { recursive: true });
  await writeFile(shim, '@echo off\n'); await writeFile(launcher, '// fixture');
  const launch = backendLaunch(shim);
  assert.equal(launch.command, process.execPath);
  assert.ok(launch.args[0].endsWith('rea.mjs')); assert.equal(launch.args[1], 'mcp');
});
