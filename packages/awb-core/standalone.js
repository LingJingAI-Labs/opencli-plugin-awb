import chalk from 'chalk';
import { Command } from 'commander';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerAwbCommands } from './commands.js';
import {
  AUTH_COMPAT_PATH,
  AUTH_PATH,
  STATE_PATH,
  safeAuthSummary,
} from './common.js';

function runtimePrefix() {
  return 'awb';
}

function rewriteHelpText(text) {
  return String(text ?? '').replaceAll('opencli awb', runtimePrefix());
}

function rewriteCommandSpec(spec) {
  return {
    ...spec,
    description: rewriteHelpText(spec.description ?? ''),
    args: (spec.args ?? []).map((arg) => ({
      ...arg,
      help: rewriteHelpText(arg.help ?? ''),
    })),
  };
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
    if (commands.has(commandName)) return `${group}:`;
  }
  return 'Commands:';
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

function stripAnsi(text) {
  return String(text).replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function stringDisplayWidth(text) {
  return Array.from(stripAnsi(text)).reduce((sum, char) => sum + charDisplayWidth(char), 0);
}

function padDisplay(text, width) {
  return `${text}${' '.repeat(Math.max(0, width - stringDisplayWidth(text)))}`;
}

function formatBannerRow(label, value, labelWidth, labelColor) {
  return `${labelColor(padDisplay(label, labelWidth))} ${chalk.dim('│')} ${chalk.white(value ?? '-')}`;
}

function formatAwbSubcommandTerm(sub) {
  const args = sub.registeredArguments
    .map((arg) => (arg.required ? `<${arg.name()}>` : `[${arg.name()}]`))
    .join(' ');
  const namePart = sub.name().padEnd(22, ' ');
  const optionPart = sub.options.length ? '[options]' : '';
  const suffix = args ? ` ${args}` : '';
  return `${namePart}${optionPart}${suffix}`.trimEnd();
}

async function readStandaloneVersion() {
  try {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(
      await fs.readFile(path.join(currentDir, 'package.json'), 'utf8'),
    );
    return packageJson?.version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

function readJsonSafe(filePath, fallback = null) {
  try {
    return JSON.parse(fsSync.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function buildStandaloneBanner() {
  const version = await readStandaloneVersion();
  const home = os.homedir();
  const auth = readJsonSafe(AUTH_PATH, null)
    ?? (AUTH_COMPAT_PATH ? readJsonSafe(AUTH_COMPAT_PATH, null) : null)
    ?? readJsonSafe(path.join(home, '.opencli', 'awb-auth.json'), null)
    ?? readJsonSafe(path.join(home, '.animeworkbench_auth.json'), null);
  const state = readJsonSafe(STATE_PATH, null)
    ?? readJsonSafe(path.join(home, '.opencli', 'awb-state.json'), {})
    ?? {};
  const authSummary = safeAuthSummary(auth);
  const loginStatus = authSummary.lastAuthError
    ? chalk.yellow('登录失效，请重登')
    : authSummary.loginState === '已登录'
      ? chalk.green('已登录')
      : authSummary.loginState === '缓存过期'
        ? chalk.yellow('缓存过期，可自动续期')
        : chalk.yellow(authSummary.loginState ?? '未登录');
  const orange = chalk.hex('#ff6a00');
  const orangeSoft = chalk.hex('#ff9a4d');
  const labelWidth = 8;
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
    formatBannerRow('品牌名称', '灵境AI | https://lingjingai.cn/', labelWidth, orangeSoft),
    formatBannerRow('版本信息', `AWB CLI v${version}`, labelWidth, orangeSoft),
    formatBannerRow('登录状态', loginStatus, labelWidth, orangeSoft),
    formatBannerRow('当前用户', state?.currentUserName ?? '未识别', labelWidth, orangeSoft),
    formatBannerRow('当前团队', state?.currentGroupName ?? '未选择', labelWidth, orangeSoft),
    formatBannerRow('当前项目', state?.currentProjectGroupName ?? state?.currentProjectGroupNo ?? '未选择', labelWidth, orangeSoft),
    formatBannerRow(
      '令牌到期',
      authSummary.expiresAt ? new Date(Number(authSummary.expiresAt)).toLocaleString('zh-CN', { hour12: false }) : '-',
      labelWidth,
      orangeSoft,
    ),
    ...(authSummary.lastAuthError ? [formatBannerRow('失效原因', authSummary.lastAuthError, labelWidth, orangeSoft)] : []),
  ];
  const innerWidth = Math.max(62, ...rows.map((row) => stringDisplayWidth(row)));
  const top = orange(`+${'-'.repeat(innerWidth + 2)}+`);
  const bottom = orange(`+${'-'.repeat(innerWidth + 2)}+`);
  const body = rows.map((row) => `${orange('|')} ${padDisplay(row, innerWidth)} ${orange('|')}`);
  return [top, ...body, bottom].join('\n');
}

function printStandaloneRootHelp(commands, banner) {
  if (banner) process.stdout.write(`${banner}\n`);
  const groups = new Map();
  for (const command of commands) {
    const group = getAwbCommandGroup(command.name).replace(/:$/, '');
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(command);
  }
  const lines = [`Usage: ${runtimePrefix()} <command> [options]`, ''];
  for (const [group, items] of groups.entries()) {
    lines.push(`${group}:`);
    for (const command of items) {
      lines.push(`  ${command.name.padEnd(22, ' ')} ${String(command.description ?? '').split('\n')[0]}`);
    }
    lines.push('');
  }
  lines.push(`Run \`${runtimePrefix()} <command> --help\` for command details.`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

async function resolveOpencliModule(moduleName) {
  const mainUrl = await import.meta.resolve('@jackwener/opencli');
  const distDir = path.dirname(fileURLToPath(mainUrl));
  return import(pathToFileURL(path.join(distDir, moduleName)).href);
}

export async function runStandaloneCli(argv = process.argv.slice(2)) {
  process.env.AWB_COMMAND_PREFIX ??= runtimePrefix();
  const { registerCommandToProgram } = await resolveOpencliModule('commanderAdapter.js');
  const commands = [];
  registerAwbCommands((spec) => {
    commands.push(rewriteCommandSpec(spec));
  });
  const banner = await buildStandaloneBanner().catch(() => '');
  if (argv.length === 0 || (argv.length === 1 && ['-h', '--help'].includes(argv[0]))) {
    printStandaloneRootHelp(commands, banner);
    return;
  }
  const program = new Command();
  program
    .name(runtimePrefix())
    .description('LingJing AI Anime Workbench CLI')
    .showHelpAfterError();
  program.addHelpText('before', banner);
  program.configureHelp({
    subcommandTerm(sub) {
      return formatAwbSubcommandTerm(sub);
    },
  });

  for (const spec of commands) {
    registerCommandToProgram(program, {
      ...spec,
      site: 'awb',
    });
  }

  await program.parseAsync(argv, { from: 'user' });
}

export function standaloneBinPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'awb-cli', 'bin', 'awb.js');
}
