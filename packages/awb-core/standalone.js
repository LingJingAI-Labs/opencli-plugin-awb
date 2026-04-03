import chalk from 'chalk';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAwbCommands } from './commands.js';
import { loadAuth, loadState, safeAuthSummary } from './common.js';

function runtimePrefix() {
  return 'awb';
}

function getAwbCommandGroup(commandName) {
  const groups = {
    '登录与账号': new Set(['auth-clear', 'auth-status', 'login-qr', 'login-qr-status', 'phone-login', 'me']),
    '平台辅助': new Set(['send-code', 'bind-phone']),
    '团队与项目': new Set(['teams', 'team-select', 'project-groups', 'project-group-users', 'project-group-create', 'project-group-select', 'project-group-current', 'project-group-update']),
    '积分、支付与发票': new Set(['points', 'point-packages', 'point-records', 'redeem', 'point-purchase', 'point-pay-status', 'invoice-apply']),
    '模型与创作': new Set(['model-options', 'image-models', 'video-models', 'image-fee', 'image-create', 'image-create-batch', 'video-fee', 'video-create', 'video-create-batch']),
    '素材与任务': new Set(['upload-files', 'tasks', 'task-wait']),
  };
  for (const [group, commands] of Object.entries(groups)) {
    if (commands.has(commandName)) return group;
  }
  return 'Commands';
}

function rewriteHelpText(text) {
  return String(text ?? '').replaceAll('opencli awb', runtimePrefix());
}

function rewriteOutputValue(value) {
  if (typeof value === 'string') return rewriteHelpText(value);
  if (Array.isArray(value)) return value.map((item) => rewriteOutputValue(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [key, rewriteOutputValue(entryValue)]),
    );
  }
  return value;
}

function collectCommands() {
  const commands = [];
  registerAwbCommands((spec) => {
    commands.push(spec);
  });
  return commands;
}

function formatScalar(value) {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function pad(value, width) {
  const text = String(value ?? '');
  const length = [...text].length;
  return text + ' '.repeat(Math.max(0, width - length));
}

function padCenter(value, width) {
  const text = String(value ?? '');
  const length = [...text].length;
  const gap = Math.max(0, width - length);
  const left = Math.floor(gap / 2);
  const right = gap - left;
  return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
}

function truncate(value, maxWidth = 48) {
  const text = String(value ?? '');
  const chars = [...text];
  if (chars.length <= maxWidth) return text;
  return `${chars.slice(0, Math.max(0, maxWidth - 1)).join('')}…`;
}

function renderTable(rows, columns = []) {
  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return '';
  const resolvedColumns = columns.length
    ? columns
    : [...new Set(items.flatMap((item) => Object.keys(item ?? {})))];
  const widths = resolvedColumns.map((column) =>
    Math.max(
      [...column].length,
      ...items.map((item) => [...truncate(formatScalar(item?.[column]))].length),
    ),
  );
  const top = `┌${widths.map((width) => '─'.repeat(width + 2)).join('┬')}┐`;
  const header = `│ ${resolvedColumns.map((column, index) => padCenter(column, widths[index])).join(' │ ')} │`;
  const divider = `├${widths.map((width) => '─'.repeat(width + 2)).join('┼')}┤`;
  const body = items.map((item) =>
    `│ ${resolvedColumns
      .map((column, index) => pad(truncate(formatScalar(item?.[column])), widths[index]))
      .join(' │ ')} │`,
  );
  const bottom = `└${widths.map((width) => '─'.repeat(width + 2)).join('┴')}┘`;
  return [top, header, divider, ...body, bottom].join('\n');
}

function renderMarkdown(rows, columns = []) {
  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return '';
  const resolvedColumns = columns.length
    ? columns
    : [...new Set(items.flatMap((item) => Object.keys(item ?? {})))];
  const header = `| ${resolvedColumns.join(' | ')} |`;
  const divider = `| ${resolvedColumns.map(() => '---').join(' | ')} |`;
  const body = items.map((item) =>
    `| ${resolvedColumns.map((column) => String(formatScalar(item?.[column])).replaceAll('|', '\\|')).join(' | ')} |`,
  );
  return [header, divider, ...body].join('\n');
}

function renderCsv(rows, columns = []) {
  const items = Array.isArray(rows) ? rows : [rows];
  if (!items.length) return '';
  const resolvedColumns = columns.length
    ? columns
    : [...new Set(items.flatMap((item) => Object.keys(item ?? {})))];
  const quote = (value) => `"${String(formatScalar(value)).replaceAll('"', '""')}"`;
  const lines = [
    resolvedColumns.map((column) => quote(column)).join(','),
    ...items.map((item) => resolvedColumns.map((column) => quote(item?.[column])).join(',')),
  ];
  return lines.join('\n');
}

function renderYamlValue(value, indent = 0) {
  const prefix = ' '.repeat(indent);
  if (value == null) return 'null';
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (!value.length) return '[]';
    return value
      .map((item) => {
        const rendered = renderYamlValue(item, indent + 2);
        if (typeof item === 'object' && item != null) {
          return `${prefix}- ${rendered.startsWith('\n') ? rendered.slice(1) : rendered}`;
        }
        return `${prefix}- ${rendered}`;
      })
      .join('\n');
  }
  const entries = Object.entries(value);
  if (!entries.length) return '{}';
  return entries
    .map(([key, entryValue]) => {
      if (entryValue && typeof entryValue === 'object') {
        return `${prefix}${key}:\n${renderYamlValue(entryValue, indent + 2)}`;
      }
      return `${prefix}${key}: ${renderYamlValue(entryValue, 0)}`;
    })
    .join('\n');
}

