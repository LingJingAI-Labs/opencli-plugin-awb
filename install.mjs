#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const log = (msg) => process.stderr.write(`${msg}\n`);

function resolveGlobalOpencliDir() {
  const candidates = [];

  try {
    const npmRoot = execSync('npm root -g', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (npmRoot) {
      candidates.push(join(npmRoot, '@jackwener', 'opencli'));
    }
  } catch {}

  const prefix = process.env.npm_config_prefix;
  if (prefix) {
    candidates.push(join(prefix, 'lib', 'node_modules', '@jackwener', 'opencli'));
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

const packageDir = dirname(fileURLToPath(import.meta.url));
const targetDir = join(homedir(), '.opencli', 'plugins', 'awb');
const linkDir = join(targetDir, 'node_modules', '@jackwener');
const linkPath = join(linkDir, 'opencli');
const opencliDir = resolveGlobalOpencliDir();

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
mkdirSync(targetDir, { recursive: true });

for (const file of ['common.js', 'index.js', 'README.md', 'package.json']) {
  cpSync(join(packageDir, file), join(targetDir, file));
}

if (!opencliDir) {
  log('\x1b[33m!\x1b[0m Installed awb plugin files, but could not find global `@jackwener/opencli`.');
  log('  Install it first: npm install -g @jackwener/opencli');
  log(`  Then create the link manually: ln -s "<opencli_dir>" "${linkPath}"`);
  process.exit(0);
}

mkdirSync(linkDir, { recursive: true });
rmSync(linkPath, { recursive: true, force: true });
symlinkSync(opencliDir, linkPath, 'dir');

log(`\x1b[32m✓\x1b[0m Installed awb plugin → ${targetDir}`);
log(`\x1b[32m✓\x1b[0m Linked opencli runtime → ${linkPath}`);
log('  Run: opencli awb --help');
