#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
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

function copyPackageContents(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir)) {
    if (entry === '.git' || entry === 'tmp' || entry === 'node_modules') continue;
    cpSync(join(sourceDir, entry), join(targetDir, entry), { recursive: true });
  }
}

const packageDir = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const targetDir = join(homedir(), '.opencli', 'plugins', 'awb');
const targetNodeModulesDir = join(targetDir, 'node_modules');
const opencliLinkDir = join(targetNodeModulesDir, '@jackwener');
const opencliLinkPath = join(opencliLinkDir, 'opencli');
const opencliDir = resolveGlobalOpencliDir();

mkdirSync(dirname(targetDir), { recursive: true });
rmSync(targetDir, { recursive: true, force: true });
copyPackageContents(packageDir, targetDir);

if (!opencliDir) {
  log('\x1b[33m!\x1b[0m Installed awb plugin files, but could not find global `@jackwener/opencli`.');
  log('  Install it first: npm install -g @jackwener/opencli');
  log(`  Then create the link manually: ln -s "<opencli_dir>" "${opencliLinkPath}"`);
  process.exit(0);
}

mkdirSync(opencliLinkDir, { recursive: true });
rmSync(opencliLinkPath, { recursive: true, force: true });
symlinkSync(opencliDir, opencliLinkPath, 'dir');

for (const dependencyName of ['qrcode']) {
  const packageJsonPath = require.resolve(`${dependencyName}/package.json`);
  const dependencyDir = dirname(packageJsonPath);
  const dependencyLinkPath = join(targetNodeModulesDir, dependencyName);
  mkdirSync(dirname(dependencyLinkPath), { recursive: true });
  rmSync(dependencyLinkPath, { recursive: true, force: true });
  symlinkSync(dependencyDir, dependencyLinkPath, 'dir');
}

log(`\x1b[32m✓\x1b[0m Installed awb plugin → ${targetDir}`);
log(`\x1b[32m✓\x1b[0m Linked opencli runtime → ${opencliLinkPath}`);
log('  Run: opencli awb --help');