function renderOutput(result, format, columns) {
  const normalized = rewriteOutputValue(result);
  if (format === 'json') return `${JSON.stringify(normalized, null, 2)}\n`;
  if (format === 'yaml') return `${renderYamlValue(normalized)}\n`;
  if (format === 'csv') return `${renderCsv(normalized, columns)}\n`;
  if (format === 'md') return `${renderMarkdown(normalized, columns)}\n`;
  return `${renderTable(normalized, columns)}\n`;
}

function findCommand(commands, name) {
  return commands.find((item) => item.name === name) ?? null;
}

function optionUsage(arg) {
  const optional = arg.required !== true;
  const suffix = optional ? '[value]' : '<value>';
  return `--${arg.name} ${suffix}`;
}

function missingRequiredArgs(command, kwargs, positional = []) {
  const missing = [];
  let positionalIndex = 0;
  for (const arg of command.args ?? []) {
    if (!arg.required) continue;
    if (arg.positional) {
      const value = positional[positionalIndex];
      positionalIndex += 1;
      if (value === undefined || value === null || value === '') {
        missing.push(arg);
      }
      continue;
    }
    const value = kwargs[arg.name];
    if (value === undefined || value === null || value === '') {
      missing.push(arg);
    }
  }
  return missing;
}

function printGeneralHelp(commands) {
  const groups = new Map();
  for (const command of commands) {
    const group = getAwbCommandGroup(command.name);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(command);
  }
  const lines = [`Usage: ${runtimePrefix()} <command> [options]`, ''];
  for (const [group, items] of groups.entries()) {
    lines.push(`${group}:`);
    for (const command of items) {
      lines.push(`  ${pad(command.name, 22)} ${rewriteHelpText(String(command.description ?? '').split('\n')[0])}`);
    }
    lines.push('');
  }
  lines.push(`Run \`${runtimePrefix()} <command> --help\` for command details.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

function printCommandHelp(command) {
  const lines = [
    `Usage: ${runtimePrefix()} ${command.name} [options]`,
    '',
    rewriteHelpText(command.description ?? ''),
    '',
    'Options:',
  ];
  for (const arg of command.args ?? []) {
    let detail = arg.help ?? '';
    if (arg.default !== undefined && arg.default !== null && arg.default !== '') {
      detail = `${detail}${detail ? ' ' : ''}(default: ${JSON.stringify(arg.default)})`;
    }
    if (Array.isArray(arg.choices) && arg.choices.length) {
      detail = `${detail}${detail ? ' ' : ''}可选: ${arg.choices.join(', ')}`;
    }
    lines.push(`  ${pad(optionUsage(arg), 30)} ${rewriteHelpText(detail)}`);
  }
  lines.push(`  ${pad('-f, --format <fmt>', 30)} 输出格式: table, json, yaml, md, csv`);
  lines.push(`  ${pad('-v, --verbose', 30)} 调试输出`);
  lines.push(`  ${pad('-h, --help', 30)} display help`);
  if (Array.isArray(command.columns) && command.columns.length) {
    lines.push('');
    lines.push(`输出列: ${command.columns.join(', ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function readStandaloneVersion() {
  try {
    const standaloneDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      await fs.readFile(path.join(standaloneDir, 'package.json'), 'utf8'),
    );
    return packageJson?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function charDisplayWidth(char) {
  const code = char.codePointAt(0) ?? 0;
  if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return 0;
  if ((code >= 0x1100 && code <= 0x115f)
    || (code >= 0x2329 && code <= 0x232a)
    || (code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f)
    || (code >= 0xac00 && code <= 0xd7a3)
    || (code >= 0xf900 && code <= 0xfaff)
    || (code >= 0xfe10 && code <= 0xfe19)
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60)
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1f64f)
    || (code >= 0x1f900 && code <= 0x1f9ff)
    || (code >= 0x20000 && code <= 0x3fffd)) {
    return 2;
  }
  return 1;
}

function stringDisplayWidth(text) {
  return Array.from(stripAnsi(text)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function padDisplay(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - stringDisplayWidth(text)))}`;
}

function formatBannerRow(label, value, width = 8, labelColor = (v) => v) {
  return `${labelColor(padDisplay(label, width))} ${chalk.dim('│')} ${chalk.white(value ?? '-')}`;
}

async function buildStandaloneBanner() {
  const [auth, state, version] = await Promise.all([
    loadAuth().catch(() => null),
    loadState().catch(() => ({})),
    readStandaloneVersion(),
  ]);
  const authSummary = safeAuthSummary(auth);
  const orange = chalk.hex('#ff6a00');
  const orangeSoft = chalk.hex('#ff9a4d');
  const loginStatus = authSummary.lastAuthError
    ? chalk.yellow('登录失效，请重登')
    : authSummary.loginState === '已登录'
      ? chalk.green('已登录')
      : authSummary.loginState === '缓存过期'
        ? chalk.yellow('缓存过期，可自动续期')
        : chalk.yellow(authSummary.loginState ?? '未登录');
  const logoRows = [
    ' █████             █████            █████████  █████',
    '░░███             ░░███            ███░░░░░███░░███ ',
    ' ░███              ░███           ░███    ░███ ░███ ',
    ' ░███              ░███ ██████████░███████████ ░███ ',
    ' ░███              ░███░░░░░░░░░░ ░███░░░░░███ ░███ ',
    ' ░███      █ ███   ░███           ░███    ░███ ░███ ',
    ' ███████████░░████████            █████   ██████████',
    '░░░░░░░░░░░  ░░░░░░░░            ░░░░░   ░░░░░░░░░░ ',
  ];
  const rows = [
    ...logoRows.map((row) => orange.bold(row)),
    '',
    formatBannerRow('品牌名称', '灵境AI | https://lingjingai.cn/', 8, orangeSoft),
    formatBannerRow('版本信息', `AWB CLI v${version}`, 8, orangeSoft),
    formatBannerRow('登录状态', loginStatus, 8, orangeSoft),
    formatBannerRow('当前用户', state?.currentUserName ?? '未识别', 8, orangeSoft),
    formatBannerRow('当前团队', state?.currentGroupName ?? '未选择', 8, orangeSoft),
    formatBannerRow('当前项目', state?.currentProjectGroupName ?? state?.currentProjectGroupNo ?? '未选择', 8, orangeSoft),
    formatBannerRow('令牌到期', authSummary.expiresAt ? new Date(Number(authSummary.expiresAt)).toLocaleString('zh-CN', { hour12: false }) : '-', 8, orangeSoft),
    ...(authSummary.lastAuthError ? [formatBannerRow('失效原因', authSummary.lastAuthError, 8, orangeSoft)] : []),
  ];
  const innerWidth = Math.max(62, ...rows.map((row) => stringDisplayWidth(row)));
  const top = orange(`+${'-'.repeat(innerWidth + 2)}+`);
  const bottom = orange(`+${'-'.repeat(innerWidth + 2)}+`);
  const body = rows.map((row) => `${orange('|')} ${padDisplay(row, innerWidth)} ${orange('|')}`);
  return [top, ...body, bottom].join('\n');
}

function parseArgv(argv) {
  const positional = [];
  const kwargs = {};
  let format = 'table';
  let verbose = false;
  let help = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '-h' || token === '--help') {
      help = true;
      continue;
    }
    if (token === '-v' || token === '--verbose') {
      verbose = true;
      continue;
    }
    if (token === '-f' || token === '--format') {
      format = argv[index + 1] ?? format;
      index += 1;
      continue;
    }
    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = argv[index + 1];
      if (next == null || next.startsWith('-')) {
        kwargs[key] = 'true';
      } else {
        kwargs[key] = next;
        index += 1;
      }
      continue;
    }
    positional.push(token);
  }

  return {
    positional,
    kwargs,
    format,
    verbose,
    help,
  };
}

export async function runStandaloneCli(argv = process.argv.slice(2)) {
  const commands = collectCommands();
  const parsed = parseArgv(argv);
  const [first, second] = parsed.positional;
  const commandName = first === 'help' ? second : first;
  const banner = await buildStandaloneBanner().catch(() => '');

  if (!commandName) {
    if (banner) process.stdout.write(`${banner}\n`);
    printGeneralHelp(commands);
    return;
  }

  const command = findCommand(commands, commandName);
  if (!command) {
    process.stderr.write(`Unknown command: ${commandName}\n`);
    if (banner) process.stdout.write(`${banner}\n`);
    printGeneralHelp(commands);
    process.exitCode = 1;
    return;
  }

  if (parsed.help || first === 'help') {
    if (banner) process.stdout.write(`${banner}\n`);
    printCommandHelp(command);
    return;
  }

  const kwargs = { ...parsed.kwargs };
  if (parsed.verbose) {
    kwargs.verbose = true;
  }

  const missingArgs = missingRequiredArgs(command, kwargs, parsed.positional.slice(1));
  if (missingArgs.length) {
    const labels = missingArgs.map((arg) => `--${arg.name}`).join(', ');
    process.stderr.write(`缺少必填参数: ${labels}\n`);
    process.stderr.write(`运行 \`${runtimePrefix()} ${command.name} --help\` 查看用法。\n`);
    process.exitCode = 1;
    return;
  }

  try {
    const result = await command.func(null, kwargs);
    if (result === undefined) return;
    process.stdout.write(renderOutput(result, parsed.format, command.columns ?? []));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}

export function standaloneBinPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'awb-cli', 'bin', 'awb.js');
}
