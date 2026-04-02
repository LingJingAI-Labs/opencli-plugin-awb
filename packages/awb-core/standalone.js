import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAwbCommands } from './commands.js';

function runtimePrefix() {
  return 'awb';
}

function rewriteHelpText(text) {
  return String(text ?? '').replaceAll('opencli awb', runtimePrefix());
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
  const header = resolvedColumns.map((column, index) => pad(column, widths[index])).join(' │ ');
  const divider = widths.map((width) => '─'.repeat(width)).join('─┼─');
  const body = items.map((item) =>
    resolvedColumns
      .map((column, index) => pad(truncate(formatScalar(item?.[column])), widths[index]))
      .join(' │ '),
  );
  return [header, divider, ...body].join('\n');
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
  if (format === 'json') return `${JSON.stringify(result, null, 2)}\n`;
  if (format === 'yaml') return `${renderYamlValue(result)}\n`;
  if (format === 'csv') return `${renderCsv(result, columns)}\n`;
  if (format === 'md') return `${renderMarkdown(result, columns)}\n`;
  return `${renderTable(result, columns)}\n`;
}

function findCommand(commands, name) {
  return commands.find((item) => item.name === name) ?? null;
}

function optionUsage(arg) {
  const optional = arg.required !== true;
  const suffix = optional ? '[value]' : '<value>';
  return `--${arg.name} ${suffix}`;
}

function printGeneralHelp(commands) {
  const lines = [
    `Usage: ${runtimePrefix()} <command> [options]`,
    '',
    'Commands:',
  ];
  for (const command of commands) {
    lines.push(`  ${pad(command.name, 22)} ${rewriteHelpText(String(command.description ?? '').split('\n')[0])}`);
  }
  lines.push('');
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
  lines.push(`  ${pad('-f, --format <fmt>', 30)} Output format: table, json, yaml, md, csv`);
  lines.push(`  ${pad('-v, --verbose', 30)} Debug output`);
  lines.push(`  ${pad('-h, --help', 30)} display help`);
  if (Array.isArray(command.columns) && command.columns.length) {
    lines.push('');
    lines.push(`Output columns: ${command.columns.join(', ')}`);
  }
  process.stdout.write(`${lines.join('\n')}\n`);
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

  if (!commandName) {
    printGeneralHelp(commands);
    return;
  }

  const command = findCommand(commands, commandName);
  if (!command) {
    process.stderr.write(`Unknown command: ${commandName}\n`);
    printGeneralHelp(commands);
    process.exitCode = 1;
    return;
  }

  if (parsed.help || first === 'help') {
    printCommandHelp(command);
    return;
  }

  const kwargs = { ...parsed.kwargs };
  if (parsed.verbose) {
    kwargs.verbose = true;
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
