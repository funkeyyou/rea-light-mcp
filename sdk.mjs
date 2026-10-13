import { createRequire } from 'node:module';
import { realpathSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';

const require = createRequire(import.meta.url);

// Resolve Windows npm shell shims to JavaScript; never spawn through a shell.
export function backendLaunch(override = process.env.REA_LIGHT_COMMAND) {
  if (!override) {
    const root = dirname(require.resolve('rea-agents/package.json'));
    return { command: process.execPath, args: [join(root, 'scripts', 'rea.mjs'), 'mcp'] };
  }
  const file = realpathSync(override);
  const extension = extname(file).toLowerCase();
  if (['.cmd', '.bat', '.ps1'].includes(extension)) {
    const launcher = join(dirname(file), 'node_modules', 'rea-agents', 'scripts', 'rea.mjs');
    if (!existsSync(launcher)) throw new Error('Cannot resolve this REA shell shim. Set REA_LIGHT_COMMAND to the absolute rea.mjs launcher or leave it unset to use bundled REA.');
    return { command: process.execPath, args: [launcher, 'mcp'] };
  }
  if (['.mjs', '.js', '.cjs'].includes(extension)) return { command: process.execPath, args: [file, 'mcp'] };
  return { command: file, args: ['mcp'] };
}

export function loadSdk() {
  return {
    ...require('@modelcontextprotocol/server'),
    ...require('@modelcontextprotocol/server/stdio'),
    ...require('@modelcontextprotocol/client'),
    ...require('@modelcontextprotocol/client/stdio'),
    z: require('zod').z,
    ...backendLaunch(),
  };
}
