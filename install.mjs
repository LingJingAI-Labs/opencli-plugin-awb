#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, symlinkSync } from 'node:fs';
import fs from 'node:fs';
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

function patchFile(filePath, transform) {
  if (!existsSync(filePath)) return { changed: false, reason: 'missing' };
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after === before) return { changed: false, reason: 'unchanged' };
  fs.writeFileSync(filePath, after, 'utf8');
  return { changed: true, reason: 'patched' };
}

function patchOpencliCommanderAdapter(opencliDir) {
  const filePath = join(opencliDir, 'dist', 'commanderAdapter.js');
  return patchFile(filePath, (source) => {
    let next = source;
    next = next.replace(
      /return date\.toLocaleString(?:\([^;]*\))?;/,
      "return date.toLocaleString('zh-CN', { hour12: false });",
    );
    next = next.replace(
      /formatAwbStatusRow\('品牌名称',\s*'[^']*',\s*labelWidth,\s*orangeSoft\)/,
      "formatAwbStatusRow('品牌名称', '灵境AI | https://lingjingai.cn/', labelWidth, orangeSoft)",
    );
    return next;
  });
}

function patchOpencliOutput(opencliDir) {
  const filePath = join(opencliDir, 'dist', 'output.js');
  return patchFile(filePath, (source) => {
    const helperStartCandidates = [
      source.indexOf('// AWB_PRESENTATION_PATCH_START'),
      source.indexOf('function charDisplayWidth(char) {'),
      source.indexOf('function stringWidth(text) {'),
      source.indexOf('function renderTable(data, opts) {'),
    ].filter((value) => value >= 0);
    const helperStart = helperStartCandidates.length ? Math.min(...helperStartCandidates) : -1;
    const helperEnd = source.indexOf('function renderJson(data) {');
    if (helperStart === -1 || helperEnd === -1 || helperEnd <= helperStart) return source;
    const replacement = `// AWB_PRESENTATION_PATCH_START
function charDisplayWidth(char) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 0;
    if ((code >= 0x1100 && code <= 0x115f) ||
        (code >= 0x2329 && code <= 0x232a) ||
        (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
        (code >= 0xac00 && code <= 0xd7a3) ||
        (code >= 0xf900 && code <= 0xfaff) ||
        (code >= 0xfe10 && code <= 0xfe19) ||
        (code >= 0xfe30 && code <= 0xfe6f) ||
        (code >= 0xff00 && code <= 0xff60) ||
        (code >= 0xffe0 && code <= 0xffe6) ||
        (code >= 0x1f300 && code <= 0x1f64f) ||
        (code >= 0x1f900 && code <= 0x1f9ff) ||
        (code >= 0x20000 && code <= 0x3fffd)) {
        return 2;
    }
    return 1;
}
function stringWidth(text) {
    return Array.from(String(text ?? '')).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}
function centerText(text, width) {
    const value = String(text ?? '');
    const gap = Math.max(0, width - stringWidth(value));
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return ' '.repeat(left) + value + ' '.repeat(right);
}
function padText(text, width) {
    const value = String(text ?? '');
    return value + ' '.repeat(Math.max(0, width - stringWidth(value)));
}
function renderAwbTable(rows, columns, opts) {
    const widths = columns.map((column) => Math.max(stringWidth(capitalize(column)), ...rows.map((row) => stringWidth(row?.[column] == null ? '' : String(row[column])))));
    const top = '┌' + widths.map((width) => '─'.repeat(width + 2)).join('┬') + '┐';
    const divider = '├' + widths.map((width) => '─'.repeat(width + 2)).join('┼') + '┤';
    const bottom = '└' + widths.map((width) => '─'.repeat(width + 2)).join('┴') + '┘';
    const header = '│ ' + columns.map((column, index) => centerText(capitalize(column), widths[index])).join(' │ ') + ' │';
    const body = rows.map((row) => '│ ' + columns.map((column, index) => padText(row?.[column] == null ? '' : String(row[column]), widths[index])).join(' │ ') + ' │');
    console.log();
    if (opts.title)
        console.log(chalk.dim(\`  \${opts.title}\`));
    console.log([top, header, divider, ...body, bottom].join('\\n'));
}
function renderTable(data, opts) {
    const rows = Array.isArray(data) ? data : [data];
    if (!rows.length) {
        console.log(chalk.dim('(no data)'));
        return;
    }
    const columns = opts.columns ?? Object.keys(rows[0]);
    const isAwb = String(opts.source ?? opts.title ?? '').startsWith('awb/');
    if (isAwb) {
        renderAwbTable(rows, columns, opts);
    } else {
        const header = columns.map(c => capitalize(c));
        const table = new Table({
            head: header.map(h => chalk.bold(h)),
            style: { head: [], border: [] },
            wordWrap: true,
            wrapOnWordBoundary: true,
        });
        for (const row of rows) {
            table.push(columns.map(c => {
                const v = row[c];
                return v === null || v === undefined ? '' : String(v);
            }));
        }
        console.log();
        if (opts.title)
            console.log(chalk.dim(\`  \${opts.title}\`));
        console.log(table.toString());
    }
    const footer = [];
    footer.push(\`\${rows.length} items\`);
    if (opts.elapsed)
        footer.push(\`\${opts.elapsed.toFixed(1)}s\`);
    if (opts.source)
        footer.push(opts.source);
    if (opts.footerExtra)
        footer.push(opts.footerExtra);
    console.log(chalk.dim(footer.join(' · ')));
}
// AWB_PRESENTATION_PATCH_END
`;
    return `${source.slice(0, helperStart)}${replacement}${source.slice(helperEnd)}`;
  });
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
const commanderPatch = patchOpencliCommanderAdapter(opencliDir);
const outputPatch = patchOpencliOutput(opencliDir);
if (commanderPatch.changed || outputPatch.changed) {
  log(`\x1b[32m✓\x1b[0m Patched opencli AWB presentation`);
}
log('  Run: opencli awb --help');
