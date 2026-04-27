import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import {
  API_ORIGIN,
  apiFetch,
  clearAuth,
  ensureAuth,
  extractPointBalance,
  firstArray,
  flattenRecord,
  loadAuth,
  loadState,
  maskAccessKey,
  normalizeCode,
  parseJsonArg,
  REDEEM_CODE_RE,
  readImageMetadata,
  resolveEnvProjectGroupNo,
  resolveRuntimeAccessKey,
  resolveProjectGroupNo,
  saveAuth,
  saveLoginPayload,
  saveState,
  SEND_CODE_PRODUCT_CODE,
  SEND_CODE_SCENE_ID,
  PRODUCT_CODE,
  safeAuthSummary,
  sleep,
  splitCsv,
  SOURCE,
  TASK_UPLOAD_SCENE,
  uploadLocalFile,
  uploadLocalFiles,
} from './common.js';

const SITE = 'awb';
const TERMINAL_TASK_STATES = new Set(['SUCCESS', 'COMPLETED', 'DONE', 'SUCCEEDED', 'FAIL', 'FAILED', 'ERROR', 'CANCEL', 'CANCELED', 'CANCELLED', 'TIMEOUT']);
const FEED_TASK_TYPES = ['IMAGE_CREATE', 'VIDEO_GROUP', 'VIDEO_CREATE', 'IMAGE_EDIT', 'LIP_SYNC', 'AIHUBMIX_VIDEO'];
const POINT_PACKAGE_CACHE_PATH = path.join(os.homedir(), '.opencli', 'awb-point-packages.json');
const POINT_RECORD_CACHE_PATH = path.join(os.homedir(), '.opencli', 'awb-point-records.json');
const FEISHU_ORIGIN = 'https://lingjingai.feishu.cn';
const FEISHU_STREAM_ORIGIN = 'https://internal-api-drive-stream.feishu.cn';
const AWB_INVOICE_SHARE_TOKEN = 'shrcndwlXIkJetUy2UVRO9E5zxg';
const AWB_INVOICE_FORM_URL = `${FEISHU_ORIGIN}/share/base/form/${AWB_INVOICE_SHARE_TOKEN}`;
const AWB_INVOICE_UPLOAD_MOUNT_POINT = 'bitable_tmp_point';
const TASK_EXEC_STAT_ORIGIN = 'https://monitor-statistics-llm.lingjingai.cn';
const ASSET_EDIT_ORIGIN = 'https://asset-edit.lingjingai.cn';
const AIHUBMIX_ORIGIN = 'https://aihubmix.com';
const AIHUBMIX_HAPPYHORSE_COST_DEFAULTS = {
  p720UsdPerSecond: 0.1395,
  p1080UsdPerSecond: 0.2479,
  cnyPerUsd: 7.2,
  source: 'AiHubMix HappyHorse pricing: 720p 0.1395 USD/s, 1080p 0.2479 USD/s.',
};
const AIHUBMIX_HAPPYHORSE_SECONDS_MIN = 2;
const AIHUBMIX_HAPPYHORSE_SECONDS_MAX = 15;
const AIHUBMIX_HAPPYHORSE_R2V_SECONDS_MIN = 3;
const AIHUBMIX_HAPPYHORSE_ALLOWED_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const AIHUBMIX_HAPPYHORSE_IMAGE_EXTS = new Set(['.jpeg', '.jpg', '.png', '.bmp', '.webp']);
const AIHUBMIX_HAPPYHORSE_R2V_IMAGE_EXTS = new Set(['.jpeg', '.jpg', '.png', '.webp']);
const AIHUBMIX_HAPPYHORSE_VIDEO_EXTS = new Set(['.mp4', '.mov']);
const AIHUBMIX_HAPPYHORSE_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const AIHUBMIX_HAPPYHORSE_MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const AIHUBMIX_HAPPYHORSE_MIN_IMAGE_SIDE = 300;
const AIHUBMIX_HAPPYHORSE_R2V_MIN_IMAGE_SHORT_SIDE = 400;
const AIHUBMIX_HAPPYHORSE_MIN_IMAGE_RATIO = 2 / 5;
const AIHUBMIX_HAPPYHORSE_MAX_IMAGE_RATIO = 5 / 2;
const AIHUBMIX_HAPPYHORSE_R2V_MIN_REFERENCE_IMAGES = 1;
const AIHUBMIX_HAPPYHORSE_R2V_MAX_REFERENCE_IMAGES = 9;
const AIHUBMIX_VIDEO_MODELS = [
  {
    modelCode: 'happyhorse-1.0-t2v',
    modelGroupCode: 'happyhorse-1.0-t2v',
    modelName: 'HappyHorse 1.0 文生视频',
    frameFeature: '无',
    refFeature: '无',
    supportsPromptOnly: true,
    note: 'AiHubMix 外部计费，不走 AWB 积分',
  },
  {
    modelCode: 'happyhorse-1.0-i2v',
    modelGroupCode: 'happyhorse-1.0-i2v',
    modelName: 'HappyHorse 1.0 图生视频',
    frameFeature: '首帧',
    refFeature: '图',
    supportsPromptOnly: false,
    note: '通过 input_reference 传图片 URL/base64',
  },
  {
    modelCode: 'happyhorse-1.0-r2v',
    modelGroupCode: 'happyhorse-1.0-r2v',
    modelName: 'HappyHorse 1.0 参考生视频',
    frameFeature: '可首帧',
    refFeature: '图/视频/音频',
    supportsPromptOnly: false,
    note: '通过 extra_body.content 传参考资源',
  },
  {
    modelCode: 'happyhorse-1.0-video-edit',
    modelGroupCode: 'happyhorse-1.0-video-edit',
    modelName: 'HappyHorse 1.0 视频编辑',
    frameFeature: '无',
    refFeature: '视频',
    supportsPromptOnly: false,
    note: '通过 extra_body.content 传待编辑视频',
  },
];
const DRY_RUN_ARG = {
  name: 'dryRun',
  help: '仅预览请求，不真正执行写操作。示例: --dryRun true',
};
const TASK_RECORD_FILE_ARG = {
  name: 'taskRecordFile',
  help: '把已提交任务追加写入 JSONL 台账。示例: .awb/tasks.jsonl；也可用 AWB_TASK_RECORD_FILE',
};
const execFile = promisify(execFileCallback);

function runtimeCommandPrefix() {
  return process.env.AWB_COMMAND_PREFIX || 'opencli awb';
}

function rewriteRuntimeCommandPrefix(text) {
  return String(text ?? '').replaceAll('opencli awb', runtimeCommandPrefix());
}

function toInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toNumberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toBool(value) {
  if (value === true || value === 1) return true;
  if (value == null) return false;
  const text = String(value).trim().toLowerCase();
  return text === 'true' || text === '1' || text === 'yes' || text === 'y' || text === 'on';
}

function extractHelpCommandName(examples = []) {
  for (const example of examples) {
    const match = String(example).match(/opencli\s+awb\s+([a-z0-9-]+)/i);
    if (match) return match[1];
  }
  return null;
}

function shouldExpandCommandHelp(commandName) {
  if (!commandName) return false;
  const args = process.argv.slice(2);
  const siteIndex = args.indexOf(SITE);
  if (siteIndex < 0) {
    if (args[0] === commandName && (args.includes('--help') || args.includes('-h'))) {
      return true;
    }
    if (args[0] === 'help' && args[1] === commandName) {
      return true;
    }
    return false;
  }
  if (args[siteIndex + 1] === commandName && (args.includes('--help') || args.includes('-h'))) {
    return true;
  }
  if (args[siteIndex + 1] === 'help' && args[siteIndex + 2] === commandName) {
    return true;
  }
  return false;
}

function commandHelp(summary, options = {}) {
  const commandName = options.command ?? extractHelpCommandName(options.examples);
  if (!shouldExpandCommandHelp(commandName)) {
    return rewriteRuntimeCommandPrefix(summary);
  }
  const lines = [rewriteRuntimeCommandPrefix(summary)];
  if (options.quickStart?.length) {
    lines.push('建议顺序:');
    for (const item of options.quickStart) {
      lines.push(`  ${rewriteRuntimeCommandPrefix(item)}`);
    }
  }
  if (options.commonArgs?.length) {
    lines.push('常用参数:');
    for (const item of options.commonArgs) {
      lines.push(`  ${rewriteRuntimeCommandPrefix(item)}`);
    }
  }
  if (options.advancedArgs?.length) {
    lines.push('高级参数:');
    for (const item of options.advancedArgs) {
      lines.push(`  ${rewriteRuntimeCommandPrefix(item)}`);
    }
  }
  if (options.examples?.length) {
    lines.push('示例:');
    for (const example of options.examples) {
      lines.push(`  ${rewriteRuntimeCommandPrefix(example)}`);
    }
  }
  if (options.hint) {
    lines.push(`提示: ${rewriteRuntimeCommandPrefix(options.hint)}`);
  }
  if (options.dryRun) {
    lines.push('支持: 追加 `--dryRun true` 仅预览，不执行写操作。');
  }
  return lines.join('\n');
}

function printRuntimeNote(lines) {
  for (const line of lines) {
    process.stderr.write(`${rewriteRuntimeCommandPrefix(line)}\n`);
  }
}

function withAliases(record, mapping = {}) {
  const next = { ...(record ?? {}) };
  for (const [sourceKey, targetKey] of Object.entries(mapping)) {
    next[targetKey] = record?.[sourceKey] ?? null;
  }
  return next;
}

function withAliasesRows(rows, mapping = {}) {
  return (Array.isArray(rows) ? rows : []).map((item) => withAliases(item, mapping));
}

function isTerminalStream(stream) {
  return Boolean(stream && stream.isTTY);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function parseBmpBinaryMatrix(buffer) {
  if (buffer.length < 54 || buffer.subarray(0, 2).toString('ascii') !== 'BM') {
    throw new Error('Unsupported BMP data.');
  }
  const pixelOffset = buffer.readUInt32LE(10);
  const dibSize = buffer.readUInt32LE(14);
  if (dibSize < 40) {
    throw new Error('Unsupported BMP header.');
  }
  const rawWidth = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const planes = buffer.readUInt16LE(26);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);

  if (planes !== 1 || compression !== 0 || ![24, 32].includes(bitsPerPixel)) {
    throw new Error('Unsupported BMP pixel format.');
  }

  const width = Math.abs(rawWidth);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const rowSize = Math.ceil((width * bytesPerPixel) / 4) * 4;
  const matrix = Array.from({ length: height }, () => Array(width).fill(false));

  for (let row = 0; row < height; row += 1) {
    const sourceRow = topDown ? row : height - 1 - row;
    const rowStart = pixelOffset + sourceRow * rowSize;
    for (let col = 0; col < width; col += 1) {
      const offset = rowStart + col * bytesPerPixel;
      const blue = buffer[offset];
      const green = buffer[offset + 1];
      const red = buffer[offset + 2];
      const luminance = 0.299 * red + 0.587 * green + 0.114 * blue;
      matrix[row][col] = luminance < 180;
    }
  }
  return matrix;
}

function cropBinaryMatrix(matrix) {
  const height = matrix.length;
  const width = matrix[0]?.length ?? 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!matrix[y][x]) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  if (maxX < 0 || maxY < 0) return matrix;

  const margin = 8;
  minX = Math.max(0, minX - margin);
  minY = Math.max(0, minY - margin);
  maxX = Math.min(width - 1, maxX + margin);
  maxY = Math.min(height - 1, maxY + margin);

  const cropped = [];
  for (let y = minY; y <= maxY; y += 1) {
    cropped.push(matrix[y].slice(minX, maxX + 1));
  }
  return cropped;
}

function resizeBinaryMatrix(matrix, targetWidth, targetHeight = targetWidth) {
  const srcHeight = matrix.length;
  const srcWidth = matrix[0]?.length ?? 0;
  const width = Math.max(1, targetWidth);
  const height = Math.max(1, targetHeight);
  const result = Array.from({ length: height }, () => Array(width).fill(false));

  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(srcHeight - 1, Math.floor((y / height) * srcHeight));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(srcWidth - 1, Math.floor((x / width) * srcWidth));
      result[y][x] = matrix[srcY][srcX];
    }
  }
  return result;
}

function binaryMatrixToHalfBlockText(matrix) {
  const lines = [];
  for (let y = 0; y < matrix.length; y += 2) {
    const top = matrix[y] ?? [];
    const bottom = matrix[y + 1] ?? [];
    let line = '';
    for (let x = 0; x < Math.max(top.length, bottom.length); x += 1) {
      const upper = Boolean(top[x]);
      const lower = Boolean(bottom[x]);
      if (upper && lower) line += '██';
      else if (upper) line += '▀▀';
      else if (lower) line += '▄▄';
      else line += '  ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

async function renderQrImageInTerminal(qrUrl, options = {}) {
  if (!isTerminalStream(process.stderr)) {
    return { rendered: false, reason: 'stderr-not-tty' };
  }
  const qrContent = String(options.qrContent || '').trim();
  if (qrContent) {
    try {
      const text = await QRCode.toString(qrContent, {
        type: 'utf8',
        small: false,
      });
      process.stderr.write(`${text}\n`);
      return { rendered: true, reason: 'terminal-qrcode-lib-utf8' };
    } catch (error) {
      return {
        rendered: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  if (process.platform !== 'darwin') {
    return { rendered: false, reason: 'unsupported-platform-no-qr-content' };
  }

  const response = await fetch(qrUrl);
  if (!response.ok) {
    return { rendered: false, reason: `fetch-failed-${response.status}` };
  }

  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'awb-qr-'));
  const inputPath = path.join(tempDir, 'qr-input.jpg');
  const outputPath = path.join(tempDir, 'qr-output.bmp');

  try {
    await fs.writeFile(inputPath, imageBuffer);
    await execFile('sips', ['-s', 'format', 'bmp', inputPath, '--out', outputPath]);
    const bmpBuffer = await fs.readFile(outputPath);
    const cropped = cropBinaryMatrix(parseBmpBinaryMatrix(bmpBuffer));
    const maxColumns = process.stderr.columns ?? 80;
    const requestedSize = toInt(options.qrSize, 28);
    const maxSizeByTerminal = Math.max(16, Math.floor((maxColumns - 4) / 2));
    const targetWidth = clamp(Math.min(requestedSize, maxSizeByTerminal), 22, 40);
    const targetHeight = Math.max(2, targetWidth * 2);
    const text = binaryMatrixToHalfBlockText(resizeBinaryMatrix(cropped, targetWidth, targetHeight));
    process.stderr.write(`${text}\n`);
    return { rendered: true, reason: 'terminal-half-blocks', targetSize: targetWidth };
  } catch (error) {
    return {
      rendered: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function guessLocalMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.txt':
      return 'text/plain';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    default:
      return 'application/octet-stream';
  }
}

async function inspectLocalFileInfo(filePath) {
  const absolutePath = path.resolve(filePath);
  const stat = await fs.stat(absolutePath);
  const mimeType = guessLocalMimeType(absolutePath);
  const imageMeta =
    mimeType.startsWith('image/')
      ? await readImageMetadata(absolutePath).catch(() => null)
      : null;
  return {
    filePath: absolutePath,
    fileName: path.basename(absolutePath),
    size: stat.size,
    mimeType: imageMeta?.mimeType ?? mimeType,
    width: imageMeta?.width ?? null,
    height: imageMeta?.height ?? null,
  };
}

async function inspectLocalFiles(filePaths) {
  const rows = [];
  for (const filePath of filePaths) {
    rows.push(await inspectLocalFileInfo(filePath));
  }
  return rows;
}

function encodeCosAuthValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function sha1Hex(value) {
  return crypto.createHash('sha1').update(value).digest('hex');
}

function hmacSha1Hex(key, value) {
  return crypto.createHmac('sha1', key).update(value).digest('hex');
}

function encodeObjectNamePath(objectName) {
  return String(objectName)
    .split('/')
    .map((item) => encodeURIComponent(item))
    .join('/');
}

function buildAssetCosAuthorization({
  secretKey,
  secretId,
  method,
  uriPath,
  headers,
  startTime,
  expiredTime,
  query = {},
}) {
  const signTime = `${startTime};${expiredTime}`;
  const signKey = hmacSha1Hex(secretKey, signTime);
  const normalizedHeaders = Object.entries(headers)
    .map(([key, value]) => [String(key).toLowerCase(), String(value)])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const normalizedQuery = Object.entries(query)
    .map(([key, value]) => [String(key).toLowerCase(), String(value)])
    .sort((left, right) => left[0].localeCompare(right[0]));
  const headerString = normalizedHeaders
    .map(([key, value]) => `${key}=${encodeCosAuthValue(value)}`)
    .join('&');
  const queryString = normalizedQuery
    .map(([key, value]) => `${key}=${encodeCosAuthValue(value)}`)
    .join('&');
  const httpString = [
    method.toLowerCase(),
    uriPath,
    queryString,
    headerString,
    '',
  ].join('\n');
  const stringToSign = ['sha1', signTime, sha1Hex(httpString), ''].join('\n');
  const signature = hmacSha1Hex(signKey, stringToSign);
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    `q-header-list=${normalizedHeaders.map(([key]) => key).join(';')}`,
    `q-url-param-list=${normalizedQuery.map(([key]) => key).join(';')}`,
    `q-signature=${signature}`,
  ].join('&');
}

function normalizeCosAssetPath(value) {
  const text = trimToNull(value);
  if (!text) return null;
  return normalizeReferenceUrl(text).replace(/^\/+/, '');
}

function extractAssetGroupRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  return firstArray(payload);
}

function extractAssetId(payload) {
  if (payload == null) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload === 'number') return String(payload);
  if (typeof payload !== 'object') return null;
  return payload.id ?? payload.assetId ?? payload.data?.id ?? payload.data?.assetId ?? null;
}

function normalizePublishCode(value) {
  const text = trimToNull(value);
  if (!text) return null;
  const normalized = text.replace(/[^0-9A-Za-z_-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || null;
}

function shouldUseSafeSubjectNaming(kwargs, defaultValue = false) {
  if (kwargs?.safePublishNaming == null || kwargs?.safePublishNaming === '') return defaultValue;
  return toBool(kwargs.safePublishNaming);
}

function buildAutoSubjectPublishCode(kwargs) {
  const projectName = trimToNull(kwargs?.projectName) ?? 'default';
  const name = trimToNull(kwargs?.name) ?? 'subject';
  const stateKey = trimToNull(kwargs?.stateKey) ?? 'default';
  const digest = crypto.createHash('sha1').update(`${projectName}|${name}|${stateKey}`).digest('hex').slice(0, 8);
  return `subj-${digest}`;
}

function resolveSubjectPublishLabel(kwargs, defaultSafeNaming = false) {
  const override = normalizePublishCode(kwargs?.publishCode);
  if (override) return override;
  if (shouldUseSafeSubjectNaming(kwargs, defaultSafeNaming)) {
    return buildAutoSubjectPublishCode(kwargs);
  }
  return trimToNull(kwargs?.name) ?? 'subject';
}

function buildSubjectGroupDescription(kwargs, defaultSafeNaming = false) {
  const override = trimToNull(kwargs?.description);
  if (override) return override;
  const stateKey = trimToNull(kwargs?.stateKey) ?? 'default';
  const publishLabel = resolveSubjectPublishLabel(kwargs, defaultSafeNaming);
  if (shouldUseSafeSubjectNaming(kwargs, defaultSafeNaming) || normalizePublishCode(kwargs?.publishCode)) {
    return `主体素材组 ${publishLabel} [${stateKey}]`;
  }
  return `角色 ${trimToNull(kwargs?.name) ?? publishLabel} [${stateKey}] 的主体素材组`;
}

function buildSubjectGroupName(kwargs, options = {}) {
  const override = trimToNull(kwargs.groupName);
  if (override) return override;
  const projectName = trimToNull(kwargs.projectName);
  const publishLabel = resolveSubjectPublishLabel(kwargs, options.defaultSafeNaming ?? false);
  const stateKey = trimToNull(kwargs.stateKey) ?? 'default';
  if (stateKey === 'default') {
    return projectName ? `${projectName}-${publishLabel}` : publishLabel;
  }
  return projectName ? `${projectName}-${publishLabel}-${stateKey}` : `${publishLabel}-${stateKey}`;
}

function buildSubjectAssetSpecs(kwargs) {
  return [
    {
      label: '三视图',
      file: trimToNull(kwargs.primaryFile) ?? trimToNull(kwargs.threeViewFile),
      url: trimToNull(kwargs.primaryUrl) ?? trimToNull(kwargs.threeViewUrl),
      idField: 'subjectId',
      optionalIdField: 'threeViewId',
      isPrimary: true,
      required: true,
    },
    {
      label: '正面',
      file: trimToNull(kwargs.faceFile),
      url: trimToNull(kwargs.faceUrl),
      idField: 'faceViewId',
    },
    {
      label: '侧面',
      file: trimToNull(kwargs.sideFile),
      url: trimToNull(kwargs.sideUrl),
      idField: 'sideViewId',
    },
    {
      label: '背面',
      file: trimToNull(kwargs.backFile),
      url: trimToNull(kwargs.backUrl),
      idField: 'backViewId',
    },
  ];
}

function buildSubjectAssetDisplayName(name, stateKey, label, options = {}) {
  const publishLabel = resolveSubjectPublishLabel({ ...(options.kwargs ?? {}), name, stateKey }, options.defaultSafeNaming ?? false);
  const normalizedStateKey = trimToNull(stateKey) ?? 'default';
  if (normalizedStateKey === 'default') {
    return `${publishLabel}-${label}`;
  }
  return `${publishLabel}-${normalizedStateKey}-${label}`;
}

async function resolveCurrentGroupId() {
  const auth = await loadAuth();
  const cachedGroupId = auth?.currentGroupId ?? auth?.groupId ?? null;
  if (cachedGroupId) return cachedGroupId;
  const userInfo = await apiFetch('/api/anime/user/account/userInfo', { body: {} });
  return userInfo?.groupId ?? null;
}

async function uploadAssetLibraryFile(filePath, options = {}) {
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  const imageMeta =
    await readImageMetadata(absolutePath).catch(() => ({
      size: buffer.length,
      mimeType: 'application/octet-stream',
    }));
  const currentGroupId = trimToNull(options.currentGroupId) ?? await resolveCurrentGroupId();
  if (!currentGroupId) {
    throw new Error('未识别当前团队 groupId，无法上传主体素材。请先确认 AWB 登录状态正常。');
  }
  const secret = await apiFetch('/api/anime/workbench/TencentCloud/getSecret', {
    body: {
      sceneType: TASK_UPLOAD_SCENE.IMAGE_EDIT,
      groupId: currentGroupId,
      projectNo: '',
    },
  });
  const ext = path.extname(absolutePath).toLowerCase() || '.bin';
  const safeExt = ext.replace(/[^.0-9A-Za-z]+/g, '') || '.bin';
  const fileName = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${crypto.randomUUID()}${safeExt}`;
  const assetDir = trimToNull(options.assetDir) ?? 'material/assets/';
  const assetPrefix = assetDir.endsWith('/') ? assetDir : `${assetDir}/`;
  const objectName = `${assetPrefix}${fileName}`.replace(/^\/+/, '');
  const host = `${secret.bucket}.cos.${secret.region}.myqcloud.com`;
  const uriPath = `/${objectName}`;
  const headers = {
    'content-type': imageMeta.mimeType ?? 'application/octet-stream',
    host,
    'x-cos-acl': 'public-read',
    'x-cos-security-token': secret.credentials.sessionToken,
  };
  const authorization = buildAssetCosAuthorization({
    secretKey: secret.credentials.tmpSecretKey,
    secretId: secret.credentials.tmpSecretId,
    method: 'PUT',
    uriPath,
    headers,
    startTime: secret.startTime,
    expiredTime: secret.expiredTime,
  });
  const uploadResponse = await fetch(`https://${host}/${encodeObjectNamePath(objectName)}`, {
    method: 'PUT',
    headers: {
      Authorization: authorization,
      'Content-Type': headers['content-type'],
      Host: host,
      'x-cos-acl': 'public-read',
      'x-cos-security-token': secret.credentials.sessionToken,
    },
    body: buffer,
  });
  if (!uploadResponse.ok) {
    throw new Error(`主体素材文件上传失败: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }
  return {
    filePath: absolutePath,
    fileName: path.basename(absolutePath),
    sceneType: TASK_UPLOAD_SCENE.IMAGE_EDIT,
    mimeType: imageMeta.mimeType ?? 'application/octet-stream',
    size: imageMeta.size ?? buffer.length,
    width: imageMeta.width ?? null,
    height: imageMeta.height ?? null,
    objectName,
    backendPath: `/${objectName}`,
    publicUrl: `https://${host}/${encodeObjectNamePath(objectName)}`,
    bucket: secret.bucket,
    region: secret.region,
    groupId: currentGroupId,
    assetPath: objectName,
  };
}

async function listAssetGroups(options = {}) {
  const payload = await apiFetch('/api/material/asset-groups/list', {
    body: {
      name: options.name ?? '',
      pageNumber: toInt(options.pageNumber, 1),
      pageSize: toInt(options.pageSize, 20),
      ...(Array.isArray(options.groupIds) && options.groupIds.length ? { groupIds: options.groupIds } : {}),
    },
  });
  return extractAssetGroupRows(payload);
}

async function ensureAssetGroupForSubject(kwargs) {
  const groupName = buildSubjectGroupName(kwargs, { defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) });
  const description = buildSubjectGroupDescription(kwargs, toBool(kwargs.defaultSafePublishNaming));
  const projectName = trimToNull(kwargs.projectName) ?? 'default';
  const existingRows = await listAssetGroups({ name: groupName, pageNumber: 1, pageSize: 20 }).catch(() => []);
  const existing = existingRows.find((item) => trimToNull(item?.name) === groupName) ?? null;
  if (existing) {
    return {
      groupId: existing.id ?? existing.groupId ?? null,
      groupName,
      description,
      projectName,
      reused: true,
      raw: existing,
    };
  }
  const created = await apiFetch('/api/material/asset-groups', {
    body: {
      name: groupName,
      description,
      projectName,
    },
  });
  return {
    groupId: created?.id ?? created?.groupId ?? created ?? null,
    groupName,
    description,
    projectName,
    reused: false,
    raw: created,
  };
}

async function createSubjectAssetRecord(options = {}) {
  const payload = {
    assetGroupsId: options.groupId,
    url: options.assetPath,
    name: options.name,
  };
  if (trimToNull(options.platform)) {
    payload.platform = trimToNull(options.platform);
  }
  const created = await apiFetch('/api/material/assets', { body: payload });
  return {
    assetId: extractAssetId(created),
    raw: created,
  };
}

function rewriteSubjectUploadError(message, context = {}) {
  const text = String(message ?? '').trim();
  if (/NotFound\.group_id/i.test(text)) {
    return [
      '素材资产注册接口当前拒绝了这个素材组。',
      `assetGroupId=${context.assetGroupId ?? 'unknown'}`,
      `currentGroupId=${context.currentGroupId ?? 'unknown'}`,
      `assetPath=${context.assetPath ?? 'unknown'}`,
      '现象是 `/api/material/asset-groups` 创建/查询正常，但 `/api/material/assets` 仍返回 `NotFound.group_id`。',
    ].join(' ');
  }
  return text;
}

async function previewSubjectUpload(kwargs) {
  const assetSpecs = buildSubjectAssetSpecs(kwargs);
  const stateKey = trimToNull(kwargs.stateKey) ?? 'default';
  const primarySpec = assetSpecs.find((item) => item.isPrimary);
  if (!primarySpec?.file && !primarySpec?.url) {
    throw new Error('缺少主参考图。请传 `--primaryFile` 或 `--primaryUrl`。');
  }
  return {
    dryRun: true,
    action: 'subject-upload',
    request: {
      name: trimToNull(kwargs.name),
      groupName: buildSubjectGroupName(kwargs, { defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) }),
      projectName: trimToNull(kwargs.projectName) ?? 'default',
      stateKey: trimToNull(kwargs.stateKey) ?? 'default',
      description:
        buildSubjectGroupDescription(kwargs, toBool(kwargs.defaultSafePublishNaming)),
      assets: assetSpecs.map((item) => ({
        label: item.label,
        assetName: buildSubjectAssetDisplayName(kwargs.name, stateKey, item.label, { kwargs, defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) }),
        file: item.file ?? null,
        url: item.url ?? null,
        assetPath: item.file ? `material/assets/${path.basename(item.file)}` : normalizeCosAssetPath(item.url),
        isPrimary: Boolean(item.isPrimary),
      })).filter((item) => item.file || item.url),
    },
    localFiles: await inspectLocalFiles(
      assetSpecs
        .map((item) => item.file)
        .filter(Boolean),
    ),
    publishLabel: resolveSubjectPublishLabel(kwargs, toBool(kwargs.defaultSafePublishNaming)),
    nextRefSubject: trimToNull(kwargs.name) ? `${trimToNull(kwargs.name)}=<subjectId>` : '<name>=<subjectId>',
  };
}

async function uploadSubjectAssets(kwargs) {
  const name = trimToNull(kwargs.name);
  const stateKey = trimToNull(kwargs.stateKey) ?? 'default';
  if (!name) {
    throw new Error('缺少 `--name`，例如 `--name 小莉`。');
  }
  const assetSpecs = buildSubjectAssetSpecs(kwargs);
  const primarySpec = assetSpecs.find((item) => item.isPrimary);
  if (!primarySpec?.file && !primarySpec?.url) {
    throw new Error('缺少主参考图。请传 `--primaryFile` 或 `--primaryUrl`。');
  }
  printRuntimeNote(['[AWB] 正在准备主体素材组并上传主体图片...']);
  const group = await ensureAssetGroupForSubject(kwargs, { defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) });
  const currentGroupId = await resolveCurrentGroupId();
  if (!group.groupId) {
    throw new Error('创建或查询主体素材组失败，未拿到 groupId。');
  }
  const result = {
    name,
    groupId: group.groupId,
    currentGroupId,
    groupName: group.groupName,
    projectName: group.projectName,
    stateKey,
    publishLabel: resolveSubjectPublishLabel(kwargs, toBool(kwargs.defaultSafePublishNaming)),
    reusedGroup: group.reused,
    subjectId: null,
    threeViewId: null,
    faceViewId: null,
    sideViewId: null,
    backViewId: null,
    uploadedAssets: [],
    nextRefSubject: null,
  };

  for (const spec of assetSpecs) {
    if (!spec.file && !spec.url) continue;
    const uploaded = spec.file
      ? await uploadAssetLibraryFile(spec.file, { currentGroupId })
      : null;
    const assetPath = uploaded?.assetPath ?? normalizeCosAssetPath(spec.url);
    if (!assetPath) continue;
    const created = await createSubjectAssetRecord({
      groupId: group.groupId,
      assetPath,
      name: buildSubjectAssetDisplayName(name, stateKey, spec.label, { kwargs, defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) }),
      platform: kwargs.platform,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `注册主体素材失败: ${spec.label} -> ${assetPath} (${rewriteSubjectUploadError(message, {
          assetGroupId: group.groupId,
          currentGroupId,
          assetPath,
        })})`,
      );
    });
    const assetId = created.assetId;
    result[spec.idField] = assetId;
    if (spec.optionalIdField) {
      result[spec.optionalIdField] = assetId;
    }
    if (spec.isPrimary) {
      result.subjectId = assetId;
    }
    result.uploadedAssets.push({
      label: spec.label,
      assetId,
      assetPath,
      filePath: uploaded?.filePath ?? null,
      publicUrl: uploaded?.publicUrl ?? null,
      raw: JSON.stringify(created.raw ?? {}),
    });
  }

  if (!result.subjectId) {
    throw new Error('主体素材上传完成，但没有拿到 subjectId。请检查主参考图是否创建成功。');
  }
  result.nextRefSubject = `${name}=${result.subjectId}`;
  result.raw = JSON.stringify({
    group,
    uploadedAssets: result.uploadedAssets,
  });
  return result;
}

async function previewUploadFiles(kwargs) {
  const files = parseListArg(kwargs.files);
  const inspected = await inspectLocalFiles(files);
  const sceneType = kwargs.sceneType || TASK_UPLOAD_SCENE.IMAGE_CREATE;
  return inspected.map((item) => ({
    ...item,
    sceneType,
    backendPath: buildDryRunBackendPath(item.filePath, sceneType),
    objectName: null,
    publicUrl: null,
    signedUrl: null,
    groupId: '__dry_run__',
    dryRun: true,
    action: 'upload-files',
  }));
}

async function pollQrLogin(sceneStr, options = {}) {
  const waitSeconds = toInt(options.waitSeconds, 180);
  const pollIntervalMs = toInt(options.pollIntervalMs, 2000);
  const deadline = Date.now() + waitSeconds * 1000;
  let lastStatus = null;

  while (Date.now() < deadline) {
    const check = await apiFetch('/api/anime/user/account/wechat/mp/check', {
      method: 'GET',
      auth: false,
      query: { sceneStr },
    });
    const status = check?.status ?? 'pending';
    if (status !== lastStatus) {
      printRuntimeNote([`[AWB] 扫码状态: ${status}`]);
      lastStatus = status;
    }

    if (status === 'success') {
      await saveLoginPayload(check, { loginMethod: 'wechat-qr' });
      const me = await currentUserSummary().catch(() => ({}));
      printRuntimeNote([
        '[AWB] 微信扫码登录成功',
        `[AWB] 当前用户: ${me.userName ?? '未识别'}`,
        `[AWB] 当前团队: ${me.currentGroupName ?? '未选择'}`,
      ]);
      return {
        status,
        loginMethod: 'wechat-qr',
        needsBind: false,
        qrUrl: null,
        sceneStr,
        currentGroupName: me.currentGroupName ?? null,
        currentGroupId: me.currentGroupId ?? null,
        groupCount: Array.isArray(check?.groupMembers) ? check.groupMembers.length : 0,
      };
    }

    if (status === 'needBind') {
      await saveAuth({ tempToken: check?.tempToken, loginMethod: 'wechat-need-bind' });
      printRuntimeNote(['[AWB] 扫码成功，但该账号还需要绑定手机号。']);
      return {
        status,
        loginMethod: 'wechat-qr',
        needsBind: true,
        qrUrl: null,
        sceneStr,
        currentGroupName: null,
        currentGroupId: null,
        groupCount: 0,
      };
    }

    if (status === 'expired' || status === 'error') {
      printRuntimeNote([`[AWB] 本次二维码状态异常: ${status}`]);
      return {
        status,
        loginMethod: 'wechat-qr',
        needsBind: false,
        qrUrl: null,
        sceneStr,
        currentGroupName: null,
        currentGroupId: null,
        groupCount: 0,
      };
    }

    await sleep(pollIntervalMs);
  }

  return {
    status: 'timeout',
    loginMethod: 'wechat-qr',
    needsBind: false,
    qrUrl: null,
    sceneStr,
    currentGroupName: null,
    currentGroupId: null,
    groupCount: 0,
  };
}

function parseListArg(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[')) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error('Expected a JSON array.');
    }
    return parsed.filter(Boolean);
  }
  return splitCsv(text);
}

function parseStoryboardPromptsArg(value) {
  if (value == null || value === '') return [];
  const rawItems =
    Array.isArray(value)
      ? value
      : (() => {
          const text = String(value).trim();
          if (!text) return [];
          if (text.startsWith('[')) {
            const parsed = JSON.parse(text);
            if (!Array.isArray(parsed)) {
              throw new Error('`storyboardPrompts` 必须是 JSON 数组或用 `||` 分隔的字符串。');
            }
            return parsed;
          }
          return text.split('||');
        })();

  return rawItems
    .map((item) => {
      if (typeof item === 'string') {
        const prompt = trimToNull(item);
        return prompt ? { prompt } : null;
      }
      const prompt = trimToNull(item?.prompt ?? item?.text ?? item?.content);
      if (!prompt) return null;
      return {
        ...item,
        prompt,
      };
    })
    .filter(Boolean);
}

function normalizeStoryboardPromptsForPromptParams(rows, generatedTime) {
  const items = rows.map((item, index) => ({
    ...item,
    index: toNumberOrNull(item?.index) ?? index + 1,
  }));
  if (!items.length) return items;

  const totalDuration = toNumberOrNull(generatedTime);
  const missingDurationItems = items.filter((item) => item.duration == null || item.duration === '');

  if (missingDurationItems.length && totalDuration != null) {
    const explicitDurationTotal = items.reduce((sum, item) => {
      if (item.duration == null || item.duration === '') return sum;
      const duration = toNumberOrNull(item.duration);
      if (duration == null || duration <= 0) {
        throw new Error('故事板分镜 duration 必须是正数，单位为秒。');
      }
      return sum + duration;
    }, 0);
    const remainingDuration = totalDuration - explicitDurationTotal;
    if (remainingDuration <= 0) {
      throw new Error(`故事板分镜 duration 总和必须等于 generatedTime=${totalDuration} 秒。`);
    }
    if (remainingDuration < missingDurationItems.length) {
      throw new Error(`故事板总时长 ${totalDuration} 秒不足以分配给 ${missingDurationItems.length} 个未设置 duration 的分镜。`);
    }

    const baseDuration = Math.floor(remainingDuration / missingDurationItems.length);
    let remainder = Math.round(remainingDuration - baseDuration * missingDurationItems.length);
    for (const item of missingDurationItems) {
      item.duration = baseDuration + (remainder > 0 ? 1 : 0);
      remainder -= 1;
    }
  }

  let hasAllDurations = true;
  const normalizedItems = items.map((item) => {
    if (item.duration == null || item.duration === '') {
      hasAllDurations = false;
      return item;
    }
    const duration = toNumberOrNull(item.duration);
    if (duration == null || duration <= 0) {
      throw new Error('故事板分镜 duration 必须是正数，单位为秒。');
    }
    return {
      ...item,
      duration,
    };
  });

  if (hasAllDurations && totalDuration != null) {
    const durationTotal = normalizedItems.reduce((sum, item) => sum + (toNumberOrNull(item.duration) ?? 0), 0);
    if (Math.abs(durationTotal - totalDuration) > 1e-9) {
      throw new Error(`故事板分镜 duration 总和必须等于 generatedTime=${totalDuration} 秒，当前为 ${durationTotal} 秒。`);
    }
  }

  return normalizedItems;
}

function trimToNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function accessKeySourceLabel(source, sourceName) {
  if (source === 'env') return sourceName ? `env:${sourceName}` : 'env';
  if (source === 'saved') return 'saved';
  if (source === 'argument') return 'argument';
  return source ?? null;
}

function resolveLoginKeyInput(kwargs) {
  const explicitAccessKey = trimToNull(kwargs.accessKey);
  if (explicitAccessKey) {
    return { accessKey: explicitAccessKey, source: 'argument', sourceName: null };
  }
  if (toBool(kwargs.fromEnv)) {
    const envAccessKey = resolveRuntimeAccessKey(null);
    if (envAccessKey?.source === 'env') return envAccessKey;
  }
  return null;
}

async function verifyLoginAccessKey(accessKey) {
  const response = await fetch(`${API_ORIGIN}/api/anime/user/account/userInfo`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      productcode: PRODUCT_CODE,
      source: SOURCE,
      timestamp: String(Date.now()),
      'X-Access-Key': accessKey,
    },
    body: '{}',
  });
  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (
    !response.ok ||
    !payload ||
    payload?.code === 401 ||
    (payload?.code != null && payload.code !== 200) ||
    payload?.success === false
  ) {
    throw new Error(payload?.msg || payload?.message || 'AWB access key 验证失败，请检查 key 是否正确或是否有权限。');
  }
  const data = payload?.data ?? payload ?? {};
  return {
    verified: true,
    userId: data?.userId ?? data?.id ?? null,
    userName: data?.userName ?? data?.nickName ?? data?.name ?? null,
  };
}

function parseUsageTimeMs(value, fallback = null) {
  const text = trimToNull(value);
  if (!text) return fallback;
  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const normalized = /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(text)
    ? `${text.replace(' ', 'T')}+08:00`
    : text;
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed)) {
    throw new Error(`无法解析时间: ${text}。请使用毫秒时间戳或 ISO 时间，例如 2026-04-27T00:00:00+08:00。`);
  }
  return parsed;
}

function resolveUsageSinceMs(kwargs) {
  const explicitSinceMs = parseUsageTimeMs(kwargs.sinceMs, null);
  if (explicitSinceMs != null) return explicitSinceMs;
  const explicitSince = parseUsageTimeMs(kwargs.since, null);
  if (explicitSince != null) return explicitSince;
  const envSince = parseUsageTimeMs(
    process.env.AWB_USAGE_STARTED_AT ??
    process.env.AWB_PROJECT_STARTED_AT ??
    process.env.E2B_PROJECT_STARTED_AT ??
    process.env.SANDBOX_STARTED_AT ??
    null,
    null,
  );
  if (envSince != null) return envSince;
  const lastHours = toNumberOrNull(kwargs.lastHours);
  if (lastHours != null && lastHours > 0) return Date.now() - lastHours * 3600 * 1000;
  return null;
}

function resolveUsageStartBalance(kwargs) {
  return toNumberOrNull(
    kwargs.startProjectPointBalance ??
    kwargs.startBalance ??
    process.env.AWB_START_PROJECT_POINT_BALANCE ??
    process.env.AWB_PROJECT_START_POINT_BALANCE ??
    process.env.SANDBOX_START_PROJECT_POINT_BALANCE,
  );
}

function resolveUsagePointPriceYuan(kwargs) {
  const explicit = trimToNull(
    kwargs.pointPriceYuan ??
    kwargs.yuanPerPoint ??
    process.env.AWB_POINT_PRICE_YUAN ??
    process.env.AWB_YUAN_PER_POINT,
  );
  return toNumberOrNull(explicit) ?? 0.1;
}

async function resolvePreviewProjectGroupNo(explicit) {
  const explicitProjectGroupNo = trimToNull(explicit);
  if (explicitProjectGroupNo) return explicitProjectGroupNo;
  const envProjectGroupNo = resolveEnvProjectGroupNo();
  if (envProjectGroupNo) return envProjectGroupNo;
  return trimToNull((await loadState().catch(() => ({})))?.currentProjectGroupNo);
}

function calculateUsageCostYuan(points, pointPriceYuan) {
  if (points == null || pointPriceYuan == null) return null;
  return Math.round(Number(points) * Number(pointPriceYuan) * 10000) / 10000;
}

function taskTimeMs(row) {
  return parseUsageTimeMs(row?.gmtCreate ?? row?.gmtModified, null);
}

function taskUsageBucket(taskType) {
  const normalized = normalizeFeedTaskType(String(taskType ?? '').trim().toUpperCase());
  if (normalized === 'VIDEO_GROUP' || normalized === 'VIDEO_CREATE') return 'video';
  if (normalized === 'IMAGE_EDIT') return 'imageEdit';
  return 'image';
}

function createUsageBucket() {
  return {
    taskCount: 0,
    successTaskCount: 0,
    failedTaskCount: 0,
    runningTaskCount: 0,
    resultCount: 0,
    pointTotal: 0,
  };
}

function addTaskToUsageBucket(bucket, row) {
  const status = String(row?.taskStatus ?? '').trim().toUpperCase();
  const points = toNumberOrNull(row?.pointNo) ?? 0;
  const isSuccess = status === 'SUCCESS';
  const isFailed = ['FAILED', 'FAIL', 'ERROR', 'CANCEL', 'CANCELED', 'CANCELLED', 'TIMEOUT'].includes(status);
  bucket.taskCount += 1;
  if (isSuccess) {
    bucket.successTaskCount += 1;
    bucket.resultCount += Math.max(0, toInt(row?.resultCount, 0));
    bucket.pointTotal += points;
  } else if (isFailed) {
    bucket.failedTaskCount += 1;
  } else {
    bucket.runningTaskCount += 1;
  }
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeReferenceUrl(value) {
  const text = trimToNull(value);
  if (!text) return '';
  if (!/^https?:\/\//i.test(text)) {
    return text.startsWith('/') ? text : text;
  }
  try {
    const url = new URL(text);
    return url.pathname || text;
  } catch {
    return text;
  }
}

function parseNamedResourceSpecs(value, options = {}) {
  const {
    valueKey = 'value',
    itemLabel = '资源',
  } = options;

  if (value == null || value === '') return [];

  const normalizeObjectItem = (item) => {
    const name = trimToNull(item?.name) ?? trimToNull(item?.displayName);
    const displayName = trimToNull(item?.displayName) ?? name;
    const bindTo = trimToNull(item?.bindTo);
    const parsedValue =
      trimToNull(item?.[valueKey]) ??
      trimToNull(item?.value) ??
      trimToNull(item?.file) ??
      trimToNull(item?.url) ??
      trimToNull(item?.path) ??
      trimToNull(item?.elementId);
    if (!name || !parsedValue) {
      throw new Error(`${itemLabel} JSON 项缺少 name 或值字段。`);
    }
    return {
      ...item,
      name,
      displayName,
      bindTo,
      [valueKey]: parsedValue,
    };
  };

  if (Array.isArray(value)) {
    return value.filter(Boolean).map((item) => {
      if (typeof item === 'string') {
        return parseNamedResourceSpecs(item, options)[0];
      }
      return normalizeObjectItem(item);
    });
  }

  const text = String(value).trim();
  if (!text) return [];
  if (text.startsWith('[') || text.startsWith('{')) {
    const parsed = JSON.parse(text);
    const list = Array.isArray(parsed) ? parsed : [parsed];
    return list.filter(Boolean).map((item) => {
      if (typeof item === 'string') {
        return parseNamedResourceSpecs(item, options)[0];
      }
      return normalizeObjectItem(item);
    });
  }

  return splitCsv(text).map((item) => {
    const separatorIndex = item.indexOf('=');
    if (separatorIndex <= 0 || separatorIndex >= item.length - 1) {
      throw new Error(`${itemLabel} 参数格式错误：${item}。请写成 名称=值，多个用逗号分隔。`);
    }
    const left = item.slice(0, separatorIndex).trim();
    const right = item.slice(separatorIndex + 1).trim();
    const bindIndex = left.indexOf('@');
    const name = trimToNull(bindIndex >= 0 ? left.slice(0, bindIndex) : left);
    const bindTo = trimToNull(bindIndex >= 0 ? left.slice(bindIndex + 1) : null);
    if (!name || !right) {
      throw new Error(`${itemLabel} 参数格式错误：${item}。请写成 名称=值。`);
    }
    return {
      name,
      displayName: name,
      bindTo,
      [valueKey]: right,
    };
  });
}

function normalizeRows(list) {
  return list.map((item) => ({
    ...flattenRecord(item),
    raw: JSON.stringify(item),
  }));
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function resolveTaskRecordFile(kwargs = {}) {
  const filePath = trimToNull(kwargs.taskRecordFile ?? process.env.AWB_TASK_RECORD_FILE);
  return filePath ? path.resolve(filePath) : null;
}

function taskPromptSummary(input = {}) {
  const prompt =
    input.prompt ??
    input.frameText ??
    input.storyboardPrompts ??
    input.richTaskPrompt ??
    input.taskPrompt ??
    null;
  const text = trimToNull(prompt);
  return text ? text.slice(0, 160) : null;
}

async function appendTaskRecord(kwargs, record) {
  const filePath = resolveTaskRecordFile(kwargs);
  if (!filePath || !record?.taskId) return null;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify({
    schemaVersion: 1,
    site: SITE,
    recordedAt: new Date().toISOString(),
    ...record,
  })}\n`, 'utf8');
  return filePath;
}

async function loadTaskRecordRows(kwargs = {}) {
  const filePath = resolveTaskRecordFile(kwargs);
  if (!filePath) {
    throw new Error('请提供 `--taskRecordFile <path>`，或设置 AWB_TASK_RECORD_FILE。');
  }
  const text = await fs.readFile(filePath, 'utf8').catch((error) => {
    if (error?.code === 'ENOENT') return '';
    throw error;
  });
  const records = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  const latest = new Map();
  for (const record of records) {
    if (!record?.taskId) continue;
    latest.set(record.taskId, record);
  }
  const taskType = trimToNull(kwargs.taskType);
  const normalizedTaskType = taskType ? normalizeFeedTaskType(taskType) : null;
  const pendingOnly = toBool(kwargs.pendingOnly);
  const limit = Math.max(1, toInt(kwargs.limit, 100));
  return [...latest.values()]
    .filter((record) => !normalizedTaskType || normalizeFeedTaskType(record.taskType) === normalizedTaskType)
    .filter((record) => {
      if (!pendingOnly) return true;
      const status = String(record.taskStatus ?? '').trim().toUpperCase();
      return !record.firstResultUrl && !TERMINAL_TASK_STATES.has(status);
    })
    .sort((a, b) => String(b.recordedAt ?? '').localeCompare(String(a.recordedAt ?? '')))
    .slice(0, limit);
}

async function pollTaskRecordRows(kwargs = {}) {
  const waitSeconds = Math.max(0, toInt(kwargs.waitSeconds, 0));
  const pollIntervalMs = Math.max(1000, toInt(kwargs.pollIntervalMs, 5000));
  const deadline = Date.now() + waitSeconds * 1000;
  let pending = await loadTaskRecordRows({ ...kwargs, pendingOnly: true });
  const latestByTaskId = new Map();

  while (pending.length) {
    if (waitSeconds > 0 && Date.now() >= deadline) break;
    for (const record of pending) {
      const taskType = normalizeFeedTaskType(record.taskType || kwargs.taskType || 'IMAGE_CREATE');
      const checked = await findTaskOnce({
        taskId: record.taskId,
        taskType,
        projectGroupNo: record.projectGroupNo ?? kwargs.projectGroupNo,
        pageSize: kwargs.pageSize ?? 100,
      }).catch((error) => ({
        taskId: record.taskId,
        taskType,
        projectGroupNo: record.projectGroupNo ?? kwargs.projectGroupNo ?? null,
        taskStatus: 'QUERY_ERROR',
        errorMsg: error instanceof Error ? error.message : String(error),
      }));
      const status = String(checked?.taskStatus ?? '').trim().toUpperCase();
      const completed = Boolean(checked?.firstResultUrl) || TERMINAL_TASK_STATES.has(status);
      const event = completed ? 'completed' : 'checked';
      const timedOut = !completed && waitSeconds > 0 && Date.now() >= deadline;
      const next = {
        ...record,
        ...checked,
        event,
        command: 'task-record-poll',
        taskType,
        taskId: record.taskId,
        projectGroupNo: checked?.projectGroupNo ?? record.projectGroupNo ?? kwargs.projectGroupNo ?? null,
        firstResultUrl: checked?.firstResultUrl ?? record.firstResultUrl ?? null,
        resultCount: checked?.resultCount ?? record.resultCount ?? null,
        timedOut,
      };
      await appendTaskRecord(kwargs, next);
      latestByTaskId.set(record.taskId, next);
    }

    pending = [...latestByTaskId.values()].filter((record) => {
      const status = String(record.taskStatus ?? '').trim().toUpperCase();
      return !record.firstResultUrl && !TERMINAL_TASK_STATES.has(status);
    });
    if (!pending.length || waitSeconds <= 0 || Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  }

  return [...latestByTaskId.values()];
}

function formatStatTimestamp(input) {
  const value = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(value.getTime())) {
    throw new Error(`无效时间: ${input}`);
  }
  const pad = (number) => String(number).padStart(2, '0');
  return [
    value.getFullYear(),
    pad(value.getMonth() + 1),
    pad(value.getDate()),
  ].join('-') + ' ' + [
    pad(value.getHours()),
    pad(value.getMinutes()),
    pad(value.getSeconds()),
  ].join(':');
}

function resolveStatTimeRange(kwargs = {}) {
  const end = kwargs.endTs ? new Date(kwargs.endTs) : new Date();
  const start = kwargs.startTs
    ? new Date(kwargs.startTs)
    : new Date(end.getTime() - Math.max(1, toInt(kwargs.days, 7)) * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('时间格式无效。示例: --startTs "2026-04-20 00:00:00" --endTs "2026-04-27 23:59:59"');
  }
  if (end.getTime() <= start.getTime()) {
    throw new Error('结束时间必须晚于开始时间。');
  }
  return { start, end };
}

function normalizeStatRow(row = {}) {
  const toSec = (ms) => {
    const value = toNumberOrNull(ms);
    return value == null ? null : Number((value / 1000).toFixed(2));
  };
  return {
    bucketStart: row.bucket_start ?? row.stat_time ?? row.date ?? null,
    statScope: row.stat_scope ?? null,
    statGranularity: row.stat_granularity ?? null,
    bizType: row.biz_type ?? null,
    platformType: row.platform_type ?? null,
    modelUseType: row.model_use_type ?? null,
    channel: row.channel ?? null,
    totalCount: row.total_cnt ?? null,
    successCount: row.success_cnt ?? null,
    failCount: row.fail_cnt ?? null,
    systemFailCount: row.system_fail_cnt ?? null,
    successRate: row.success_rate ?? null,
    failRate: row.fail_rate ?? null,
    totalAvgSeconds: toSec(row.total_avg_ms),
    successAvgSeconds: toSec(row.success_avg_ms),
    failAvgSeconds: toSec(row.fail_avg_ms),
    totalMaxSeconds: toSec(row.total_max_ms),
    raw: JSON.stringify(row),
  };
}

async function fetchTaskDurationStats(kwargs = {}) {
  const { start, end } = resolveStatTimeRange(kwargs);
  const statScope = trimToNull(kwargs.statScope ?? kwargs.scope) ?? 'channel';
  const statGranularity = trimToNull(kwargs.statGranularity ?? kwargs.granularity) ?? 'day';
  const pageSize = Math.min(Math.max(toInt(kwargs.pageSize, 20), 1), 100);
  const params = new URLSearchParams({
    stat_scope: statScope,
    stat_granularity: statGranularity,
    start_ts: formatStatTimestamp(start),
    end_ts: formatStatTimestamp(end),
    page: String(Math.max(1, toInt(kwargs.page, 1))),
    page_size: String(pageSize),
    order_by: trimToNull(kwargs.orderBy) ?? 'total_avg_ms',
    order_dir: trimToNull(kwargs.orderDir) ?? 'desc',
  });
  const optionalMap = {
    bizType: 'biz_type',
    platformType: 'platform_type',
    modelUseType: 'model_use_type',
    channel: 'channel',
  };
  for (const [argKey, queryKey] of Object.entries(optionalMap)) {
    const value = trimToNull(kwargs[argKey]);
    if (value && (queryKey !== 'channel' || statScope === 'channel')) {
      params.set(queryKey, value);
    }
  }
  const response = await fetch(`${TASK_EXEC_STAT_ORIGIN}/api/task-exec-stat?${params.toString()}`);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(payload?.detail?.[0]?.msg || payload?.msg || `${response.status} ${response.statusText}`);
  }
  return {
    meta: payload?.meta ?? {},
    rows: (Array.isArray(payload?.series) ? payload.series : []).map(normalizeStatRow),
  };
}

function presentTaskDurationStats(result) {
  return withAliasesRows(result.rows, {
    bucketStart: '统计时间',
    bizType: '业务类型',
    platformType: '平台',
    modelUseType: '模型用途',
    channel: '通道',
    totalCount: '总数',
    successCount: '成功数',
    totalAvgSeconds: '平均耗时秒',
    successAvgSeconds: '成功平均秒',
    failAvgSeconds: '失败平均秒',
    totalMaxSeconds: '最大耗时秒',
  });
}

function resolveAssetEditAuthorization(kwargs = {}) {
  const direct = trimToNull(kwargs.authorization);
  if (direct) return direct;
  const envAuthorization = trimToNull(process.env.ASSET_EDIT_AUTHORIZATION);
  if (envAuthorization) return envAuthorization;
  const token = trimToNull(process.env.ASSET_EDIT_TOKEN);
  if (!token) return null;
  return /^bearer\s+/i.test(token) ? token : `Bearer ${token}`;
}

async function assetEditFetch(pathname, options = {}) {
  const url = new URL(pathname, ASSET_EDIT_ORIGIN);
  if (options.query) {
    for (const [key, value] of Object.entries(options.query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }
  const headers = { 'Content-Type': 'application/json' };
  const authorization = resolveAssetEditAuthorization(options.kwargs);
  if (authorization) headers.Authorization = authorization;
  const method = options.method ?? 'GET';
  const response = await fetch(url, {
    method,
    headers,
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = Array.isArray(payload?.detail)
      ? payload.detail.map((item) => item?.msg ?? JSON.stringify(item)).join('; ')
      : payload?.detail;
    throw new Error(detail || payload?.msg || `${response.status} ${response.statusText}`);
  }
  return payload;
}

function isLikelyVolcSeedanceUrl(input) {
  try {
    const url = new URL(input);
    const text = `${url.hostname} ${url.pathname} ${url.search}`.toLowerCase();
    return /(volc|volces|byte|tos|vod|doubao|seedance|dreamina|jimeng)/.test(text);
  } catch {
    return false;
  }
}

function normalizeAssetEditTask(row = {}) {
  return {
    taskId: row.public_id ?? row.id ?? null,
    remoteTaskId: row.remote_task_id ?? row.run_id ?? null,
    remoteRequestId: row.remote_request_id ?? null,
    status: row.status ?? null,
    callbackStatus: row.callback_status ?? null,
    resultUrl: row.result_url ?? row.output_play_url ?? null,
    sourceUrl: row.source_url ?? row.input_value ?? null,
    cosUrl: row.cos_url ?? null,
    expiresAt: row.expires_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    errorMessage: row.error_message ?? null,
    raw: JSON.stringify(row),
  };
}

function presentAssetEditTask(row) {
  return withAliasesRows([normalizeAssetEditTask(row)], {
    taskId: '去字幕任务ID',
    remoteTaskId: '远端任务ID',
    status: '状态',
    callbackStatus: '回调状态',
    resultUrl: '结果链接',
    expiresAt: '过期时间',
    createdAt: '创建时间',
    errorMessage: '错误',
  });
}

async function createSeedanceSubtitleRemoveTask(kwargs = {}) {
  const videoUrl = trimToNull(kwargs.videoUrl);
  if (!videoUrl) throw new Error('请提供 Seedance 2.0 原始火山视频链接：`--videoUrl <url>`。');
  if (!toBool(kwargs.force) && !isLikelyVolcSeedanceUrl(videoUrl)) {
    throw new Error('`--videoUrl` 看起来不像火山 / Seedance 2.0 原始链接。确认无误可加 `--force true`。');
  }
  if (kwargs.createdAt) {
    const createdMs = new Date(kwargs.createdAt).getTime();
    if (!Number.isNaN(createdMs) && Date.now() - createdMs > 24 * 60 * 60 * 1000 && !toBool(kwargs.force)) {
      throw new Error('Seedance 2.0 免费去字幕链路要求生成后 24 小时内处理；超过 24 小时请确认付费方案，或加 `--force true`。');
    }
  }
  return assetEditFetch('/api/watermark/tasks', {
    method: 'POST',
    kwargs,
    body: {
      name: trimToNull(kwargs.name) ?? null,
      task_id: trimToNull(kwargs.remoteTaskId) ?? null,
      video_url: videoUrl,
      callback_url: trimToNull(kwargs.callbackUrl) ?? null,
      cos_path: trimToNull(kwargs.cosPath) ?? null,
    },
  });
}

async function waitForAssetEditTask(kwargs = {}) {
  const waitSeconds = Math.max(0, toInt(kwargs.waitSeconds, 0));
  const pollIntervalMs = Math.max(1000, toInt(kwargs.pollIntervalMs, 5000));
  const deadline = Date.now() + waitSeconds * 1000;
  let task = null;
  do {
    task = await assetEditFetch(`/api/watermark/tasks/${kwargs.taskId}`, {
      kwargs,
      query: { cos_path: kwargs.cosPath },
    });
    const status = String(task?.status ?? '').trim().toUpperCase();
    if (['SUCCESS', 'SUCCEEDED', 'COMPLETED', 'DONE', 'FAILED', 'FAIL', 'ERROR', 'CANCELED', 'CANCELLED'].includes(status)) {
      return { ...task, timedOut: false };
    }
    if (waitSeconds <= 0 || Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (true);
  return { ...(task ?? {}), timedOut: waitSeconds > 0 };
}

function normalizePointPackageRows(list, source = 'api') {
  return list.map((item) => ({
    packageNo: item?.packageNo ?? null,
    title: item?.title ?? null,
    btnText: item?.btnText ?? null,
    payType: item?.payType ?? null,
    price: item?.price ?? null,
    priceYuan:
      item?.price == null || !Number.isFinite(Number(item.price))
        ? null
        : (Number(item.price) / 100).toFixed(2),
    originPrice: item?.originPrice ?? null,
    originPriceYuan:
      item?.originPrice == null || !Number.isFinite(Number(item.originPrice))
        ? null
        : (Number(item.originPrice) / 100).toFixed(2),
    integralValue: item?.integralValue ?? null,
    integralProgressValue: item?.integralProgressValue ?? null,
    pointDesc: item?.pointDesc ?? null,
    integralDesc: item?.integralDesc ?? null,
    description: item?.description ?? null,
    status: item?.status ?? null,
    tag: Array.isArray(item?.tag) ? item.tag.join(', ') : item?.tag ?? null,
    titleIcon: item?.titleIcon ?? null,
    packageType: item?.packageType ?? null,
    source,
    raw: JSON.stringify(item),
  }));
}

async function savePointPackageCache(rows) {
  await writeJsonFile(POINT_PACKAGE_CACHE_PATH, rows);
}

async function loadPointPackageCache() {
  const payload = await readJsonFile(POINT_PACKAGE_CACHE_PATH, []);
  return Array.isArray(payload) ? payload : [];
}

function normalizePointRecordOperation(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text || text === 'all' || text === '全部') return 'all';
  if (['expend', 'expand', 'consume', 'cost', '消耗'].includes(text)) return 'expend';
  if (['recharge', 'gain', 'income', '获得'].includes(text)) return 'recharge';
  return text || 'all';
}

function resolvePointRecordQueryType(operation) {
  if (operation === 'expend') return 2;
  if (operation === 'recharge') return 3;
  return 1;
}

function normalizePointRecordRequestBody(body, fallbackOperation = 'all') {
  const input = body && typeof body === 'object' ? body : {};
  const normalizedOperation = normalizePointRecordOperation(
    input.queryType === 2
      ? 'expend'
      : input.queryType === 3
        ? 'recharge'
        : input.operation ?? fallbackOperation,
  );
  return {
    queryType: toInt(input.queryType, resolvePointRecordQueryType(normalizedOperation)),
    page: toInt(input.page ?? input.current, 1),
    size: toInt(input.size, 10),
  };
}

function normalizePointRecordRows(payload, source = 'api') {
  const detailList = Array.isArray(payload?.animeBenefitsDetailList)
    ? payload.animeBenefitsDetailList
    : firstArray(payload);
  return detailList.map((item) => ({
    title: item?.title ?? null,
    operation: item?.operation ?? null,
    operationText:
      item?.operation === 'expend'
        ? '消耗'
        : item?.operation === 'recharge'
          ? '获得'
          : item?.operation ?? null,
    point: item?.point ?? null,
    operationTime: item?.operationTime ?? null,
    current: payload?.current ?? null,
    size: payload?.size ?? null,
    total: payload?.total ?? null,
    pages: payload?.pages ?? null,
    remainPoint: payload?.remainPoint ?? null,
    dataPlanPoint: payload?.dataPlanPoint ?? null,
    topUpPoint: payload?.topUpPoint ?? null,
    source,
    raw: JSON.stringify(item),
  }));
}

async function savePointRecordCache(record) {
  await writeJsonFile(POINT_RECORD_CACHE_PATH, record);
}

async function loadPointRecordCache() {
  return readJsonFile(POINT_RECORD_CACHE_PATH, {});
}

async function loadPointRecordFallback() {
  const recordPath = path.join(process.cwd(), '.opencli', 'record', SITE, 'captured.json');
  const payload = await readJsonFile(recordPath, null);
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const snapshots = {};
  for (const request of requests) {
    if (request?.url !== '/api/anime/member/benefits/queryPointRecord') continue;
    const data = request?.body?.data;
    if (!data || !Array.isArray(data?.animeBenefitsDetailList)) continue;
    const operations = new Set(
      data.animeBenefitsDetailList.map((item) => String(item?.operation ?? '').trim()).filter(Boolean),
    );
    const key =
      operations.size === 2
        ? 'all'
        : operations.has('expend')
          ? 'expend'
          : operations.has('recharge')
            ? 'recharge'
            : 'all';
    snapshots[key] = {
      rows: normalizePointRecordRows(data, 'cache'),
      meta: {
        current: data?.current ?? null,
        size: data?.size ?? null,
        total: data?.total ?? null,
        pages: data?.pages ?? null,
        remainPoint: data?.remainPoint ?? null,
      },
    };
  }
  if (Object.keys(snapshots).length) {
    await savePointRecordCache(snapshots);
  }
  return snapshots;
}

async function loadPointPackageRecordFallback() {
  const recordPath = path.join(process.cwd(), '.opencli', 'record', SITE, 'captured.json');
  const payload = await readJsonFile(recordPath, null);
  const requests = Array.isArray(payload?.requests) ? payload.requests : [];
  const request = [...requests]
    .reverse()
    .find(
      (item) =>
        item?.url === '/api/anime/member/benefits/queryPointPackage' &&
        Array.isArray(item?.body?.data),
    );
  const rows = Array.isArray(request?.body?.data)
    ? normalizePointPackageRows(request.body.data, 'cache')
    : [];
  if (rows.length) {
    await savePointPackageCache(rows);
  }
  return rows;
}

function normalizePayStatus(payStatus) {
  const numeric = toInt(payStatus, Number(payStatus));
  if (!Number.isFinite(numeric)) {
    return {
      payStatus: payStatus ?? null,
      payStatusText: null,
      isPending: false,
      isFinal: false,
    };
  }
  const payStatusTextMap = {
    10: '待支付',
    20: '支付成功',
    30: '支付失败',
    40: '已关闭',
    50: '已过期',
  };
  return {
    payStatus: numeric,
    payStatusText: payStatusTextMap[numeric] ?? `状态 ${numeric}`,
    isPending: numeric === 10,
    isFinal: numeric !== 10,
  };
}

async function fetchPayStatus(rechargeNo) {
  const payload = await apiFetch('/api/anime/member/order/getPayStatus', {
    body: { rechargeNo },
  });
  const status = normalizePayStatus(payload?.payStatus);
  return {
    rechargeNo: payload?.rechargeNo ?? rechargeNo,
    ...status,
    raw: JSON.stringify(payload),
  };
}

async function pollPayStatus(rechargeNo, options = {}) {
  const waitSeconds = Math.max(0, toInt(options.waitSeconds, 0));
  const pollIntervalMs = Math.max(500, toInt(options.pollIntervalMs, 1500));
  const deadline = Date.now() + waitSeconds * 1000;

  let last = await fetchPayStatus(rechargeNo);
  if (waitSeconds <= 0 || last.isFinal) {
    return last;
  }

  while (Date.now() < deadline) {
    await sleep(pollIntervalMs);
    last = await fetchPayStatus(rechargeNo);
    if (last.isFinal) {
      return last;
    }
  }

  return {
    ...last,
    timedOut: true,
  };
}

function trimRequiredText(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!text) {
    throw new Error(`缺少 \`${fieldName}\`。`);
  }
  return text;
}

function normalizeInvoiceType(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['增值税专用发票', '专票', 'special', 'vat-special', 'vat_special'].includes(text)) {
    return {
      label: '增值税专用发票',
      optionId: 'optz0UIdZY',
    };
  }
  if (['普通发票', '普票', 'normal', 'plain', 'common'].includes(text)) {
    return {
      label: '普通发票',
      optionId: 'optx5SHn6y',
    };
  }
  throw new Error('`invoiceType` 只支持：增值税专用发票 / 普通发票（也接受：专票 / 普票）。');
}

function normalizeInvoiceSubjectType(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (['企业', 'company', 'corp', 'enterprise'].includes(text)) {
    return {
      label: '企业',
      optionId: 'optPoYl7YK',
    };
  }
  if (['个人', 'personal', 'individual', 'person'].includes(text)) {
    return {
      label: '个人',
      optionId: 'opt4a6wZaI',
    };
  }
  throw new Error('`subjectType` 只支持：企业 / 个人。');
}

function buildInvoiceTextValue(value) {
  return [{ type: 'text', text: String(value) }];
}

function buildCookieHeader(cookies) {
  return cookies
    .filter((cookie) => cookie?.name && cookie?.value)
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');
}

async function getFeishuCookieHeader(page) {
  const cookies = await page.getCookies({ domain: 'feishu.cn' });
  const cookieHeader = buildCookieHeader(cookies);
  if (!cookieHeader) {
    throw new Error('未读取到飞书登录态。请先在 Dia/Chrome 中登录飞书，并至少打开一次 AWB 开票表单页面。');
  }
  return cookieHeader;
}

function buildFeishuHeaders(cookieHeader, extra = {}) {
  return {
    origin: FEISHU_ORIGIN,
    referer: AWB_INVOICE_FORM_URL,
    cookie: cookieHeader,
    ...extra,
  };
}

async function fetchJsonWithCookie(url, options = {}) {
  const {
    method = 'GET',
    cookieHeader,
    headers = {},
    body,
  } = options;
  const response = await fetch(url, {
    method,
    headers: buildFeishuHeaders(cookieHeader, headers),
    body,
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  if (!response.ok) {
    throw new Error(payload?.msg || payload?.message || `${response.status} ${response.statusText}`);
  }
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload?.msg || payload?.message || '请求失败');
  }
  return payload?.data ?? payload;
}

function buildInvoiceAttachmentValue(fileInfo, fileToken) {
  const now = Date.now();
  return [
    {
      token: `${fileInfo.fileName}${now}`,
      name: fileInfo.fileName,
      mimeType: fileInfo.mimeType,
      size: fileInfo.size,
      state: 'loaded',
      file: {},
      disablePreviewAttach: true,
      attachmentToken: fileToken,
      id: fileToken,
      timeStamp: now,
    },
  ];
}

async function uploadInvoiceProofWithBrowserCookie(page, filePath) {
  const cookieHeader = await getFeishuCookieHeader(page);
  const fileInfo = await inspectLocalFileInfo(filePath);
  const fileBuffer = await fs.readFile(fileInfo.filePath);

  const uploadCodeUrl = new URL('/space/api/bitable/external/share/uploadCode', FEISHU_ORIGIN);
  uploadCodeUrl.searchParams.set('shareToken', AWB_INVOICE_SHARE_TOKEN);
  uploadCodeUrl.searchParams.set('fileName', fileInfo.fileName);
  uploadCodeUrl.searchParams.set('size', String(fileInfo.size));
  uploadCodeUrl.searchParams.set('mountPoint', AWB_INVOICE_UPLOAD_MOUNT_POINT);

  const uploadCodeResp = await fetchJsonWithCookie(uploadCodeUrl, {
    cookieHeader,
  });
  const uploadCode = uploadCodeResp?.uploadCode;
  if (!uploadCode) {
    throw new Error('开票凭证上传失败：未拿到 uploadCode。');
  }

  const prepareResp = await fetchJsonWithCookie(
    `${FEISHU_ORIGIN}/space/api/box/upload/prepare/authcode/`,
    {
      method: 'POST',
      cookieHeader,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        code: uploadCode,
        mount_point: AWB_INVOICE_UPLOAD_MOUNT_POINT,
        mount_node_token: AWB_INVOICE_SHARE_TOKEN,
      }),
    },
  );
  const uploadId = prepareResp?.upload_id;
  const numBlocks = prepareResp?.num_blocks ?? 1;
  if (!uploadId) {
    throw new Error('开票凭证上传失败：未拿到 upload_id。');
  }

  const mergeResponse = await fetch(
    `${FEISHU_STREAM_ORIGIN}/space/api/box/stream/upload/merge_block/?upload_id=${encodeURIComponent(uploadId)}`,
    {
      method: 'POST',
      headers: buildFeishuHeaders(cookieHeader, {
        'content-type': fileInfo.mimeType,
        'content-length': String(fileBuffer.length),
      }),
      body: fileBuffer,
    },
  );
  if (!mergeResponse.ok) {
    throw new Error(`开票凭证上传失败：merge_block 返回 ${mergeResponse.status} ${mergeResponse.statusText}`);
  }

  const finishResp = await fetchJsonWithCookie(
    `${FEISHU_ORIGIN}/space/api/box/upload/finish/`,
    {
      method: 'POST',
      cookieHeader,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        upload_id: uploadId,
        num_blocks: numBlocks,
        push_open_history_record: 0,
      }),
    },
  );
  const fileToken = finishResp?.file_token;
  if (!fileToken) {
    throw new Error('开票凭证上传失败：未拿到 file_token。');
  }

  return {
    fileInfo,
    cookieHeader,
    uploadId,
    fileToken,
    attachmentValue: buildInvoiceAttachmentValue(fileInfo, fileToken),
  };
}

function buildInvoiceFormPayload(kwargs, attachmentValue) {
  const invoiceType = normalizeInvoiceType(kwargs.invoiceType);
  const subjectType = normalizeInvoiceSubjectType(kwargs.subjectType);
  return {
    invoiceType,
    subjectType,
    payload: {
      fldwjCjowp: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.amountYuan, 'amountYuan')) },
      fldJ5N37jD: { type: 3, value: invoiceType.optionId },
      fldFL80hs0: { type: 3, value: subjectType.optionId },
      fldFbFi0eX: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.buyerName, 'buyerName')) },
      fldEVmYea5: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.buyerTaxNo, 'buyerTaxNo')) },
      fldVUui8e5: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.remark, 'remark')) },
      fldiLZmCBX: { type: 17, value: attachmentValue },
      fldWCtZ5fz: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.tradeNo, 'tradeNo')) },
      fldBRmTNBI: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.phone, 'phone')) },
      fld6ts5GYE: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.email, 'email')) },
      fldrGwMVeQ: { type: 1, value: buildInvoiceTextValue(trimRequiredText(kwargs.wechatName, 'wechatName')) },
    },
  };
}

async function submitInvoiceForm(page, kwargs) {
  const fileInfo = await inspectLocalFileInfo(kwargs.proofFile);
  const fileBuffer = await fs.readFile(fileInfo.filePath);
  const fileBase64 = fileBuffer.toString('base64');
  const { invoiceType, subjectType } = buildInvoiceFormPayload(kwargs, []);
  const tabsBefore = await page.tabs().catch(() => []);
  const originalActiveTab = Array.isArray(tabsBefore)
    ? tabsBefore.find((tab) => tab?.active === true) ?? null
    : null;
  let runtimeResult;
  let openedNewTab = false;
  try {
    await page.newTab().catch(() => {});
    openedNewTab = true;
    await page.goto(AWB_INVOICE_FORM_URL, { settleMs: 1500 });
    await page.wait(1);

    runtimeResult = await page.evaluate(`(async () => {
    const input = ${JSON.stringify({
      shareToken: AWB_INVOICE_SHARE_TOKEN,
      formUrl: AWB_INVOICE_FORM_URL,
      feishuOrigin: FEISHU_ORIGIN,
      streamOrigin: FEISHU_STREAM_ORIGIN,
      mountPoint: AWB_INVOICE_UPLOAD_MOUNT_POINT,
      file: {
        name: fileInfo.fileName,
        size: fileInfo.size,
        mimeType: fileInfo.mimeType,
        base64: fileBase64,
      },
      fields: {
        amountYuan: String(kwargs.amountYuan).trim(),
        invoiceTypeOptionId: invoiceType.optionId,
        subjectTypeOptionId: subjectType.optionId,
        buyerName: String(kwargs.buyerName).trim(),
        buyerTaxNo: String(kwargs.buyerTaxNo).trim(),
        remark: String(kwargs.remark).trim(),
        tradeNo: String(kwargs.tradeNo).trim(),
        phone: String(kwargs.phone).trim(),
        email: String(kwargs.email).trim(),
        wechatName: String(kwargs.wechatName).trim(),
      },
    })};

    const decodeBase64 = (base64) => {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return bytes;
    };

    const readCsrfToken = () => {
      const token = document.cookie
        .split(';')
        .map((item) => item.trim())
        .find((item) => item.startsWith('_csrf_token='));
      return token ? decodeURIComponent(token.slice('_csrf_token='.length)) : '';
    };

    const adler32 = (bytes) => {
      const MOD = 65521;
      let a = 1;
      let b = 0;
      for (const byte of bytes) {
        a = (a + byte) % MOD;
        b = (b + a) % MOD;
      }
      return (((b << 16) | a) >>> 0).toString();
    };

    const requestJson = async (url, options = {}) => {
      const csrfToken = readCsrfToken();
      const response = await fetch(url, {
        credentials: 'include',
        headers: {
          ...(csrfToken ? { 'x-csrftoken': csrfToken } : {}),
          ...(options.headers || {}),
        },
        ...options,
      });
      const text = await response.text();
      let payload = null;
      try {
        payload = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(\`请求 \${url} 返回了非 JSON 响应: \${text.slice(0, 120)}\`);
      }
      if (!response.ok) {
        throw new Error(payload?.msg || payload?.message || \`\${response.status} \${response.statusText}\`);
      }
      if (payload?.code !== undefined && payload.code !== 0) {
        throw new Error(payload?.msg || payload?.message || '请求失败');
      }
      return payload?.data ?? payload;
    };

    if (!location.href.startsWith(input.formUrl)) {
      throw new Error('当前浏览器上下文不在飞书开票表单页，请先打开该表单。');
    }

    const uploadCodeUrl = new URL('/space/api/bitable/external/share/uploadCode', input.feishuOrigin);
    uploadCodeUrl.searchParams.set('shareToken', input.shareToken);
    uploadCodeUrl.searchParams.set('fileName', input.file.name);
    uploadCodeUrl.searchParams.set('size', String(input.file.size));
    uploadCodeUrl.searchParams.set('mountPoint', input.mountPoint);

    const uploadCodeResp = await requestJson(uploadCodeUrl.toString());
    const uploadCode = uploadCodeResp?.uploadCode;
    if (!uploadCode) {
      throw new Error('开票凭证上传失败：未拿到 uploadCode。');
    }

    const prepareResp = await requestJson(
      input.feishuOrigin + '/space/api/box/upload/prepare/authcode/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          code: uploadCode,
          mount_point: input.mountPoint,
          mount_node_token: input.shareToken,
        }),
      },
    );
    const uploadId = prepareResp?.upload_id;
    const blockSize = prepareResp?.block_size ?? 4194304;
    const numBlocks = prepareResp?.num_blocks ?? 1;
    if (!uploadId) {
      throw new Error('开票凭证上传失败：未拿到 upload_id。');
    }

    const fileBytes = decodeBase64(input.file.base64);
    const csrfToken = readCsrfToken();

    const mergeResponse = await fetch(
      input.streamOrigin + '/space/api/box/stream/upload/merge_block/?upload_id=' + encodeURIComponent(uploadId),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/octet-stream',
          'x-seq-list': '0',
          'x-block-list-checksum': adler32(fileBytes),
          'x-block-origin-size': String(blockSize),
          ...(csrfToken ? { 'x-csrftoken': csrfToken } : {}),
        },
        body: new Blob([fileBytes], { type: 'application/octet-stream' }),
      },
    );
    if (!mergeResponse.ok) {
      const mergeText = await mergeResponse.text().catch(() => '');
      throw new Error(\`开票凭证上传失败：merge_block 返回 \${mergeResponse.status} \${mergeResponse.statusText} \${mergeText.slice(0, 200)}\`.trim());
    }

    const finishResp = await requestJson(
      input.feishuOrigin + '/space/api/box/upload/finish/',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          upload_id: uploadId,
          num_blocks: numBlocks,
          push_open_history_record: 0,
        }),
      },
    );
    const fileToken = finishResp?.file_token;
    if (!fileToken) {
      throw new Error('开票凭证上传失败：未拿到 file_token。');
    }

    const now = Date.now();
    const payload = {
      fldwjCjowp: { type: 1, value: [{ type: 'text', text: input.fields.amountYuan }] },
      fldJ5N37jD: { type: 3, value: input.fields.invoiceTypeOptionId },
      fldFL80hs0: { type: 3, value: input.fields.subjectTypeOptionId },
      fldFbFi0eX: { type: 1, value: [{ type: 'text', text: input.fields.buyerName }] },
      fldEVmYea5: { type: 1, value: [{ type: 'text', text: input.fields.buyerTaxNo }] },
      fldVUui8e5: { type: 1, value: [{ type: 'text', text: input.fields.remark }] },
      fldiLZmCBX: {
        type: 17,
        value: [{
          token: input.file.name + now,
          name: input.file.name,
          mimeType: input.file.mimeType,
          size: input.file.size,
          state: 'loaded',
          file: {},
          disablePreviewAttach: true,
          attachmentToken: fileToken,
          id: fileToken,
          timeStamp: now,
        }],
      },
      fldWCtZ5fz: { type: 1, value: [{ type: 'text', text: input.fields.tradeNo }] },
      fldBRmTNBI: { type: 1, value: [{ type: 'text', text: input.fields.phone }] },
      fld6ts5GYE: { type: 1, value: [{ type: 'text', text: input.fields.email }] },
      fldrGwMVeQ: { type: 1, value: [{ type: 'text', text: input.fields.wechatName }] },
    };

    if (!window.BitableDep?.submitFormData) {
      throw new Error('当前页面未加载飞书表单提交能力，请刷新表单页后重试。');
    }
    const submitResp = await window.BitableDep.submitFormData(input.shareToken, payload);

    return {
      uploadId,
      fileToken,
      payload,
      submitResp,
    };
  })()`);
  } finally {
    if (openedNewTab) {
      const tabsAfter = await page.tabs().catch(() => []);
      const activeIndex =
        Array.isArray(tabsAfter)
          ? (tabsAfter.find((tab) => tab?.active === true)?.index ?? null)
          : null;
      if (activeIndex != null) {
        await page.closeTab(activeIndex).catch(() => {});
      }
      if (originalActiveTab?.index != null) {
        await page.selectTab(originalActiveTab.index).catch(() => {});
      }
    }
  }

  return {
    applied: true,
    invoiceType: invoiceType.label,
    subjectType: subjectType.label,
    amountYuan: String(kwargs.amountYuan).trim(),
    buyerName: String(kwargs.buyerName).trim(),
    buyerTaxNo: String(kwargs.buyerTaxNo).trim(),
    tradeNo: String(kwargs.tradeNo).trim(),
    phone: String(kwargs.phone).trim(),
    email: String(kwargs.email).trim(),
    wechatName: String(kwargs.wechatName).trim(),
    proofFileName: fileInfo.fileName,
    proofFileSize: fileInfo.size,
    proofFileToken: runtimeResult?.fileToken ?? null,
    formUrl: AWB_INVOICE_FORM_URL,
    submitResult: JSON.stringify(runtimeResult?.submitResp ?? {}),
    raw: JSON.stringify({
      ...runtimeResult,
    }),
  };
}

function normalizeFeedTaskType(taskType) {
  return taskType === 'VIDEO_CREATE' ? 'VIDEO_GROUP' : taskType;
}

function findAihubmixVideoModel(modelCodeOrGroupCode) {
  const key = normalizeCodeKey(modelCodeOrGroupCode);
  if (!key) return null;
  return AIHUBMIX_VIDEO_MODELS.find((item) =>
    normalizeCodeKey(item.modelCode) === key ||
    normalizeCodeKey(item.modelGroupCode) === key ||
    normalizeCodeKey(item.modelName).includes(key)
  ) ?? null;
}

function isAihubmixVideoModelSelector(kwargs = {}) {
  return Boolean(findAihubmixVideoModel(kwargs.modelGroupCode) || findAihubmixVideoModel(kwargs.modelCode));
}

function normalizeAihubmixVideoModelRows() {
  return AIHUBMIX_VIDEO_MODELS.map((item) => ({
    ...item,
    provider: 'AiHubMix',
    groupHint: '外部',
    enabled: true,
    modelStatus: 'external',
    pointNo: null,
    taskQueueNum: null,
    successRate: null,
    successRatePct: null,
    successCount: null,
    failCount: null,
    totalSuccessCount: null,
    totalFailCount: null,
    extraFeatures: '外部计费 | async',
    featureSummary: [
      item.frameFeature ? `帧:${item.frameFeature}` : null,
      item.refFeature ? `参考:${item.refFeature}` : null,
      'AiHubMix外部计费',
    ].filter(Boolean).join('；'),
    feeCalcType: 'AIHUBMIX',
    displayScope: '',
    paramKeys: 'prompt,seconds,size,ratio,input_reference,extra_body',
    模型: item.modelName,
    提供方: 'AiHubMix',
    帧模式: item.frameFeature,
    参考模式: item.refFeature,
    特色能力: '外部计费 | async',
    通道: '外部',
    模型组: item.modelGroupCode,
    成功率: null,
    raw: JSON.stringify(item),
  }));
}

function formatSuccessRate(value) {
  const numeric = toNumberOrNull(value);
  if (numeric == null) return null;
  return `${(numeric * 100).toFixed(1)}%`;
}

function parseOptionList(optionList) {
  if (!optionList) return [];
  if (Array.isArray(optionList)) return optionList;
  if (typeof optionList === 'string') {
    try {
      return parseOptionList(JSON.parse(optionList));
    } catch {
      return [];
    }
  }
  if (typeof optionList === 'object') {
    for (const key of ['optionList', 'options', 'list', 'rows', 'data', 'enumList']) {
      if (!(key in optionList)) continue;
      const parsed = parseOptionList(optionList[key]);
      if (parsed.length) return parsed;
    }
  }
  return [];
}

function toCliFlag(paramKey) {
  return `--${String(paramKey)
    .split('_')
    .filter(Boolean)
    .map((part, index) => (index === 0 ? part : `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`))
    .join('')}`;
}

function hasPromptParamValue(value) {
  if (value == null) return false;
  if (typeof value === 'number' || typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return String(value).trim() !== '';
}

function hasUsableFrame(frame) {
  return Boolean(
    frame &&
      [frame.text, frame.url, frame.backendPath, frame._localFile]
        .map((value) => (value == null ? '' : String(value).trim()))
        .some(Boolean),
  );
}

function shouldValidateModelOption(option) {
  return [
    'EnumType',
    'FrameListType',
    'FileListType',
    'MultiPromptType',
  ].includes(option?.paramType) || ['multi_param', 'multi_prompt'].includes(option?.paramKey);
}

function optionValues(option) {
  return parseOptionList(option?.optionList)
    .filter((item) => item?.available !== false)
    .map((item) => item?.enumValue ?? item?.value ?? item?.enumName ?? item?.name ?? null)
    .filter((value) => value != null)
    .map((value) => String(value));
}

function normalizePromptParamList(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.filter((item) => hasPromptParamValue(item));
  if (hasPromptParamValue(value)) return [value];
  return [];
}

function optionLabel(option) {
  return option?.paramName ? `${option.paramKey}（${option.paramName}）` : option?.paramKey ?? 'unknown';
}

function exampleForModelOption(kind, option) {
  return modelParamExample(kind, option?.paramKey ?? '', optionValues(option));
}

function inferValueExtension(value) {
  const text = trimToNull(
    value?.filePath ??
    value?.backendPath ??
    value?.url ??
    value?.value ??
    value?.path ??
    value,
  );
  if (!text) return null;
  const clean = text.split('?')[0].split('#')[0];
  const ext = path.extname(clean).toLowerCase().replace(/^\./, '');
  return ext || null;
}

function validateSupportedFileTypes(items, supportedFileTypes = []) {
  const allowed = Array.isArray(supportedFileTypes)
    ? supportedFileTypes.map((item) => String(item).toLowerCase())
    : [];
  if (!allowed.length) return [];
  return items
    .map((item) => ({ item, ext: inferValueExtension(item) }))
    .filter((entry) => entry.ext && !allowed.includes(entry.ext))
    .map((entry) => ({
      value: trimToNull(entry.item?.filePath ?? entry.item?.backendPath ?? entry.item?.url ?? entry.item?.value ?? entry.item) ?? '<unknown>',
      ext: entry.ext,
      allowed,
    }));
}

function countFrameInputs(frames) {
  return normalizePromptParamList(frames).filter((item) => hasUsableFrame(item)).length;
}

function collectMultiParamResourceStats(value) {
  const rows = normalizePromptParamList(value);
  const counts = new Map();
  let totalCount = 0;

  for (const row of rows) {
    const resources = Array.isArray(row?.resources) && row.resources.length
      ? row.resources
      : [{ type: row?.referenceType ?? null, ...row }];
    for (const resource of resources) {
      const type = trimToNull(resource?.type ?? resource?.mediaType ?? resource?.resourceType ?? row?.referenceType);
      if (!type) continue;
      const normalizedType = String(type).toUpperCase();
      counts.set(normalizedType, (counts.get(normalizedType) ?? 0) + 1);
      if (normalizedType !== 'SUBJECT') {
        totalCount += 1;
      }
    }
  }

  return { counts, totalCount };
}

function validateFrameListOption(option, currentValue, kind) {
  const rules = modelParamRules(option);
  const count = countFrameInputs(currentValue);
  const required = rules?.required === true || option?.required === true;
  const minCount = toNumberOrNull(rules?.minFrameNum);
  const maxCount = toNumberOrNull(rules?.maxFrameNum);

  if (required && count === 0) {
    return {
      type: 'missing',
      option,
      detail: exampleForModelOption(kind, option),
    };
  }
  if (minCount != null && count > 0 && count < minCount) {
    return {
      type: 'invalid',
      option,
      detail: `至少需要 ${minCount} 帧，当前 ${count} 帧；示例: ${exampleForModelOption(kind, option)}`,
    };
  }
  if (maxCount != null && count > maxCount) {
    return {
      type: 'invalid',
      option,
      detail: `最多支持 ${maxCount} 帧，当前 ${count} 帧；示例: ${exampleForModelOption(kind, option)}`,
    };
  }
  return null;
}

function validateFileListOption(option, currentValue, kind) {
  const rules = modelParamRules(option);
  const items = normalizePromptParamList(currentValue);
  const required = rules?.required === true || option?.required === true;
  const minCount = toNumberOrNull(rules?.fileListMinNum ?? rules?.minNum);
  const maxCount = toNumberOrNull(rules?.fileListMaxNum ?? rules?.maxNum);

  if (required && items.length === 0) {
    return {
      type: 'missing',
      option,
      detail: exampleForModelOption(kind, option),
    };
  }
  if (minCount != null && items.length > 0 && items.length < minCount) {
    return {
      type: 'invalid',
      option,
      detail: `至少需要 ${minCount} 个参考，当前 ${items.length} 个；示例: ${exampleForModelOption(kind, option)}`,
    };
  }
  if (maxCount != null && items.length > maxCount) {
    return {
      type: 'invalid',
      option,
      detail: `最多支持 ${maxCount} 个参考，当前 ${items.length} 个；示例: ${exampleForModelOption(kind, option)}`,
    };
  }

  const invalidTypes = validateSupportedFileTypes(items, rules?.supportedFileTypes);
  if (invalidTypes.length) {
    const first = invalidTypes[0];
    return {
      type: 'invalid',
      option,
      detail: `不支持的文件后缀 .${first.ext}：${first.value}；允许后缀: ${first.allowed.join(', ')}`,
    };
  }
  return null;
}

function validateMultiParamOption(option, currentValue, kind) {
  const rules = modelParamRules(option);
  const rows = normalizePromptParamList(currentValue);
  const required = rules?.required === true || option?.required === true;
  if (required && rows.length === 0) {
    return {
      type: 'missing',
      option,
      detail: exampleForModelOption(kind, option),
    };
  }
  if (!rows.length) return null;

  const stats = collectMultiParamResourceStats(rows);
  const totalMax = toNumberOrNull(rules?.fileListMaxNum);
  if (totalMax != null && stats.totalCount > totalMax) {
    return {
      type: 'invalid',
      option,
      detail: `多参考总数最多 ${totalMax} 个，当前 ${stats.totalCount} 个；示例: ${exampleForModelOption(kind, option)}`,
    };
  }

  const allowedTypes = new Set(
    (Array.isArray(rules?.resources) ? rules.resources : [])
      .map((resourceRule) => trimToNull(resourceRule?.mediaType ?? resourceRule?.type))
      .filter(Boolean)
      .map((mediaType) => String(mediaType).toUpperCase()),
  );
  if (allowedTypes.size > 0) {
    const unsupportedTypes = [...stats.counts.keys()]
      .filter((type) => type !== 'SUBJECT' && !allowedTypes.has(type));
    if (unsupportedTypes.length) {
      return {
        type: 'invalid',
        option,
        detail: `当前模型的多参考模式不支持 ${unsupportedTypes.join(' / ')}；仅支持 ${[...allowedTypes].join(' / ')}；示例: ${exampleForModelOption(kind, option)}`,
      };
    }
  }

  for (const resourceRule of Array.isArray(rules?.resources) ? rules.resources : []) {
    const mediaType = trimToNull(resourceRule?.mediaType ?? resourceRule?.type);
    if (!mediaType) continue;
    const type = String(mediaType).toUpperCase();
    const count = stats.counts.get(type) ?? 0;
    const typeMax = toNumberOrNull(resourceRule?.fileListMaxNum);
    if (typeMax != null && count > typeMax) {
      return {
        type: 'invalid',
        option,
        detail: `${type} 参考最多 ${typeMax} 个，当前 ${count} 个；示例: ${exampleForModelOption(kind, option)}`,
      };
    }
  }

  return null;
}

function validateMultiPromptOption(option, currentValue, kind, generatedMode) {
  if (generatedMode !== 'multi_prompt') return null;
  const rows = normalizePromptParamList(currentValue);
  if (!rows.length) {
    return {
      type: 'missing',
      option,
      detail:
        kind === 'video'
          ? '--storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头"'
          : exampleForModelOption(kind, option),
    };
  }
  const rules = modelParamRules(option);
  const minCount = toNumberOrNull(rules?.minPromptNum);
  const maxCount = toNumberOrNull(rules?.maxPromptNum);
  const maxPromptLength = toNumberOrNull(rules?.maxPromptLength);
  if (minCount != null && rows.length < minCount) {
    return {
      type: 'invalid',
      option,
      detail: `故事板至少需要 ${minCount} 个分镜，当前 ${rows.length} 个；示例: --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头"`,
    };
  }
  if (maxCount != null && rows.length > maxCount) {
    return {
      type: 'invalid',
      option,
      detail: `故事板最多支持 ${maxCount} 个分镜，当前 ${rows.length} 个；示例: --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头"`,
    };
  }
  if (maxPromptLength != null) {
    const tooLong = rows.find((item) => String(item?.prompt ?? '').length > maxPromptLength);
    if (tooLong) {
      return {
        type: 'invalid',
        option,
        detail: `单个分镜提示词最长 ${maxPromptLength} 字；当前超长分镜: ${String(tooLong.prompt).slice(0, 40)}`,
      };
    }
  }
  return null;
}

function inferModelKind(modelCode = '', modelGroupCode = '') {
  const text = `${modelCode} ${modelGroupCode}`.toUpperCase();
  if (text.includes('VIDEO')) return 'video';
  if (text.includes('IMAGE')) return 'image';
  return 'generic';
}

function normalizeTaskTypeFromKind(kind) {
  if (kind === 'image') return 'IMAGE_CREATE';
  if (kind === 'video') return 'VIDEO_CREATE';
  return null;
}

function normalizeCodeKey(value) {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeViewerPermission(value) {
  const normalized = String(value ?? '').trim();
  return normalized || null;
}

function permissionLabel(value) {
  switch (normalizeViewerPermission(value)) {
    case '1':
      return '内部员工';
    case '2':
      return '合作方（专业版）';
    case '3':
      return '普通用户（含体验版）';
    case '4':
      return 'SVIP用户（企业版）';
    case '5':
      return 'VIP用户（实战版）';
    default:
      return null;
  }
}

function permissionDisplay(value) {
  const normalized = normalizeViewerPermission(value);
  const label = permissionLabel(normalized);
  if (!normalized) return null;
  return label ? `${normalized} · ${label}` : normalized;
}

function formatDateTime(value) {
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  try {
    return new Date(numeric).toLocaleString('zh-CN', {
      hour12: false,
    });
  } catch {
    return String(value);
  }
}

function parseModelDisplayScopes(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function isInternalOnlyModel(displayScopes = []) {
  return displayScopes.length === 1 && displayScopes[0] === '1';
}

function isModelVisibleForPermission(displayScopes = [], viewerPermission = null) {
  if (!displayScopes.length) return true;
  const normalizedPermission = normalizeViewerPermission(viewerPermission);
  if (normalizedPermission) {
    return displayScopes.includes(normalizedPermission);
  }
  return !isInternalOnlyModel(displayScopes);
}

async function resolveViewerPermission(kwargs = {}) {
  const explicitPermission = normalizeViewerPermission(kwargs.viewerPermission ?? kwargs.permission);
  if (explicitPermission) return explicitPermission;
  const state = await loadState().catch(() => ({}));
  const cachedPermission = normalizeViewerPermission(state?.currentPermission ?? state?.currentUserPermission);
  if (cachedPermission) return cachedPermission;
  const auth = await loadAuth().catch(() => null);
  const authPermission = normalizeViewerPermission(auth?.permission);
  if (authPermission) return authPermission;
  const me = await currentUserSummary().catch(() => null);
  return normalizeViewerPermission(me?.permission);
}

async function assertInternalViewer(kwargs = {}) {
  const permission = await resolveViewerPermission(kwargs);
  if (permission === '1') return;
  throw new Error('主体素材上传 / 发布命令仅对内部员工开放。');
}

async function fetchModelRowsByTaskType(taskType, taskPrompt = '', viewerPermission = null) {
  const payload = await apiFetch(`/api/resource/model/list/usage/${taskType}`, {
    body: { taskPrompt },
  }).catch(async () => apiFetch('/api/material/creation/model/listIgnoreDelete', {
    method: 'GET',
    query: { taskType: taskType === 'VIDEO_CREATE' ? 'VIDEO_GROUP' : taskType },
  }));
  return filterModelRows(normalizeModelRows(payload), { viewerPermission });
}

async function fetchRawModelDefinitionsByTaskType(taskType, taskPrompt = '') {
  const payload = await apiFetch(`/api/resource/model/list/usage/${taskType}`, {
    body: { taskPrompt },
  }).catch(async () => apiFetch('/api/material/creation/model/listIgnoreDelete', {
    method: 'GET',
    query: { taskType: taskType === 'VIDEO_CREATE' ? 'VIDEO_GROUP' : taskType },
  }));
  return firstArray(payload);
}

async function fetchResolvedModelDefinition(model, taskPrompt = '') {
  const kind = inferModelKind(model?.modelCode, model?.modelGroupCode);
  const taskType = normalizeTaskTypeFromKind(kind);
  if (!taskType) return null;
  const list = await fetchRawModelDefinitionsByTaskType(taskType, taskPrompt);
  return list.find((item) => normalizeCodeKey(item?.modelGroupCode) === normalizeCodeKey(model?.modelGroupCode))
    ?? list.find((item) => normalizeCodeKey(item?.modelCode) === normalizeCodeKey(model?.modelCode))
    ?? null;
}

function formatModelGroupChoices(rows = []) {
  return rows
    .map((item) => {
      const success = item?.successRatePct ? `, 成功率 ${item.successRatePct}` : '';
      const point = item?.pointNo != null ? `, 单价 ${item.pointNo}` : '';
      return `- ${item.modelGroupCode} (${item.modelName ?? item.modelCode}${success}${point})`;
    })
    .join('\n');
}

async function resolveModelSelection(kind, kwargs = {}) {
  const rawModelCode = String(kwargs.modelCode ?? '').trim();
  const rawModelGroupCode = String(kwargs.modelGroupCode ?? '').trim();

  if (!rawModelCode && !rawModelGroupCode) {
    throw new Error('缺少模型标识：至少提供 `--modelGroupCode`；也可提供 `--modelCode` 后再由 CLI 帮你定位可选分组。');
  }

  const externalAihubmixModel = kind === 'video' || kind === 'generic'
    ? (findAihubmixVideoModel(rawModelGroupCode) ?? findAihubmixVideoModel(rawModelCode))
    : null;
  if (externalAihubmixModel) {
    return {
      ...externalAihubmixModel,
      kind: 'video',
      provider: 'AiHubMix',
      externalProvider: 'aihubmix',
    };
  }

  const inferredKind = kind === 'generic' ? inferModelKind(rawModelCode, rawModelGroupCode) : kind;
  const viewerPermission = await resolveViewerPermission(kwargs);
  const taskTypes =
    inferredKind === 'generic'
      ? ['IMAGE_CREATE', 'VIDEO_CREATE']
      : [normalizeTaskTypeFromKind(inferredKind)];

  const rows = (await Promise.all(taskTypes.map((taskType) => fetchModelRowsByTaskType(taskType, '', viewerPermission))))
    .flat()
    .filter((item) => item?.modelCode && item?.modelGroupCode);

  if (rawModelCode && rawModelGroupCode) {
    const match = rows.find(
      (item) =>
        normalizeCodeKey(item.modelGroupCode) === normalizeCodeKey(rawModelGroupCode) &&
        normalizeCodeKey(item.modelCode) === normalizeCodeKey(rawModelCode),
    );
    if (!match) {
      throw new Error(`当前账号下未找到对应的模型: ${rawModelGroupCode}。可先执行 \`${runtimeCommandPrefix()} image-models\` 或 \`${runtimeCommandPrefix()} video-models\` 查看当前账号可用模型。`);
    }
    return {
      modelCode: match.modelCode,
      modelGroupCode: match.modelGroupCode,
      modelName: match.modelName ?? null,
      kind: inferredKind === 'generic' ? inferModelKind(match.modelCode, match.modelGroupCode) : inferredKind,
    };
  }

  if (rawModelGroupCode) {
    const match = rows.find((item) => normalizeCodeKey(item.modelGroupCode) === normalizeCodeKey(rawModelGroupCode));
    if (!match) {
      throw new Error(`当前账号下未找到对应的 modelGroupCode: ${rawModelGroupCode}。可先执行 \`${runtimeCommandPrefix()} image-models\` 或 \`${runtimeCommandPrefix()} video-models\` 查看。`);
    }
    return {
      modelCode: match.modelCode,
      modelGroupCode: match.modelGroupCode,
      modelName: match.modelName ?? null,
      kind: inferredKind === 'generic' ? inferModelKind(match.modelCode, match.modelGroupCode) : inferredKind,
    };
  }

  const matches = rows.filter((item) => normalizeCodeKey(item.modelCode) === normalizeCodeKey(rawModelCode));
  if (!matches.length) {
    const fuzzyMatches = rows.filter((item) => {
      const raw = normalizeCodeKey(rawModelCode);
      return normalizeCodeKey(item.modelCode).includes(raw) || normalizeCodeKey(item.modelName).includes(raw);
    });
    if (fuzzyMatches.length === 1) {
      const match = fuzzyMatches[0];
      return {
        modelCode: match.modelCode,
        modelGroupCode: match.modelGroupCode,
        modelName: match.modelName ?? null,
        kind: inferredKind === 'generic' ? inferModelKind(match.modelCode, match.modelGroupCode) : inferredKind,
      };
    }
    if (fuzzyMatches.length > 1) {
      throw new Error([
        `你传入的 \`modelCode\` 更像是模型族名或前缀：${rawModelCode}`,
        '当前账号下该模型存在多个可选分组，请补充 `--modelGroupCode`。',
        '可选分组:',
        formatModelGroupChoices(fuzzyMatches),
      ].join('\n'));
    }
    throw new Error(`当前账号下未找到对应的 modelCode: ${rawModelCode}。如果你记的是模型名，建议先执行 \`${runtimeCommandPrefix()} image-models --model "${rawModelCode}"\` 或直接改传 \`--modelGroupCode\`。`);
  }
  if (matches.length === 1) {
    const match = matches[0];
    return {
      modelCode: match.modelCode,
      modelGroupCode: match.modelGroupCode,
      modelName: match.modelName ?? null,
      kind: inferredKind === 'generic' ? inferModelKind(match.modelCode, match.modelGroupCode) : inferredKind,
    };
  }

  throw new Error([
    `模型 ${rawModelCode} 存在多个可选分组，请补充 \`--modelGroupCode\`。`,
    '可选分组:',
    formatModelGroupChoices(matches),
  ].join('\n'));
}

function modelParamExample(kind, paramKey, values = []) {
  const firstValue = values[0] ?? '<value>';
  if (paramKey === 'frames') {
    return '--frameFile ./frame.webp --frameText "镜头推进"';
  }
  if (paramKey === 'multi_param') {
    return '--refImageFiles "角色A=./char.webp"';
  }
  if (paramKey === 'multi_prompt') {
    return '--storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头"';
  }
  if (paramKey === 'generated_mode') {
    return `--generatedMode ${firstValue}`;
  }
  if (paramKey === 'iref') {
    return '--irefFiles ./ref.webp';
  }
  if (paramKey === 'cref') {
    return '--crefFiles ./char.png';
  }
  if (paramKey === 'sref') {
    return '--srefFiles ./style.png';
  }
  if (paramKey === 'prompt') {
    return '--prompt "一个赛博朋克少女，霓虹街头，电影感"';
  }
  if (kind === 'image' && paramKey === 'generate_num') {
    return `--generateNum ${firstValue}`;
  }
  if (kind === 'image' && paramKey === 'direct_generate_num') {
    return `--directGenerateNum ${firstValue}`;
  }
  if (kind === 'video' && paramKey === 'generated_time') {
    return `--generatedTime ${firstValue}`;
  }
  return `${toCliFlag(paramKey)} ${firstValue}`;
}

function parseStructuredValue(value) {
  if (value == null || value === '') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeModelParamDefs(item) {
  const containers = [
    item?.modelParams,
    item?.paramDefinition,
    item?.modelParamList,
    item?.paramConfigList,
    item?.paramList,
    item?.params,
    item?.modelConfig?.modelParams,
    item?.modelConfig?.paramDefinition,
    item?.modelConfig?.modelParamList,
  ];
  for (const candidate of containers) {
    const rows = parseModelParamDefs(candidate);
    if (rows.length) return rows;
  }
  return [];
}

function parseModelParamDefs(value) {
  const normalized = parseStructuredValue(value);
  if (!normalized) return [];
  if (Array.isArray(normalized)) {
    return normalized
      .map((item) => normalizeModelParamDef(item))
      .filter(Boolean);
  }
  if (typeof normalized === 'object') {
    for (const key of ['modelParams', 'paramDefinition', 'modelParamList', 'paramConfigList', 'paramList', 'list', 'rows', 'data']) {
      if (!(key in normalized)) continue;
      const rows = parseModelParamDefs(normalized[key]);
      if (rows.length) return rows;
    }
    const option = normalizeModelParamDef(normalized);
    return option ? [option] : [];
  }
  return [];
}

function normalizeModelParamDef(value) {
  const item = parseStructuredValue(value);
  if (!item || typeof item !== 'object') return null;
  const paramKey = item?.paramKey ?? item?.key ?? item?.code ?? null;
  if (!paramKey) return null;
  return {
    ...item,
    paramKey,
    paramName: item?.paramName ?? item?.name ?? item?.label ?? null,
    paramType: item?.paramType ?? item?.type ?? null,
    optionList: parseOptionList(item?.optionList ?? item?.options ?? item?.enumList),
    rules: parseStructuredValue(item?.rules) ?? item?.rules ?? {},
  };
}

function buildModelParamMap(paramDefs = []) {
  return new Map(
    paramDefs
      .filter((item) => item?.paramKey)
      .map((item) => [String(item.paramKey), item]),
  );
}

function modelParamRules(option) {
  const rules = parseStructuredValue(option?.rules);
  return rules && typeof rules === 'object' && !Array.isArray(rules) ? rules : {};
}

function modelParamValues(paramMap, paramKey) {
  const option = paramMap.get(paramKey);
  return option ? optionValues(option) : [];
}

function summarizeImageReferenceFeature(paramMap) {
  const parts = ['iref', 'cref', 'sref'].filter((key) => paramMap.has(key));
  return parts.length ? parts.join('+') : '无';
}

function extractReferenceKinds(paramMap) {
  if (!paramMap.has('multi_param')) return [];
  const option = paramMap.get('multi_param');
  const rules = modelParamRules(option);
  const rawKinds = [
    ...(Array.isArray(rules?.resources) ? rules.resources.map((item) => item?.mediaType ?? item?.type ?? null) : []),
    ...(Array.isArray(rules?.resourceTypes) ? rules.resourceTypes : []),
    ...(Array.isArray(rules?.resourceTypeList) ? rules.resourceTypeList : []),
    ...(Array.isArray(rules?.referenceTypes) ? rules.referenceTypes : []),
    ...(Array.isArray(rules?.allowReferenceTypes) ? rules.allowReferenceTypes : []),
    ...parseOptionList(option?.optionList)
      .map((item) => item?.resourceType ?? item?.type ?? item?.value ?? item?.enumValue ?? null),
  ];
  const normalized = rawKinds
    .map((item) => trimToNull(item))
    .filter(Boolean)
    .map((item) => String(item).toUpperCase());
  return [...new Set(normalized)];
}

function summarizeVideoFrameFeature(paramMap) {
  const frames = paramMap.get('frames');
  if (!frames) return '无';
  const rules = modelParamRules(frames);
  const maxFrameNum = toNumberOrNull(rules?.maxFrameNum ?? frames?.maxFrameNum);
  const minFrameNum = toNumberOrNull(rules?.minFrameNum ?? frames?.minFrameNum);
  const required = rules?.required === true || frames?.required === true;
  const supportLastFrame = rules?.supportLastFrame === true || frames?.supportLastFrame === true;
  let label = '帧输入';
  if (maxFrameNum != null) {
    if (maxFrameNum >= 3) label = '多帧';
    else if (maxFrameNum >= 2) label = required || (minFrameNum != null && minFrameNum >= 1) ? '首尾帧' : '可首尾';
    else if (maxFrameNum === 1) label = required || (minFrameNum != null && minFrameNum >= 1) ? '仅首帧' : '可首帧';
  }
  if (supportLastFrame) {
    return `${label}+单尾`;
  }
  return label;
}

function summarizeVideoReferenceFeature(paramMap) {
  if (!paramMap.has('multi_param')) return '无';
  const kinds = extractReferenceKinds(paramMap);
  if (!kinds.length) return '多参考';
  const orderedKinds = ['IMAGE', 'VIDEO', 'AUDIO']
    .filter((item) => kinds.includes(item))
    .map((item) => ({ IMAGE: '图', VIDEO: '视频', AUDIO: '音频' })[item]);
  return orderedKinds.length ? orderedKinds.join('/') : '多参考';
}

function summarizeExtraModelFeatures(item, kind, paramMap) {
  const extras = [];
  if (kind === 'video') {
    const generatedModes = modelParamValues(paramMap, 'generated_mode');
    if (generatedModes.includes('multi_prompt') || paramMap.has('multi_prompt')) {
      extras.push('故事板');
    }
    if (paramMap.has('audio') || paramMap.has('need_audio') || paramMap.has('needAudio')) {
      extras.push('音效开关');
    }
  }
  const feeCalcType = trimToNull(item?.feeCalcType ?? item?.feeType);
  if (feeCalcType === 'VIDEO_TOKEN') {
    extras.push('Token计费');
  }
  return extras.join(' | ') || null;
}

function summarizeModelFeatureText(kind, features = {}) {
  const parts = [];
  if (kind === 'image' && features.imageRefFeature) {
    parts.push(`参考图:${features.imageRefFeature}`);
  }
  if (kind === 'video' && features.videoFrameFeature) {
    parts.push(`帧:${features.videoFrameFeature}`);
  }
  if (kind === 'video' && features.videoReferenceFeature) {
    parts.push(`参考:${features.videoReferenceFeature}`);
  }
  if (features.extraFeatures) {
    parts.push(features.extraFeatures);
  }
  return parts.join('；') || null;
}

function mergeModelOptionDef(option, ruleSourceMap) {
  if (!option?.paramKey) return option;
  const source = ruleSourceMap.get(String(option.paramKey));
  if (!source) return option;
  return {
    ...source,
    ...option,
    paramKey: option?.paramKey ?? source?.paramKey ?? null,
    paramName: option?.paramName ?? source?.paramName ?? null,
    paramType: option?.paramType ?? source?.paramType ?? null,
    optionList: option?.optionList?.length ? option.optionList : source?.optionList ?? [],
    rules:
      Object.keys(modelParamRules(option)).length
        ? modelParamRules(option)
        : modelParamRules(source),
  };
}

function summarizeModelOptionConstraint(option) {
  const rules = modelParamRules(option);
  const values = optionValues(option);
  const parts = [];

  if (option?.paramType === 'EnumType' && values.length) {
    parts.push(`可选: ${values.join(' / ')}`);
  }
  if (option?.paramType === 'Prompt') {
    const maxValue = toNumberOrNull(rules?.maxValue);
    if (maxValue != null) parts.push(`最长 ${maxValue} 字`);
  }
  if (option?.paramType === 'FrameListType') {
    const minCount = toNumberOrNull(rules?.minFrameNum);
    const maxCount = toNumberOrNull(rules?.maxFrameNum);
    if (minCount != null || maxCount != null) {
      if (minCount != null && maxCount != null && minCount === maxCount) parts.push(`${minCount} 帧`);
      else if (minCount != null && maxCount != null) parts.push(`${minCount}-${maxCount} 帧`);
      else if (maxCount != null) parts.push(`最多 ${maxCount} 帧`);
    }
    if (rules?.supportLastFrame === true) parts.push('支持单独尾帧');
    const types = Array.isArray(rules?.supportedFileTypes) ? rules.supportedFileTypes : [];
    if (types.length) parts.push(`格式: ${types.join(', ')}`);
    if (rules?.required === true) parts.push('必填');
  }
  if (option?.paramType === 'FileListType') {
    const minCount = toNumberOrNull(rules?.fileListMinNum ?? rules?.minNum);
    const maxCount = toNumberOrNull(rules?.fileListMaxNum ?? rules?.maxNum);
    if (minCount != null || maxCount != null) {
      if (minCount != null && maxCount != null && minCount === maxCount) parts.push(`${minCount} 个`);
      else if (minCount != null && maxCount != null) parts.push(`${minCount}-${maxCount} 个`);
      else if (maxCount != null) parts.push(`最多 ${maxCount} 个`);
    }
    const types = Array.isArray(rules?.supportedFileTypes) ? rules.supportedFileTypes : [];
    if (types.length) parts.push(`格式: ${types.join(', ')}`);
    if (rules?.required === true) parts.push('必填');
  }
  if (option?.paramKey === 'multi_param' || option?.paramType === 'MultiParamType') {
    const totalMax = toNumberOrNull(rules?.fileListMaxNum);
    if (totalMax != null) parts.push(`总参考最多 ${totalMax} 个`);
    for (const resource of Array.isArray(rules?.resources) ? rules.resources : []) {
      const mediaType = trimToNull(resource?.mediaType ?? resource?.type);
      if (!mediaType) continue;
      const label = {
        IMAGE: '图片',
        VIDEO: '视频',
        AUDIO: '音频',
        SUBJECT: '主体',
      }[String(mediaType).toUpperCase()] ?? String(mediaType).toUpperCase();
      const maxCount = toNumberOrNull(resource?.fileListMaxNum);
      const types = Array.isArray(resource?.supportedFileTypes) ? resource.supportedFileTypes.join(', ') : '';
      let segment = label;
      if (maxCount != null) segment += `≤${maxCount}`;
      if (types) segment += ` (${types})`;
      parts.push(segment);
    }
    if (rules?.required === true) parts.push('必填');
  }
  if (option?.paramKey === 'multi_prompt' || option?.paramType === 'MultiPromptType') {
    parts.push('故事板模式专用');
  }
  return parts.join('；');
}

function normalizeModelOptionRows(payload, kind = 'generic', modelDefinition = null) {
  const ruleSourceMap = buildModelParamMap(normalizeModelParamDefs(modelDefinition));
  return firstArray(payload)
    .map((item) => {
      const merged = mergeModelOptionDef(item, ruleSourceMap);
      const values = optionValues(merged);
      return {
        rank: merged?.rank ?? null,
        paramKey: merged?.paramKey ?? null,
        paramName: merged?.paramName ?? null,
        paramType: merged?.paramType ?? null,
        cliFlag: modelParamExample(kind, merged?.paramKey ?? '', values),
        allowedValues: values.join(', '),
        底层参数: merged?.paramKey ?? null,
        名称: merged?.paramName ?? null,
        类型: merged?.paramType ?? null,
        约束: summarizeModelOptionConstraint(merged),
        推荐CLI用法: modelParamExample(kind, merged?.paramKey ?? '', values),
        raw: JSON.stringify(merged),
      };
    })
    .sort((left, right) => toInt(left?.rank, 0) - toInt(right?.rank, 0));
}

function ensureRequiredArgs(commandName, kwargs, specs) {
  const missing = specs.filter((item) => {
    const value = kwargs?.[item.key];
    return value == null || String(value).trim() === '';
  });
  if (!missing.length) return;

  const lines = [`缺少必要参数：${commandName}`];
  for (const item of missing) {
    lines.push(`- ${item.key}: ${item.help}`);
  }
  if (kwargs?.modelCode && kwargs?.modelGroupCode) {
    lines.push(
      `可先查看模型参数: ${runtimeCommandPrefix()} model-options --modelCode ${kwargs.modelCode} --modelGroupCode ${kwargs.modelGroupCode}`,
    );
  } else {
    lines.push(`可先执行 ${runtimeCommandPrefix()} image-models 或 ${runtimeCommandPrefix()} video-models 选择模型。`);
  }
  throw new Error(lines.join('\n'));
}

function ensureModelSelector(commandName, kwargs) {
  const hasModelCode = kwargs?.modelCode != null && String(kwargs.modelCode).trim() !== '';
  const hasModelGroupCode = kwargs?.modelGroupCode != null && String(kwargs.modelGroupCode).trim() !== '';
  if (hasModelCode || hasModelGroupCode) return;
  throw new Error([
    `缺少必要参数：${commandName}`,
    '- 至少提供一个模型标识：`--modelGroupCode` 或 `--modelCode`',
    '- 推荐优先提供 `--modelGroupCode`，因为它在平台里是唯一的',
    `可先执行 ${runtimeCommandPrefix()} image-models 或 ${runtimeCommandPrefix()} video-models 查看。`,
  ].join('\n'));
}

async function fetchModelOptionDefs(modelCode, modelGroupCode, selectedConfigs = {}) {
  const modelDefinition = await fetchResolvedModelDefinition(
    { modelCode, modelGroupCode },
    trimToNull(selectedConfigs?.taskPrompt) ?? trimToNull(selectedConfigs?.prompt) ?? '',
  );
  const ruleSourceMap = buildModelParamMap(normalizeModelParamDefs(modelDefinition));
  const payload = await apiFetch('/api/resource/model/config/options', {
    body: {
      modelCode,
      modelGroupCode,
      selectedConfigs,
    },
  });
  return firstArray(payload)
    .map((item) => ({
      ...mergeModelOptionDef({
        ...item,
        optionList: parseOptionList(item?.optionList),
      }, ruleSourceMap),
    }))
    .sort((left, right) => toInt(left?.rank, 0) - toInt(right?.rank, 0));
}

async function validateModelPromptParams(kind, kwargs, promptParams, source = promptParams) {
  const optionDefs = await fetchModelOptionDefs(kwargs.modelCode, kwargs.modelGroupCode, promptParams);
  const missing = [];
  const invalid = [];
  const generatedMode = trimToNull(source?.generated_mode ?? promptParams?.generated_mode);

  for (const option of optionDefs) {
    if (!shouldValidateModelOption(option)) continue;
    const paramKey = option?.paramKey;
    if (!paramKey) continue;
    if (
      kind === 'video' &&
      paramKey === 'frames' &&
      generatedMode &&
      generatedMode !== 'frames'
    ) {
      continue;
    }
    const currentValue = source?.[paramKey];
    const values = optionValues(option);
    if (option?.paramType === 'EnumType' && values.length) {
      const exists = hasPromptParamValue(currentValue);
      if (!exists) {
        missing.push({
          paramKey,
          paramName: option?.paramName ?? null,
          values,
        });
        continue;
      }
      const normalizedValue = String(currentValue).trim();
      if (!values.includes(normalizedValue)) {
        invalid.push({
          paramKey,
          paramName: option?.paramName ?? null,
          value: normalizedValue,
          values,
        });
      }
      continue;
    }

    const constraintError =
      option?.paramType === 'FrameListType' ? validateFrameListOption(option, currentValue, kind)
        : paramKey === 'multi_param' ? validateMultiParamOption(option, currentValue, kind)
          : option?.paramType === 'FileListType' ? validateFileListOption(option, currentValue, kind)
            : option?.paramType === 'MultiPromptType' || paramKey === 'multi_prompt'
              ? validateMultiPromptOption(option, currentValue, kind, generatedMode)
              : null;

    if (constraintError?.type === 'missing') {
      missing.push({
        paramKey,
        paramName: option?.paramName ?? null,
        detail: constraintError.detail,
      });
      continue;
    }
    if (constraintError?.type === 'invalid') {
      invalid.push({
        paramKey,
        paramName: option?.paramName ?? null,
        detail: constraintError.detail,
      });
    }
  }

  if (!missing.length && !invalid.length) {
    return optionDefs;
  }

  const lines = [`模型参数校验失败：${kwargs.modelCode}`];
  for (const item of missing) {
    const label = item.paramName ? `${item.paramKey}（${item.paramName}）` : item.paramKey;
    const valuesText = item.values?.length ? `；可选值: ${item.values.join(', ')}` : '';
    lines.push(`- 缺少 ${label}；请补充 ${item.detail ?? modelParamExample(kind, item.paramKey, item.values ?? [])}${valuesText}`);
  }
  for (const item of invalid) {
    const label = item.paramName ? `${item.paramKey}（${item.paramName}）` : item.paramKey;
    if (item.detail) {
      lines.push(`- ${label} 校验失败：${item.detail}`);
      continue;
    }
    lines.push(`- ${label} 的值无效: ${item.value}；可选值: ${item.values.join(', ')}；示例: ${modelParamExample(kind, item.paramKey, item.values)}`);
  }
  lines.push(
    `可先查看当前模型参数: ${runtimeCommandPrefix()} model-options --modelCode ${kwargs.modelCode} --modelGroupCode ${kwargs.modelGroupCode}`,
  );
  throw new Error(lines.join('\n'));
}

function normalizeModelRows(payload) {
  const list = firstArray(payload);
  return list.map((item) => {
    const ext = parseStructuredValue(item?.modelExtInfo) ?? {};
    const displayScopes = parseModelDisplayScopes(item?.display);
    const modelCode = item?.modelCode ?? item?.code ?? item?.value ?? null;
    const modelGroupCode =
      item?.modelGroupCode ??
      item?.groupCode ??
      item?.modelGroup?.modelGroupCode ??
      item?.modelGroup?.code ??
      null;
    const kind = inferModelKind(modelCode, modelGroupCode);
    const paramDefs = normalizeModelParamDefs(item);
    const paramMap = buildModelParamMap(paramDefs);
    const imageRefFeature = kind === 'image' ? summarizeImageReferenceFeature(paramMap) : null;
    const videoFrameFeature = kind === 'video' ? summarizeVideoFrameFeature(paramMap) : null;
    const videoReferenceFeature = kind === 'video' ? summarizeVideoReferenceFeature(paramMap) : null;
    const extraFeatures = summarizeExtraModelFeatures(item, kind, paramMap);
    const frameOption = paramMap.get('frames');
    const frameRules = modelParamRules(frameOption);
    const supportsPromptOnly =
      kind === 'video'
        ? (!frameOption || ((frameRules?.required !== true && frameOption?.required !== true) && ((toNumberOrNull(frameRules?.minFrameNum) ?? 0) <= 0)))
        : false;
    const featureSummary = summarizeModelFeatureText(kind, {
      imageRefFeature,
      videoFrameFeature,
      videoReferenceFeature,
      extraFeatures,
    });
    return {
      modelCode,
      modelGroupCode,
      modelName: item?.modelName ?? item?.name ?? item?.label ?? null,
      provider: item?.provider ?? item?.vendor ?? item?.supplier ?? item?.componyName ?? null,
      groupHint:
        modelGroupCode && /OFFICIAL/i.test(modelGroupCode) ? '官方'
          : modelGroupCode && /DISCOUNT/i.test(modelGroupCode) ? '折扣'
            : modelGroupCode && /LOW_PRICE|LOWPRICE/i.test(modelGroupCode) ? '低价'
              : modelGroupCode && /FAST/i.test(modelGroupCode) ? '快速'
                : '默认',
      enabled: item?.enabled ?? item?.available ?? item?.status ?? null,
      modelStatus: item?.modelStatus ?? null,
      pointNo: item?.pointNo ?? null,
      taskQueueNum: item?.taskQueueNum ?? null,
      successRate: toNumberOrNull(ext?.success_rate),
      successRatePct: formatSuccessRate(ext?.success_rate),
      successCount: ext?.success_cnt ?? null,
      failCount: ext?.fail_cnt ?? null,
      totalSuccessCount: ext?.total_success_cnt ?? null,
      totalFailCount: ext?.total_fail_cnt ?? null,
      refFeature: kind === 'image' ? imageRefFeature : videoReferenceFeature,
      frameFeature: kind === 'video' ? videoFrameFeature : null,
      extraFeatures,
      supportsPromptOnly,
      featureSummary,
      feeCalcType: item?.feeCalcType ?? item?.feeType ?? null,
      displayScope: displayScopes.join(','),
      paramKeys: paramDefs.map((option) => option.paramKey).filter(Boolean).join(','),
      模型: item?.modelName ?? item?.name ?? item?.label ?? null,
      提供方: item?.provider ?? item?.vendor ?? item?.supplier ?? item?.componyName ?? null,
      参考图: kind === 'image' ? imageRefFeature : null,
      帧模式: kind === 'video' ? videoFrameFeature : null,
      参考模式: kind === 'video' ? videoReferenceFeature : null,
      特色能力: extraFeatures,
      通道:
        modelGroupCode && /OFFICIAL/i.test(modelGroupCode) ? '官方'
          : modelGroupCode && /DISCOUNT/i.test(modelGroupCode) ? '折扣'
            : modelGroupCode && /LOW_PRICE|LOWPRICE/i.test(modelGroupCode) ? '低价'
              : modelGroupCode && /FAST/i.test(modelGroupCode) ? '快速'
                : '默认',
      模型组: modelGroupCode,
      成功率: formatSuccessRate(ext?.success_rate),
      raw: JSON.stringify(sanitizeModelRawRecord(item)),
    };
  });
}

function sanitizeModelRawRecord(item = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
  const {
    modelUseScene: _modelUseScene,
    modelUseScenes: _modelUseScenes,
    useScene: _useScene,
    sceneBlackList: _sceneBlackList,
    sceneBlacklist: _sceneBlacklist,
    blackList: _blackList,
    blacklist: _blacklist,
    ...rest
  } = item;
  return rest;
}

function videoModelSupportsPromptOnly(modelRow) {
  return modelRow?.supportsPromptOnly === true;
}

function buildModelPreviewCommand(kind, modelRow) {
  const groupCode = modelRow?.modelGroupCode ?? '<modelGroupCode>';
  if (kind === 'image') {
    if (String(modelRow?.refFeature ?? '').includes('iref')) {
      return `${runtimeCommandPrefix()} image-create --modelGroupCode ${groupCode} --prompt "参考图里的角色在雨夜奔跑" --quality <quality> --ratio <ratio> --generateNum 1 --irefFiles "./a.webp" --dryRun true`;
    }
    return `${runtimeCommandPrefix()} image-create --modelGroupCode ${groupCode} --prompt "一只小狗" --quality <quality> --ratio <ratio> --generateNum 1 --dryRun true`;
  }

  if (videoModelSupportsPromptOnly(modelRow)) {
    return `${runtimeCommandPrefix()} video-create --modelGroupCode ${groupCode} --prompt "雨夜街头，人物缓慢走向镜头，电影感" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`;
  }
  if (trimToNull(modelRow?.['参考模式'])) {
    return `${runtimeCommandPrefix()} video-create --modelGroupCode ${groupCode} --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`;
  }
  return `${runtimeCommandPrefix()} video-create --modelGroupCode ${groupCode} --frameFile ./frame.webp --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`;
}

function filterModelRows(rows, kwargs = {}) {
  const keyword = String(kwargs.model ?? kwargs.keyword ?? '').trim().toLowerCase();
  const provider = String(kwargs.provider ?? '').trim().toLowerCase();
  const viewerPermission = normalizeViewerPermission(kwargs.viewerPermission ?? kwargs.permission);
  return rows.filter((item) => {
    const displayScopes = parseModelDisplayScopes(item?.displayScope ?? item?.display ?? '');
    if (!isModelVisibleForPermission(displayScopes, viewerPermission)) {
      return false;
    }
    if (provider && !String(item?.provider ?? '').toLowerCase().includes(provider)) {
      return false;
    }
    if (!keyword) return true;
    return [
      item?.modelName,
      item?.modelCode,
      item?.modelGroupCode,
      item?.provider,
      item?.refFeature,
      item?.frameFeature,
      item?.extraFeatures,
      item?.featureSummary,
      item?.paramKeys,
    ]
      .map((value) => String(value ?? '').toLowerCase())
      .some((value) => value.includes(keyword));
  });
}

function normalizeTaskRows(payload) {
  const list = firstArray(payload);
  return list.map((item) => {
    const resultFileList = Array.isArray(item?.resultFileList) ? item.resultFileList : [];
    const resultFileDisplayList = Array.isArray(item?.resultFileDisplayList) ? item.resultFileDisplayList : [];
    const createdAt =
      item?.gmtCreate ??
      item?.createTime ??
      item?.createdAt ??
      item?.createdTime ??
      item?.taskCreateTime ??
      null;
    const modifiedAt =
      item?.gmtModified ??
      item?.updateTime ??
      item?.updatedAt ??
      item?.modifiedAt ??
      item?.taskUpdateTime ??
      null;
    const taskStatus = item?.taskStatus ?? item?.status ?? null;
    return {
      taskId: item?.taskId ?? null,
      taskType: item?.taskType ?? null,
      taskStatus,
      modelName: item?.modelName ?? null,
      modelGroupCode: item?.modelGroupCode ?? null,
      handlerCode: item?.handlerCode ?? null,
      pointNo: item?.pointNo ?? null,
      gmtCreate: createdAt,
      gmtModified: modifiedAt,
      taskPrompt: item?.taskPrompt ?? null,
      resultCount: Math.max(resultFileList.length, resultFileDisplayList.length),
      firstResultUrl: resultFileDisplayList[0] ?? resultFileList[0] ?? null,
      resultFileList: JSON.stringify(resultFileList),
      resultFileDisplayList: JSON.stringify(resultFileDisplayList),
      errorMsg: item?.errorMsg ?? item?.resultMsg ?? null,
      isTerminal: TERMINAL_TASK_STATES.has(String(taskStatus ?? '').trim().toUpperCase()),
      raw: JSON.stringify(item),
    };
  });
}

function normalizeProjectGroupRecord(item, selectedProjectGroupNo) {
  const projectGroupNo = item?.projectGroupNo ?? item?.no ?? null;
  return {
    projectGroupNo,
    projectGroupName: item?.projectGroupName ?? item?.name ?? null,
    isSelected: projectGroupNo === selectedProjectGroupNo,
    raw: JSON.stringify(item),
  };
}

async function getProjectGroupsPayload() {
  const [listPayload, lastPayload] = await Promise.all([
    apiFetch('/api/anime/workbench/projectGroup/getProjectGroup', { method: 'GET' }),
    apiFetch('/api/anime/workbench/projectGroup/getLastProjectGroup', { method: 'GET' }).catch(() => null),
  ]);
  const lastProjectGroupNo =
    (typeof lastPayload === 'string' ? lastPayload : null) ??
    lastPayload?.projectGroupNo ??
    lastPayload?.lastProjectGroupNo ??
    lastPayload?.projectGroup?.projectGroupNo ??
    null;
  return {
    list: firstArray(listPayload),
    lastProjectGroupNo,
  };
}

async function fetchProjectGroupSummary(projectGroupNo) {
  const actualProjectGroupNo = await resolveProjectGroupNo(projectGroupNo);
  const [{ list, lastProjectGroupNo }, pointInfo] = await Promise.all([
    getProjectGroupsPayload(),
    apiFetch('/api/anime/workbench/projectGroup/getProjectGroupIntegral', {
      body: { projectGroupNo: actualProjectGroupNo },
    }),
  ]);
  const projectGroup = list.find(
    (item) => (item?.projectGroupNo ?? item?.no ?? null) === actualProjectGroupNo,
  );
  const summary = {
    projectGroupNo: actualProjectGroupNo,
    projectGroupName: projectGroup?.projectGroupName ?? projectGroup?.name ?? null,
    isLastSelected: actualProjectGroupNo === lastProjectGroupNo,
    pointBalance: extractPointBalance(pointInfo),
    projectGroupIntegralCurrent: pointInfo?.projectGroupIntegralCurrent ?? null,
    projectGroupIntegralMax: pointInfo?.projectGroupIntegralMax ?? null,
    personIntegralCurrent: pointInfo?.personIntegralCurrent ?? null,
    personIntegralMax: pointInfo?.personIntegralMax ?? null,
    teamIntegral: pointInfo?.teamIntegral ?? null,
    raw: JSON.stringify({
      projectGroup,
      integral: pointInfo,
    }),
  };
  await saveState({
    currentProjectGroupNo: summary.projectGroupNo,
    currentProjectGroupName: summary.projectGroupName,
  });
  return summary;
}

async function currentUserSummary() {
  await ensureAuth();
  const [userInfo, groupPoint, teams, projectGroupSummary] = await Promise.all([
    apiFetch('/api/anime/user/account/userInfo', { body: {} }),
    apiFetch('/api/anime/member/benefits/queryGroupPoint', { body: {} }),
    apiFetch('/api/anime/user/group/getOwnGroupList', { body: {} }).catch(() => []),
    fetchProjectGroupSummary().catch(() => null),
  ]);
  const auth = await loadAuth();
  const currentTeam = Array.isArray(teams)
    ? teams.find((item) => Number(item?.currentGroup) === 1)
    : null;

  const summary = {
    userId: userInfo?.userId ?? userInfo?.id ?? null,
    userName: userInfo?.userName ?? userInfo?.nickName ?? null,
    phone: userInfo?.phone ?? null,
    permission: userInfo?.permission ?? null,
    permissionLabel: permissionLabel(userInfo?.permission),
    permissionDisplay: permissionDisplay(userInfo?.permission),
    currentGroupId: userInfo?.groupId ?? currentTeam?.groupId ?? null,
    currentGroupName: userInfo?.groupName ?? currentTeam?.groupName ?? null,
    currentProjectGroupNo: projectGroupSummary?.projectGroupNo ?? null,
    currentProjectGroupName: projectGroupSummary?.projectGroupName ?? null,
    pointBalance: extractPointBalance(groupPoint),
    teamPointBalance: extractPointBalance(groupPoint),
    projectPointBalance: projectGroupSummary?.projectGroupIntegralCurrent ?? null,
    projectPointMax: projectGroupSummary?.projectGroupIntegralMax ?? null,
    authExpiresAt: auth?.expiresAt ?? null,
  };
  await saveState({
    currentUserId: summary.userId,
    currentUserName: summary.userName,
    currentPermission: summary.permission,
    currentPermissionLabel: summary.permissionLabel,
    currentGroupId: summary.currentGroupId,
    currentGroupName: summary.currentGroupName,
    currentProjectGroupNo: summary.currentProjectGroupNo,
    currentProjectGroupName: summary.currentProjectGroupName,
  });
  return summary;
}

function presentCurrentUserSummary(summary) {
  return {
    ...summary,
    用户名: summary.userName ?? null,
    权限: summary.permissionDisplay ?? permissionDisplay(summary.permission),
    当前团队: summary.currentGroupName ?? null,
    当前项目组: summary.currentProjectGroupName ?? null,
    团队积分: summary.teamPointBalance ?? null,
    项目组积分: summary.projectPointBalance ?? null,
    登录有效期: formatDateTime(summary.authExpiresAt),
  };
}

function presentAuthClearResult(result) {
  return withAliases(result, {
    cleared: '已清空',
  });
}

function presentAuthStatus(summary) {
  return withAliases(
    {
      ...summary,
      authTypeText: summary?.authType ?? null,
      accessKeySourceText: accessKeySourceLabel(summary?.accessKeySource, summary?.accessKeySourceName),
      expiresAtText: formatDateTime(summary?.expiresAt),
      updatedAtText: formatDateTime(summary?.updatedAt),
    },
    {
      loginState: '登录状态',
      authTypeText: '认证方式',
      hasAccessKey: '有AccessKey',
      accessKeyPreview: 'AccessKey',
      accessKeySourceText: 'AccessKey来源',
      hasToken: '有令牌',
      hasRefreshToken: '有续期令牌',
      expiresAtText: '过期时间',
      lastAuthError: '失效原因',
      updatedAtText: '更新时间',
    },
  );
}

function presentLoginResult(result) {
  return withAliases(result, {
    status: '状态',
    loginMethod: '登录方式',
    needsBind: '需绑定手机号',
    currentGroupName: '当前团队',
    groupCount: '团队数',
  });
}

function presentLoginKeyResult(result) {
  return withAliases(result, {
    status: '状态',
    loginMethod: '登录方式',
    saved: '已保存',
    verified: '已验证',
    accessKeyPreview: 'AccessKey',
    accessKeySourceText: '来源',
    userId: '用户ID',
    userName: '用户名',
  });
}

function presentTeamRows(rows) {
  return withAliasesRows(rows, {
    groupId: '团队ID',
    groupName: '团队名称',
    relationType: '关系类型',
    currentGroup: '当前选中',
  });
}

function presentProjectGroupSummary(summary) {
  return withAliases(summary, {
    projectGroupNo: '项目组编号',
    projectGroupName: '项目组名称',
    pointBalance: '项目组余额',
    projectGroupIntegralMax: '项目组上限',
    memberCount: '成员数',
    updated: '已更新',
  });
}

function presentProjectGroupRows(rows) {
  return withAliasesRows(rows, {
    projectGroupNo: '项目组编号',
    projectGroupName: '项目组名称',
    isSelected: '当前选中',
    isLastSelected: '最近使用',
  });
}

function presentProjectGroupUserRows(rows) {
  return withAliasesRows(rows, {
    userId: '用户ID',
    userName: '用户名',
    role: '角色',
    isCheck: '已选中',
  });
}

function presentPointSummary(summary) {
  return withAliases(summary, {
    teamPointBalance: '团队积分',
    projectPointBalance: '项目组积分',
    projectPointMax: '项目组上限',
    currentProjectGroupName: '当前项目组',
  });
}

function presentPointPackageRows(rows) {
  return withAliasesRows(rows, {
    packageNo: '套餐编号',
    title: '套餐名称',
    payType: '支付方式',
    priceYuan: '价格(元)',
    integralValue: '积分',
    tag: '标签',
    source: '来源',
  });
}

function presentPointRecordRows(rows) {
  return withAliasesRows(rows, {
    operationText: '类型',
    title: '标题',
    point: '积分',
    operationTime: '时间',
    source: '来源',
  });
}

function presentUsageSummary(summary) {
  return withAliases(summary, {
    projectGroupName: '项目组',
    sinceText: '开始时间',
    currentProjectPointBalance: '当前项目组积分',
    estimatedConsumedPoints: '消耗积分',
    consumedProjectPoints: '余额消耗',
    projectPointBalanceDelta: '余额变化消耗',
    balanceIncreasedPoints: '余额增加',
    taskPointTotal: '任务积分合计',
    imageTaskCount: '图片任务',
    imageResultCount: '图片结果',
    imagePointTotal: '图片积分',
    videoTaskCount: '视频任务',
    videoResultCount: '视频结果',
    videoPointTotal: '视频积分',
    estimatedCostYuan: '消耗金额(元)',
    imageCostYuan: '图片金额(元)',
    videoCostYuan: '视频金额(元)',
    unattributedPointTotal: '未归因积分',
    unattributedCostYuan: '未归因金额(元)',
  });
}

function presentPointOrder(result) {
  return withAliases(result, {
    packageNo: '套餐编号',
    rechargeNo: '订单号',
    payStatus: '支付状态码',
    payStatusText: '支付状态',
    expireTime: '过期时间',
    timedOut: '是否超时',
  });
}

function presentInvoiceApplyResult(result) {
  return withAliases(result, {
    applied: '已提交',
    invoiceType: '发票类型',
    subjectType: '主体类型',
    amountYuan: '金额(元)',
    buyerName: '购买方名称',
    proofFileName: '凭证文件名',
    proofFileToken: '凭证文件Token',
  });
}

function presentRedeemResult(result) {
  return withAliases(result, {
    redeemed: '已兑换',
    code: '兑换码',
    teamPointBalance: '团队积分',
  });
}

function taskTypeLabel(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return {
    IMAGE_CREATE: '生图',
    VIDEO_CREATE: '生视频',
    VIDEO_GROUP: '生视频',
    IMAGE_EDIT: '图片编辑',
  }[normalized] ?? value;
}

function taskStatusLabel(value) {
  const normalized = String(value ?? '').trim().toUpperCase();
  return {
    CREATED: '已创建',
    PENDING: '排队中',
    QUEUING: '排队中',
    PROCESSING: '处理中',
    RUNNING: '处理中',
    SUCCESS: '成功',
    COMPLETED: '成功',
    DONE: '成功',
    SUCCEEDED: '成功',
    FAILED: '失败',
    FAIL: '失败',
    CANCELED: '已取消',
    CANCELLED: '已取消',
    TIMEOUT: '超时',
  }[normalized] ?? value;
}

function buildUploadReuseHint(item) {
  const backendPath = trimToNull(item?.backendPath);
  if (!backendPath) return null;
  const sceneType = trimToNull(item?.sceneType);
  const mimeType = String(item?.mimeType ?? '').toLowerCase();
  const stem = trimToNull(path.parse(String(item?.fileName ?? '')).name)?.replace(/[^0-9A-Za-z_\-一-龥]+/g, '_') || '素材A';

  if (sceneType === TASK_UPLOAD_SCENE.IMAGE_CREATE && mimeType.startsWith('image/')) {
    return `--iref "${backendPath}"`;
  }
  if (sceneType === TASK_UPLOAD_SCENE.VIDEO_CREATE) {
    if (mimeType.startsWith('image/')) return `--refImageUrls "${stem}=${backendPath}"`;
    if (mimeType.startsWith('video/')) return `--refVideoUrls "${stem}=${backendPath}"`;
    if (mimeType.startsWith('audio/')) return `--refAudioUrls "${stem}=${backendPath}"`;
  }
  return backendPath;
}

function buildUploadSubjectRegisterHint(item) {
  const backendPath = trimToNull(item?.backendPath);
  if (!backendPath) return null;
  const sceneType = trimToNull(item?.sceneType);
  const mimeType = String(item?.mimeType ?? '').toLowerCase();
  if (sceneType !== TASK_UPLOAD_SCENE.VIDEO_CREATE || !mimeType.startsWith('image/')) return null;
  return `${runtimeCommandPrefix()} subject-publish --name <角色名> --primaryUrl "${backendPath}"`;
}

function presentUploadRows(rows) {
  return withAliasesRows(rows.map((item) => ({
    ...item,
    reuseHint: buildUploadReuseHint(item),
    subjectRegisterHint: buildUploadSubjectRegisterHint(item),
  })), {
    fileName: '文件名',
    sceneType: '上传场景',
    backendPath: '素材路径',
    groupId: '素材组ID',
    reuseHint: '复用写法',
    subjectRegisterHint: '主体注册写法',
    width: '宽',
    height: '高',
  });
}

function presentSubjectUploadResult(result) {
  return withAliases(result, {
    name: '主体名称',
    groupId: '素材组ID',
    groupName: '素材组名称',
    publishLabel: '发布标识',
    subjectId: '主体ID',
    nextRefSubject: '引用写法',
    reusedGroup: '复用素材组',
  });
}

function presentTaskRows(rows) {
  return withAliasesRows(
    rows.map((item) => ({
      ...item,
      taskType: taskTypeLabel(item?.taskType),
      taskStatus: taskStatusLabel(item?.taskStatus),
      gmtCreateText: formatDateTime(item?.gmtCreate) ?? item?.gmtCreate ?? null,
    })),
    {
      taskId: '任务ID',
      taskType: '任务类型',
      taskStatus: '任务状态',
      modelName: '模型',
      pointNo: '积分',
      gmtCreateText: '创建时间',
    },
  );
}

function presentTaskWaitResult(result) {
  return withAliases(
    {
      ...result,
      taskStatus: taskStatusLabel(result?.taskStatus),
      waitedSeconds: result?.waitedMs != null ? Math.round(Number(result.waitedMs) / 1000) : null,
    },
    {
      taskId: '任务ID',
      taskStatus: '任务状态',
      modelName: '模型',
      firstResultUrl: '首个结果',
      waitedSeconds: '等待秒数',
      timedOut: '是否超时',
    },
  );
}

function presentPointEstimate(result) {
  return withAliases(result, {
    pointCost: '预计积分',
    projectPointBalance: '项目组余额',
    projectPointRemainingAfter: '提交后项目组剩余',
    teamPointBalance: '团队积分',
    teamPointRemainingAfter: '提交后团队剩余',
  });
}

function presentTaskCreateResult(result) {
  return withAliases(result, {
    taskStatus: taskStatusLabel(result?.taskStatus),
    taskId: '任务ID',
    taskStatus: '任务状态',
    pointCost: '预计积分',
    projectPointBalance: '项目组余额',
    projectPointRemainingAfter: '提交后项目组剩余',
    projectGroupNo: '项目组编号',
    firstResultUrl: '首个结果',
  });
}

function presentAihubmixVideoStatus(result) {
  return withAliases(result, {
    taskId: '任务ID',
    taskStatus: '任务状态',
    modelGroupCode: '模型组',
    firstResultUrl: '下载接口',
    outputFile: '输出文件',
    timedOut: '是否超时',
    errorMsg: '错误',
  });
}

function presentBatchCreateRows(rows) {
  return withAliasesRows(
    rows.map((item) => ({
      ...item,
      taskStatus: taskStatusLabel(item?.taskStatus),
    })),
    {
      inputIndex: '序号',
      pointCost: '预计积分',
      projectPointBalance: '项目组余额',
      projectPointRemainingAfter: '提交后项目组剩余',
      taskId: '任务ID',
      taskStatus: '任务状态',
      projectGroupNo: '项目组编号',
      error: '错误',
    },
  );
}

function presentSubjectBatchRows(rows) {
  return withAliasesRows(rows, {
    inputIndex: '序号',
    name: '主体名称',
    publishLabel: '发布标识',
    subjectId: '主体ID',
    nextRefSubject: '引用写法',
    groupId: '素材组ID',
    reusedGroup: '复用素材组',
    error: '错误',
  });
}

function rewriteAwbErrorMessage(error, context = {}) {
  const message = error instanceof Error ? error.message : String(error);
  if (/项目组积分不足/.test(message)) {
    const projectHint = context.projectGroupNo
      ? `当前 projectGroupNo: ${context.projectGroupNo}`
      : '当前项目组未明确传入，使用的是 CLI 里当前选中的项目组';
    return [
      '项目组积分不足。',
      '这不是团队总积分不足，而是当前项目组可用积分为 0 或已耗尽。',
      projectHint,
      `先执行 ${runtimeCommandPrefix()} points -f json 或 ${runtimeCommandPrefix()} project-group-current -f json 查看当前项目组积分。`,
      `如果只是切错项目组，执行 ${runtimeCommandPrefix()} project-groups 后再 ${runtimeCommandPrefix()} project-group-select --projectGroupNo <id>。`,
      '如果该项目组本身没有额度，需在平台给项目组分配积分上限，或新建带积分的项目组。',
    ].join('\n');
  }
  return message;
}

async function uploadImageReferenceFiles(kwargs) {
  const sceneType = TASK_UPLOAD_SCENE.IMAGE_CREATE;
  const crefUploads = await uploadLocalFiles(parseListArg(kwargs.crefFiles), { sceneType });
  const srefUploads = await uploadLocalFiles(parseListArg(kwargs.srefFiles), { sceneType });
  const irefUploads = await uploadLocalFiles(parseListArg(kwargs.irefFiles), { sceneType });

  return {
    cref: [...parseListArg(kwargs.cref), ...crefUploads.map((item) => item.backendPath)],
    sref: [...parseListArg(kwargs.sref), ...srefUploads.map((item) => item.backendPath)],
    iref: [...parseListArg(kwargs.iref), ...irefUploads.map((item) => item.backendPath)],
    uploads: [...crefUploads, ...srefUploads, ...irefUploads],
  };
}

function buildDryRunBackendPath(filePath, sceneType) {
  return `/${sceneType}/__dry_run__/${path.basename(String(filePath)).replace(/[^0-9A-Za-z._-]+/g, '-')}`;
}

function validateKnownVideoModelQuirks(model, generatedMode, generatedTime, hasReferenceMode) {
  const normalizedGeneratedTime = toNumberOrNull(generatedTime);
  if (!hasReferenceMode || generatedMode !== 'multi_param' || normalizedGeneratedTime == null) return;

  const modelGroupCode = trimToNull(model?.modelGroupCode);
  const klingReferenceGroups = new Set([
    'KeLing3_VideoCreate_Group',
  ]);

  if (klingReferenceGroups.has(modelGroupCode) && normalizedGeneratedTime === 15) {
    throw new Error([
      `${model?.modelName ?? modelGroupCode} 当前参考生视频（multi_param）模式实测不支持 15 秒。`,
      '截至 2026-04-24，CLI 已确认可灵 3.0（非 Omni）参考生视频 10 秒可成功创建，15 秒会被后端拒绝为 invalid duration。',
      '请先改用 `--generatedTime 10`；如果你要做 15 秒，优先改走故事板（multi_prompt）或首帧模式。',
      `可先执行 ${runtimeCommandPrefix()} video-fee --modelGroupCode ${modelGroupCode} --prompt "@角色A 在镜头前说话" --refImageFiles "角色A=./char.webp" --quality 720 --generatedTime 10 --ratio 9:16 -f json`,
    ].join('\n'));
  }
}

async function resolveImagePromptParams(kwargs) {
  const model = await resolveModelSelection('image', kwargs);
  const resolvedKwargs = {
    ...kwargs,
    modelCode: model.modelCode,
    modelGroupCode: model.modelGroupCode,
  };
  const uploadedRefs = kwargs.skipUploads
    ? {
        cref: [
          ...parseListArg(resolvedKwargs.cref),
          ...parseListArg(resolvedKwargs.crefFiles).map((item) => buildDryRunBackendPath(item, TASK_UPLOAD_SCENE.IMAGE_CREATE)),
        ],
        sref: [
          ...parseListArg(resolvedKwargs.sref),
          ...parseListArg(resolvedKwargs.srefFiles).map((item) => buildDryRunBackendPath(item, TASK_UPLOAD_SCENE.IMAGE_CREATE)),
        ],
        iref: [
          ...parseListArg(resolvedKwargs.iref),
          ...parseListArg(resolvedKwargs.irefFiles).map((item) => buildDryRunBackendPath(item, TASK_UPLOAD_SCENE.IMAGE_CREATE)),
        ],
        uploads: [],
      }
    : await uploadImageReferenceFiles(resolvedKwargs);
  const defaultParams = {
    cref: uploadedRefs.cref,
    sref: uploadedRefs.sref,
    iref: uploadedRefs.iref,
    prompt: resolvedKwargs.prompt || '',
  };
  if (resolvedKwargs.ratio != null && resolvedKwargs.ratio !== '') {
    defaultParams.ratio = resolvedKwargs.ratio;
  }
  if (resolvedKwargs.quality != null && resolvedKwargs.quality !== '') {
    defaultParams.quality = resolvedKwargs.quality;
  }
  if (resolvedKwargs.generateNum != null && resolvedKwargs.generateNum !== '') {
    defaultParams.generate_num = String(resolvedKwargs.generateNum);
  }
  if (resolvedKwargs.directGenerateNum != null && resolvedKwargs.directGenerateNum !== '') {
    defaultParams.direct_generate_num = String(resolvedKwargs.directGenerateNum);
  }
  const override = parseJsonArg(resolvedKwargs.promptParamsJson, {}) ?? {};
  const promptParams = {
    ...defaultParams,
    ...override,
    cref: override.cref ?? defaultParams.cref,
    sref: override.sref ?? defaultParams.sref,
    iref: override.iref ?? defaultParams.iref,
    prompt: override.prompt ?? defaultParams.prompt,
  };
  const optionDefs = await validateModelPromptParams('image', resolvedKwargs, promptParams);
  const allowedParamKeys = new Set(optionDefs.map((item) => item?.paramKey).filter(Boolean));
  const unsupportedRefs = [];
  if (!allowedParamKeys.has('cref') && Array.isArray(promptParams.cref) && promptParams.cref.length) {
    unsupportedRefs.push('cref');
  }
  if (!allowedParamKeys.has('sref') && Array.isArray(promptParams.sref) && promptParams.sref.length) {
    unsupportedRefs.push('sref');
  }
  if (!allowedParamKeys.has('iref') && Array.isArray(promptParams.iref) && promptParams.iref.length) {
    unsupportedRefs.push('iref');
  }
  if (unsupportedRefs.length) {
    throw new Error(
      `${model.modelName ?? model.modelCode} 当前不支持这些参考参数：${unsupportedRefs.join(', ')}。请先执行 \`${runtimeCommandPrefix()} model-options --modelGroupCode ${model.modelGroupCode}\` 确认该模型真实支持的参考类型。`,
    );
  }
  return {
    model,
    resolvedKwargs,
    promptParams,
    uploads: uploadedRefs.uploads,
  };
}

async function resolveFrameEntry(entry, defaults, index, options = {}) {
  const sceneType = TASK_UPLOAD_SCENE.VIDEO_CREATE;
  const localFile = entry?.file ?? entry?.filePath ?? entry?.localFile ?? entry?.path ?? null;
  const upload = localFile && !options.skipUploads ? await uploadLocalFile(localFile, { sceneType }) : null;
  const dryRunBackendPath = localFile && options.skipUploads ? buildDryRunBackendPath(localFile, sceneType) : null;
  return {
    text: entry?.text ?? defaults.text ?? '',
    url: normalizeReferenceUrl(entry?.url ?? entry?.signedUrl ?? entry?.backendPath ?? upload?.backendPath ?? upload?.signedUrl ?? dryRunBackendPath ?? ''),
    backendPath: entry?.backendPath ?? upload?.backendPath ?? dryRunBackendPath ?? null,
    time: String(entry?.time ?? defaults.time),
    _id: entry?._id ?? `cli-frame-${index + 1}`,
    width: entry?.width ?? upload?.width ?? null,
    height: entry?.height ?? upload?.height ?? null,
    _localFile: localFile ? path.resolve(localFile) : null,
    upload,
  };
}

async function resolveUploadedNamedResources(specs, options = {}) {
  const {
    valueKey = 'value',
    sceneType = TASK_UPLOAD_SCENE.VIDEO_CREATE,
    skipUploads = false,
  } = options;
  const rows = [];
  for (const spec of specs) {
    const filePath = trimToNull(spec?.[valueKey]);
    if (!filePath) continue;
    const upload = skipUploads ? null : await uploadLocalFile(filePath, { sceneType });
    const placeholderPath = skipUploads ? buildDryRunBackendPath(filePath, sceneType) : null;
    rows.push({
      ...spec,
      filePath: skipUploads ? path.resolve(filePath) : upload?.filePath ?? path.resolve(filePath),
      fileName: skipUploads ? path.basename(filePath) : upload?.fileName ?? path.basename(filePath),
      backendPath: upload?.backendPath ?? placeholderPath,
      url: upload?.backendPath ?? placeholderPath,
      upload,
    });
  }
  return rows;
}

function buildPromptMentionResult(prompt, mentionables) {
  const text = String(prompt ?? '');
  if (!mentionables.length) {
    return {
      taskPrompt: text,
      richTaskPrompt: '',
      richResources: [],
    };
  }

  const aliasMap = new Map();
  for (const item of mentionables) {
    for (const alias of [item.name, item.displayName]) {
      const normalizedAlias = trimToNull(alias);
      if (!normalizedAlias || aliasMap.has(normalizedAlias)) continue;
      aliasMap.set(normalizedAlias, item);
    }
  }
  const aliasList = [...aliasMap.keys()].sort((left, right) => right.length - left.length);

  const normalizedPrompt = text
    .replace(/【([^】]+)】/g, '@$1')
    .replace(/\{([^}]+)\}/g, '@$1');
  const pattern = aliasList.length
    ? new RegExp(`@(${aliasList.map((item) => escapeRegExp(item)).join('|')})`, 'g')
    : null;

  const taskPromptParts = [];
  const richResources = [];
  let matchedCount = 0;
  let cursor = 0;

  if (pattern) {
    for (const match of normalizedPrompt.matchAll(pattern)) {
      const alias = match[1];
      const entry = aliasMap.get(alias);
      if (!entry) continue;
      const start = match.index ?? 0;
      if (start > cursor) {
        const textValue = normalizedPrompt.slice(cursor, start);
        if (textValue) {
          const textTs = String(Date.now() + richResources.length);
          richResources.push({
            id: `text-after-${textTs}`,
            type: 'text',
            value: textValue,
          });
          taskPromptParts.push(textValue);
        }
      }
      const mentionTs = String(Date.now() + richResources.length);
      richResources.push({
        id: `mention-${mentionTs}`,
        type: entry.mentionType,
        value: entry.subjectNo,
        displayName: entry.displayName,
      });
      taskPromptParts.push(entry.displayName);
      cursor = start + match[0].length;
      matchedCount += 1;
    }
  }

  if (matchedCount > 0) {
    if (cursor < normalizedPrompt.length) {
      const tail = normalizedPrompt.slice(cursor);
      if (tail) {
        const textTs = String(Date.now() + richResources.length);
        richResources.push({
          id: `text-after-${textTs}`,
          type: 'text',
          value: tail,
        });
        taskPromptParts.push(tail);
      }
    }
    return {
      taskPrompt: taskPromptParts.join(''),
      richTaskPrompt: [{ label: '', resource: richResources }],
      richResources,
    };
  }

  const prependParts = [];
  for (const [index, item] of mentionables.entries()) {
    const mentionTs = String(Date.now() + richResources.length + index);
    richResources.push({
      id: `mention-${mentionTs}`,
      type: item.mentionType,
      value: item.subjectNo,
      displayName: item.displayName,
    });
    prependParts.push(item.displayName);
  }
  const suffixText = text ? ` ${text}` : '';
  if (suffixText) {
    const textTs = String(Date.now() + richResources.length + 1);
    richResources.push({
      id: `text-after-${textTs}`,
      type: 'text',
      value: suffixText,
    });
    prependParts.push(suffixText);
  }
  return {
    taskPrompt: prependParts.join(''),
    richTaskPrompt: [{ label: '', resource: richResources }],
    richResources,
  };
}

function appendAudioReferencePrompt(promptState, audioBindings) {
  if (!audioBindings.length) return promptState;

  const nextResources = [...promptState.richResources];
  let nextTaskPrompt = promptState.taskPrompt || '';
  const prefixTs = String(Date.now() + 9000);
  nextTaskPrompt += ' 音色参考：';
  nextResources.push({
    id: `text-voice-prefix-${prefixTs}`,
    type: 'text',
    value: ' 音色参考：',
  });

  for (const [index, binding] of audioBindings.entries()) {
    const separator = index < audioBindings.length - 1 ? '，' : '。';
    nextTaskPrompt += `<<<${binding.target.subjectNo}>>>音色参考<<<${binding.audioSubjectNo}>>>${separator}`;

    const targetMentionTs = String(Date.now() + 9100 + index);
    nextResources.push({
      id: `mention-voice-target-${targetMentionTs}`,
      type: binding.target.mentionType,
      value: binding.target.subjectNo,
      displayName: binding.target.displayName,
    });
    const midTextTs = String(Date.now() + 9130 + index);
    nextResources.push({
      id: `text-voice-mid-${midTextTs}`,
      type: 'text',
      value: '音色参考',
    });
    const audioMentionTs = String(Date.now() + 9150 + index);
    nextResources.push({
      id: `mention-voice-audio-${audioMentionTs}`,
      type: 'image',
      value: binding.audioSubjectNo,
      displayName: binding.audioDisplayName,
    });
    const tailTextTs = String(Date.now() + 9200 + index);
    nextResources.push({
      id: `text-voice-tail-${tailTextTs}`,
      type: 'text',
      value: separator,
    });
  }

  return {
    taskPrompt: nextTaskPrompt,
    richTaskPrompt: nextResources.length ? [{ label: '', resource: nextResources }] : '',
    richResources: nextResources,
  };
}

function hasVideoReferenceInputs(kwargs) {
  return [
    kwargs?.refImageFiles,
    kwargs?.refImageUrls,
    kwargs?.refImagesJson,
    kwargs?.refVideoFiles,
    kwargs?.refVideoUrls,
    kwargs?.refVideosJson,
    kwargs?.refAudioFiles,
    kwargs?.refAudioUrls,
    kwargs?.refAudiosJson,
    kwargs?.refSubjects,
    kwargs?.refSubjectsJson,
  ].some((value) => trimToNull(value));
}

function hasVideoTaskInputs(kwargs) {
  return Boolean(
    kwargs?.frameFile ||
    kwargs?.frameUrl ||
    kwargs?.frameText ||
    kwargs?.tailFrameFile ||
    kwargs?.tailFrameUrl ||
    kwargs?.tailFrameText ||
    kwargs?.framesJson ||
    hasVideoReferenceInputs(kwargs),
  );
}

function hasVideoSubmissionContent(kwargs) {
  return Boolean(
    hasVideoTaskInputs(kwargs) ||
    trimToNull(kwargs?.prompt) ||
    parseStoryboardPromptsArg(kwargs?.storyboardPrompts).length ||
    trimToNull(kwargs?.promptParamsJson) ||
    trimToNull(kwargs?.richTaskPrompt),
  );
}

function buildVideoBatchDefaults(kwargs) {
  return {
    modelCode: kwargs.modelCode ?? null,
    modelGroupCode: kwargs.modelGroupCode ?? null,
    projectGroupNo: kwargs.projectGroupNo ?? null,
    prompt: kwargs.prompt ?? null,
    ratio: kwargs.ratio ?? null,
    quality: kwargs.quality ?? null,
    size: kwargs.size ?? null,
    generatedTime: kwargs.generatedTime ?? null,
    frameText: kwargs.frameText ?? null,
    frameUrl: kwargs.frameUrl ?? null,
    frameFile: kwargs.frameFile ?? null,
    tailFrameText: kwargs.tailFrameText ?? null,
    tailFrameUrl: kwargs.tailFrameUrl ?? null,
    tailFrameFile: kwargs.tailFrameFile ?? null,
    generatedMode: kwargs.generatedMode ?? null,
    audio: kwargs.audio ?? null,
    needAudio: kwargs.needAudio ?? null,
    refImageFiles: kwargs.refImageFiles ?? null,
    refImageUrls: kwargs.refImageUrls ?? null,
    refImagesJson: kwargs.refImagesJson ?? null,
    refVideoFiles: kwargs.refVideoFiles ?? null,
    refVideoUrls: kwargs.refVideoUrls ?? null,
    refVideosJson: kwargs.refVideosJson ?? null,
    refAudioFiles: kwargs.refAudioFiles ?? null,
    refAudioUrls: kwargs.refAudioUrls ?? null,
    refAudiosJson: kwargs.refAudiosJson ?? null,
    refSubjects: kwargs.refSubjects ?? null,
    refSubjectsJson: kwargs.refSubjectsJson ?? null,
    storyboardPrompts: kwargs.storyboardPrompts ?? null,
    framesJson: kwargs.framesJson ?? null,
    richTaskPrompt: kwargs.richTaskPrompt ?? null,
    promptParamsJson: kwargs.promptParamsJson ?? null,
    aihubmixApiKey: kwargs.aihubmixApiKey ?? null,
    aihubmixRequestJson: kwargs.aihubmixRequestJson ?? null,
    aihubmixExtraBodyJson: kwargs.aihubmixExtraBodyJson ?? null,
  };
}

async function resolveVideoReferenceInputs(kwargs, options = {}) {
  const sceneType = TASK_UPLOAD_SCENE.VIDEO_CREATE;
  const skipUploads = Boolean(options.skipUploads);

  const imageFileSpecs = parseNamedResourceSpecs(kwargs.refImageFiles, { valueKey: 'value', itemLabel: '参考图片文件' });
  const imageUrlSpecs = parseNamedResourceSpecs(kwargs.refImageUrls, { valueKey: 'value', itemLabel: '参考图片地址' });
  const imageJsonSpecs = parseNamedResourceSpecs(parseJsonArg(kwargs.refImagesJson, []), { valueKey: 'value', itemLabel: '参考图片 JSON' });

  const videoFileSpecs = parseNamedResourceSpecs(kwargs.refVideoFiles, { valueKey: 'value', itemLabel: '参考视频文件' });
  const videoUrlSpecs = parseNamedResourceSpecs(kwargs.refVideoUrls, { valueKey: 'value', itemLabel: '参考视频地址' });
  const videoJsonSpecs = parseNamedResourceSpecs(parseJsonArg(kwargs.refVideosJson, []), { valueKey: 'value', itemLabel: '参考视频 JSON' });

  const audioFileSpecs = parseNamedResourceSpecs(kwargs.refAudioFiles, { valueKey: 'value', itemLabel: '参考音频文件' });
  const audioUrlSpecs = parseNamedResourceSpecs(kwargs.refAudioUrls, { valueKey: 'value', itemLabel: '参考音频地址' });
  const audioJsonSpecs = parseNamedResourceSpecs(parseJsonArg(kwargs.refAudiosJson, []), { valueKey: 'value', itemLabel: '参考音频 JSON' });

  const subjectCsvSpecs = parseNamedResourceSpecs(kwargs.refSubjects, { valueKey: 'elementId', itemLabel: '主体参考' });
  const subjectJsonSpecs = parseNamedResourceSpecs(parseJsonArg(kwargs.refSubjectsJson, []), { valueKey: 'elementId', itemLabel: '主体参考 JSON' });

  const uploadedImageFiles = await resolveUploadedNamedResources(
    [...imageFileSpecs, ...imageJsonSpecs.filter((item) => trimToNull(item?.file) || trimToNull(item?.path))].map((item) => ({
      ...item,
      value: item.value ?? item.file ?? item.path,
    })),
    { valueKey: 'value', sceneType, skipUploads },
  );
  const imageRefs = [
    ...uploadedImageFiles.map((item) => ({
      ...item,
      url: item.backendPath ?? '',
      subjectId: trimToNull(item.subjectId),
    })),
    ...imageUrlSpecs.map((item) => ({
      ...item,
      url: normalizeReferenceUrl(item.value),
      subjectId: trimToNull(item.subjectId),
      upload: null,
    })),
    ...imageJsonSpecs
      .filter((item) => !trimToNull(item.file) && !trimToNull(item.path))
      .map((item) => ({
        ...item,
        url: normalizeReferenceUrl(item.value ?? item.url),
        subjectId: trimToNull(item.subjectId),
        upload: null,
      })),
  ].filter((item) => item.url);

  const uploadedVideoFiles = await resolveUploadedNamedResources(
    [...videoFileSpecs, ...videoJsonSpecs.filter((item) => trimToNull(item?.file) || trimToNull(item?.path))].map((item) => ({
      ...item,
      value: item.value ?? item.file ?? item.path,
    })),
    { valueKey: 'value', sceneType, skipUploads },
  );
  const videoRefs = [
    ...uploadedVideoFiles.map((item) => ({
      ...item,
      url: item.backendPath ?? '',
    })),
    ...videoUrlSpecs.map((item) => ({
      ...item,
      url: normalizeReferenceUrl(item.value),
      upload: null,
    })),
    ...videoJsonSpecs
      .filter((item) => !trimToNull(item.file) && !trimToNull(item.path))
      .map((item) => ({
        ...item,
        url: normalizeReferenceUrl(item.value ?? item.url),
        upload: null,
      })),
  ].filter((item) => item.url);

  const uploadedAudioFiles = await resolveUploadedNamedResources(
    [...audioFileSpecs, ...audioJsonSpecs.filter((item) => trimToNull(item?.file) || trimToNull(item?.path))].map((item) => ({
      ...item,
      value: item.value ?? item.file ?? item.path,
    })),
    { valueKey: 'value', sceneType, skipUploads },
  );
  const audioRefs = [
    ...uploadedAudioFiles.map((item) => ({
      ...item,
      url: item.backendPath ?? '',
      bindTo: item.bindTo ?? item.name,
    })),
    ...audioUrlSpecs.map((item) => ({
      ...item,
      url: normalizeReferenceUrl(item.value),
      bindTo: item.bindTo ?? item.name,
      upload: null,
    })),
    ...audioJsonSpecs
      .filter((item) => !trimToNull(item.file) && !trimToNull(item.path))
      .map((item) => ({
        ...item,
        url: normalizeReferenceUrl(item.value ?? item.url),
        bindTo: trimToNull(item.bindTo) ?? item.name,
        upload: null,
      })),
  ].filter((item) => item.url);

  const subjectRefs = [...subjectCsvSpecs, ...subjectJsonSpecs]
    .map((item) => ({
      ...item,
      elementId: trimToNull(item.elementId ?? item.value),
      desc: trimToNull(item.desc),
    }))
    .filter((item) => item.elementId);

  return {
    imageRefs,
    videoRefs,
    audioRefs,
    subjectRefs,
    uploads: [
      ...uploadedImageFiles.map((item) => item.upload).filter(Boolean),
      ...uploadedVideoFiles.map((item) => item.upload).filter(Boolean),
      ...uploadedAudioFiles.map((item) => item.upload).filter(Boolean),
    ],
  };
}

async function resolveVideoPromptParams(kwargs) {
  const model = await resolveModelSelection('video', kwargs);
  const resolvedKwargs = {
    ...kwargs,
    modelCode: model.modelCode,
    modelGroupCode: model.modelGroupCode,
  };
  const generatedTime = resolvedKwargs.generatedTime == null || resolvedKwargs.generatedTime === '' ? '' : String(resolvedKwargs.generatedTime);
  const referenceInputs = await resolveVideoReferenceInputs(resolvedKwargs, resolvedKwargs);
  const storyboardPrompts = normalizeStoryboardPromptsForPromptParams(
    parseStoryboardPromptsArg(resolvedKwargs.storyboardPrompts),
    generatedTime,
  );
  const hasReferenceMode = referenceInputs.imageRefs.length > 0
    || referenceInputs.videoRefs.length > 0
    || referenceInputs.audioRefs.length > 0
    || referenceInputs.subjectRefs.length > 0;
  const hasStoryboardMode = storyboardPrompts.length > 0;
  if (
    hasStoryboardMode &&
    (
      hasReferenceMode ||
      resolvedKwargs.frameFile ||
      resolvedKwargs.frameUrl ||
      resolvedKwargs.frameText ||
      resolvedKwargs.tailFrameFile ||
      resolvedKwargs.tailFrameUrl ||
      resolvedKwargs.tailFrameText ||
      resolvedKwargs.framesJson
    )
  ) {
    throw new Error('故事板模式不能再混用首尾帧或多参考输入。请二选一：要么传 `--storyboardPrompts`，要么改用 `frame*` / `framesJson` / `ref*`。');
  }
  if (
    hasReferenceMode &&
    (
      resolvedKwargs.frameFile ||
      resolvedKwargs.frameUrl ||
      resolvedKwargs.frameText ||
      resolvedKwargs.tailFrameFile ||
      resolvedKwargs.tailFrameUrl ||
      resolvedKwargs.tailFrameText ||
      resolvedKwargs.framesJson
    )
  ) {
    throw new Error('参考生视频模式不能再混用首帧 / 尾帧 / framesJson。请二选一：要么用 `--frameFile` 这类首尾帧输入，要么改用 `--refImageFiles` / `--refVideoFiles` / `--refAudioFiles` / `--refSubjects`。');
  }
  let frames;

  if (hasReferenceMode || hasStoryboardMode) {
    frames = [];
  } else if (resolvedKwargs.framesJson) {
    const parsedFrames = parseJsonArg(resolvedKwargs.framesJson, []);
    if (!Array.isArray(parsedFrames)) {
      throw new Error('`framesJson` must be a JSON array.');
    }
    frames = [];
    for (const [index, frame] of parsedFrames.entries()) {
      frames.push(await resolveFrameEntry(frame, { time: generatedTime }, index, resolvedKwargs));
    }
  } else {
    const frameEntries = [];
    if (resolvedKwargs.frameText || resolvedKwargs.frameUrl || resolvedKwargs.frameFile) {
      frameEntries.push({
        text: resolvedKwargs.frameText || resolvedKwargs.prompt || '',
        url: resolvedKwargs.frameUrl || '',
        file: resolvedKwargs.frameFile || null,
        time: resolvedKwargs.frameTime || generatedTime,
      });
    }
    if (resolvedKwargs.tailFrameText || resolvedKwargs.tailFrameUrl || resolvedKwargs.tailFrameFile) {
      frameEntries.push({
        text: resolvedKwargs.tailFrameText || '',
        url: resolvedKwargs.tailFrameUrl || '',
        file: resolvedKwargs.tailFrameFile || null,
        time: resolvedKwargs.tailFrameTime || generatedTime,
      });
    }
    frames = [];
    for (const [index, frame] of frameEntries.entries()) {
      frames.push(await resolveFrameEntry(frame, { time: generatedTime }, index, resolvedKwargs));
    }
  }

  const referenceTs = String(Date.now());
  const normalizedFrames = frames.map(({ upload, _localFile, ...frame }) => frame);
  const multiParam = [];
  const mentionableRefs = [];
  const mentionTargetMap = new Map();

  for (const [index, item] of referenceInputs.subjectRefs.entries()) {
    const subjectNo = item.elementId;
    const subjectName = item.desc ? `${item.displayName} - ${item.desc}` : item.displayName;
    const entry = {
      subjectNo,
      subjectName,
      referenceType: 'SUBJECT',
      resources: [{ type: 'SUBJECT', element_id: item.elementId }],
    };
    multiParam.push(entry);
    const mentionEntry = {
      name: item.name,
      displayName: item.displayName,
      subjectNo,
      mentionType: 'subject',
      referenceType: 'SUBJECT',
      index,
    };
    mentionableRefs.push(mentionEntry);
    mentionTargetMap.set(item.name, mentionEntry);
    mentionTargetMap.set(item.displayName, mentionEntry);
  }

  for (const [index, item] of referenceInputs.imageRefs.entries()) {
    const subjectNo = trimToNull(item.subjectId) || `ref-${referenceTs}-${index}`;
    const resource = trimToNull(item.subjectId)
      ? { type: 'IMAGE', url: item.url, resourceNo: item.subjectId }
      : { type: 'IMAGE', url: item.url };
    multiParam.push({
      subjectNo,
      subjectName: item.displayName,
      referenceType: 'IMAGE',
      resources: [resource],
    });
    const mentionEntry = {
      name: item.name,
      displayName: item.displayName,
      subjectNo,
      mentionType: 'image',
      referenceType: 'IMAGE',
      index,
    };
    mentionableRefs.push(mentionEntry);
    mentionTargetMap.set(item.name, mentionEntry);
    mentionTargetMap.set(item.displayName, mentionEntry);
  }

  for (const [index, item] of referenceInputs.videoRefs.entries()) {
    multiParam.push({
      subjectNo: `ref-vid-${referenceTs}-${index}`,
      subjectName: item.displayName,
      referenceType: 'VIDEO',
      resources: [{ type: 'VIDEO', url: item.url }],
    });
  }

  const audioBindings = [];
  for (const [index, item] of referenceInputs.audioRefs.entries()) {
    const targetName = trimToNull(item.bindTo) ?? item.name;
    const target = targetName ? mentionTargetMap.get(targetName) : null;
    if (!target) {
      throw new Error(`音频参考 ${item.displayName} 没有找到可绑定的图片/主体参考。请先提供同名的 \`--refImageFiles\` / \`--refSubjects\`，或把音频参数写成 \`名称@绑定目标=文件\`。`);
    }
    const audioSubjectNo = `ref-audio-${referenceTs}-${index}`;
    multiParam.push({
      subjectNo: audioSubjectNo,
      subjectName: `${item.displayName}的音色`,
      referenceType: 'AUDIO',
      resources: [{ type: 'AUDIO', url: item.url }],
    });
    audioBindings.push({
      target,
      audioSubjectNo,
      audioDisplayName: `${item.displayName}的音色`,
    });
  }

  let promptState = buildPromptMentionResult(resolvedKwargs.prompt || '', mentionableRefs);
  promptState = appendAudioReferencePrompt(promptState, audioBindings);
  const generatedMode =
    trimToNull(resolvedKwargs.generatedMode) ??
    (hasStoryboardMode ? 'multi_prompt' : hasReferenceMode ? 'multi_param' : 'frames');
  validateKnownVideoModelQuirks(model, generatedMode, generatedTime, hasReferenceMode);
  const explicitAudio =
    resolvedKwargs.audio == null || String(resolvedKwargs.audio).trim() === ''
      ? null
      : toBool(resolvedKwargs.audio);
  const explicitNeedAudio =
    resolvedKwargs.needAudio == null || String(resolvedKwargs.needAudio).trim() === ''
      ? null
      : toBool(resolvedKwargs.needAudio);
  const defaultParams = {
    generated_time: generatedTime,
    frames: (hasReferenceMode || hasStoryboardMode) ? [] : normalizedFrames,
    prompt: hasReferenceMode ? '' : resolvedKwargs.prompt || '',
    multi_param: multiParam,
    richTaskPrompt: promptState.richTaskPrompt || resolvedKwargs.richTaskPrompt || '',
    multi_prompt: storyboardPrompts,
  };
  if (generatedMode) {
    defaultParams.generated_mode = generatedMode;
  }
  if (resolvedKwargs.quality != null && resolvedKwargs.quality !== '') {
    defaultParams.quality = resolvedKwargs.quality;
  }
  if (resolvedKwargs.ratio != null && resolvedKwargs.ratio !== '') {
    defaultParams.ratio = resolvedKwargs.ratio;
  }
  if (!generatedTime) {
    delete defaultParams.generated_time;
  }
  if (explicitAudio != null || referenceInputs.audioRefs.length) {
    defaultParams.audio = explicitAudio ?? true;
  }
  if (explicitNeedAudio != null || referenceInputs.audioRefs.length) {
    defaultParams.needAudio = explicitNeedAudio ?? true;
  }
  const override = parseJsonArg(resolvedKwargs.promptParamsJson, {}) ?? {};
  const promptParams = {
    ...defaultParams,
    ...override,
    frames: override.frames ?? defaultParams.frames,
    multi_param: override.multi_param ?? defaultParams.multi_param,
    multi_prompt: override.multi_prompt ?? defaultParams.multi_prompt,
    richTaskPrompt: override.richTaskPrompt ?? defaultParams.richTaskPrompt,
    prompt: override.prompt ?? defaultParams.prompt,
  };
  const validationSource = {
    ...promptParams,
    frames: override.frames ?? frames,
  };
  const optionDefs = await validateModelPromptParams('video', resolvedKwargs, promptParams, validationSource);
  const allowedParamKeys = new Set(optionDefs.map((item) => item?.paramKey).filter(Boolean));
  if (hasReferenceMode && !allowedParamKeys.has('multi_param')) {
    throw new Error(`${model.modelName ?? model.modelCode} 当前不支持参考生视频（multi_param）模式。请先执行 \`${runtimeCommandPrefix()} model-options --modelGroupCode ${model.modelGroupCode}\` 确认该模型支持的输入方式。`);
  }
  if (generatedMode === 'multi_prompt' && !allowedParamKeys.has('multi_prompt')) {
    throw new Error(`${model.modelName ?? model.modelCode} 当前不支持故事板（multi_prompt）模式。请先执行 \`${runtimeCommandPrefix()} model-options --modelGroupCode ${model.modelGroupCode}\` 确认该模型支持的输入方式。`);
  }
  const uploads = [
    ...frames.map((item) => item.upload).filter(Boolean),
    ...referenceInputs.uploads,
  ];
  return {
    model,
    resolvedKwargs,
    promptParams,
    taskPrompt:
      trimToNull(override.taskPrompt) ??
      promptState.taskPrompt ??
      resolvedKwargs.prompt ??
      '',
    uploads,
  };
}

function normalizeCreateResult(payload, extra = {}) {
  return {
    ...extra,
    ...flattenRecord(payload),
    raw: JSON.stringify(payload),
  };
}

function normalizeTimestamp(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

async function resolveCreatedTaskFallback(options) {
  const {
    taskType,
    projectGroupNo,
    modelGroupCode,
    taskPrompt,
    startedAt,
  } = options;

  printRuntimeNote(['[AWB] 创建接口未返回 taskId，正在任务列表中定位新任务...']);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    if (attempt > 0) {
      await sleep(1500);
    }

    const rows = await fetchTaskFeed({
      taskType,
      projectGroupNo,
      pageSize: 20,
      minTime: Date.now(),
    }).catch(() => []);

    const recentRows = rows.filter((item) => {
      const createdAt = normalizeTimestamp(item.gmtCreate);
      return createdAt == null || createdAt >= startedAt - 10_000;
    });

    const exactMatch = recentRows.find(
      (item) =>
        item.modelGroupCode === modelGroupCode &&
        (taskPrompt ? item.taskPrompt === taskPrompt : true),
    );
    if (exactMatch) {
      return {
        ...exactMatch,
        resolvedFromFeed: true,
      };
    }

    const fuzzyMatch = recentRows.find((item) => item.modelGroupCode === modelGroupCode);
    if (fuzzyMatch) {
      return {
        ...fuzzyMatch,
        resolvedFromFeed: true,
      };
    }
  }

  return null;
}

async function estimateImageFee(kwargs) {
  printRuntimeNote(['[AWB] 正在计算生图积分...']);
  const { model, resolvedKwargs, promptParams, uploads } = await resolveImagePromptParams(kwargs);
  const [payload, resolvedProjectGroupNo] = await Promise.all([
    apiFetch('/api/material/creation/imageCreateFeeCalc', {
      body: {
        modelCode: model.modelCode,
        modelGroupCode: model.modelGroupCode,
        taskPrompt: resolvedKwargs.prompt || '',
        promptParams,
        customTaskType: 'IMAGE_CREATE',
      },
    }),
    resolveProjectGroupNo(kwargs.projectGroupNo).catch(() => null),
  ]);
  const pointCost = extractPointCost(payload);
  const snapshot = resolvedProjectGroupNo ? await collectPointSnapshot(resolvedProjectGroupNo).catch(() => null) : null;
  const pointEstimate = buildPointEstimate(pointCost, snapshot);
  return {
    data: payload,
    pointCost: pointEstimate.pointCost,
    ...(payload && typeof payload === 'object' ? flattenRecord(payload) : {}),
    ...pointEstimate,
    uploadedRefs: JSON.stringify(uploads),
  };
}

async function collectPointSnapshot(projectGroupNo) {
  const [teamPoints, projectGroup] = await Promise.all([
    apiFetch('/api/anime/member/benefits/queryGroupPoint', { body: {} }).catch(() => null),
    fetchProjectGroupSummary(projectGroupNo).catch(() => null),
  ]);
  return {
    teamPointBalance: extractPointBalance(teamPoints),
    projectPointBalance: projectGroup?.projectGroupIntegralCurrent ?? null,
    projectPointMax: projectGroup?.projectGroupIntegralMax ?? null,
    currentProjectGroupNo: projectGroup?.projectGroupNo ?? projectGroupNo ?? null,
    currentProjectGroupName: projectGroup?.projectGroupName ?? null,
  };
}

function extractPointCost(payload) {
  if (typeof payload === 'number') return payload;
  return toNumberOrNull(payload?.point ?? payload);
}

function buildPointEstimate(pointCost, snapshot = null) {
  const normalizedPointCost = toNumberOrNull(pointCost);
  const projectPointBalance = toNumberOrNull(snapshot?.projectPointBalance);
  const projectPointMax = toNumberOrNull(snapshot?.projectPointMax);
  const teamPointBalance = toNumberOrNull(snapshot?.teamPointBalance);
  return {
    pointCost: normalizedPointCost,
    currentProjectGroupNo: snapshot?.currentProjectGroupNo ?? null,
    currentProjectGroupName: snapshot?.currentProjectGroupName ?? null,
    projectPointBalance,
    projectPointMax,
    projectPointRemainingAfter:
      normalizedPointCost != null && projectPointBalance != null
        ? projectPointBalance - normalizedPointCost
        : null,
    teamPointBalance,
    teamPointRemainingAfter:
      normalizedPointCost != null && teamPointBalance != null
        ? teamPointBalance - normalizedPointCost
        : null,
  };
}

function dryRunNeedsImageUploads(kwargs) {
  return [kwargs?.crefFiles, kwargs?.srefFiles, kwargs?.irefFiles].some((value) => trimToNull(value));
}

function dryRunNeedsVideoUploads(kwargs) {
  return [
    kwargs?.frameFile,
    kwargs?.tailFrameFile,
    kwargs?.framesJson,
    kwargs?.refImageFiles,
    kwargs?.refImagesJson,
    kwargs?.refVideoFiles,
    kwargs?.refVideosJson,
    kwargs?.refAudioFiles,
    kwargs?.refAudiosJson,
  ].some((value) => trimToNull(value));
}

function printPointEstimate(kindLabel, pointCost, snapshot) {
  const pointEstimate = buildPointEstimate(pointCost, snapshot);
  const lines = [
    `[AWB] 本次预计消耗积分: ${pointEstimate.pointCost ?? '未知'}`,
    `[AWB] 当前项目组: ${pointEstimate.currentProjectGroupName ?? pointEstimate.currentProjectGroupNo ?? '未识别'}`,
    `[AWB] 当前项目组余额: ${pointEstimate.projectPointBalance ?? '未知'} / ${pointEstimate.projectPointMax ?? '未知'}`,
  ];
  if (pointEstimate.projectPointRemainingAfter != null) {
    lines.push(`[AWB] 提交后项目组预计剩余: ${pointEstimate.projectPointRemainingAfter}`);
  }
  lines.push(`[AWB] 当前团队总积分: ${pointEstimate.teamPointBalance ?? '未知'}`);
  if (pointEstimate.teamPointRemainingAfter != null) {
    lines.push(`[AWB] 提交后团队预计剩余: ${pointEstimate.teamPointRemainingAfter}`);
  }
  if (
    pointEstimate.pointCost != null &&
    pointEstimate.projectPointBalance != null &&
    pointEstimate.projectPointRemainingAfter < 0
  ) {
    lines.push(
      `[AWB] 当前项目组余额不足以执行本次${kindLabel}，建议先执行: ${runtimeCommandPrefix()} project-group-update --point ${Math.max(Number(pointEstimate.projectPointMax ?? 0), Number(pointEstimate.pointCost))}`,
    );
  }
  printRuntimeNote(lines);
  return pointEstimate;
}

async function createImageTask(kwargs) {
  const startedAt = Date.now();
  const projectGroupNo = await resolveProjectGroupNo(kwargs.projectGroupNo);
  try {
    printRuntimeNote(['[AWB] 正在校验模型参数并估算生图积分...']);
    const { model, resolvedKwargs, promptParams, uploads } = await resolveImagePromptParams(kwargs);
    const [feePayload, snapshot] = await Promise.all([
      apiFetch('/api/material/creation/imageCreateFeeCalc', {
        body: {
          modelCode: model.modelCode,
          modelGroupCode: model.modelGroupCode,
          taskPrompt: resolvedKwargs.prompt || '',
          promptParams,
          customTaskType: 'IMAGE_CREATE',
        },
      }).catch(() => null),
      collectPointSnapshot(projectGroupNo),
    ]);
    const pointCost = extractPointCost(feePayload);
    const pointEstimate = printPointEstimate('生图', pointCost, snapshot);
    if (
      pointEstimate.pointCost != null &&
      pointEstimate.projectPointBalance != null &&
      pointEstimate.projectPointRemainingAfter < 0
    ) {
      throw new Error('项目组积分不足');
    }
    printRuntimeNote(['[AWB] 正在提交生图任务...']);
    const payload = await apiFetch('/api/material/creation/imageCreate', {
      body: {
        modelCode: model.modelCode,
        modelGroupCode: model.modelGroupCode,
        taskPrompt: resolvedKwargs.prompt,
        promptParams,
        projectGroupNo,
      },
    });
    const normalized = normalizeCreateResult(payload, {
      projectGroupNo,
      uploadedRefs: JSON.stringify(uploads),
      ...pointEstimate,
    });
    if (normalized.taskId) {
      return maybeWaitCreatedTask('IMAGE_CREATE', normalized, kwargs);
    }
    const resolvedTask = await resolveCreatedTaskFallback({
      taskType: 'IMAGE_CREATE',
      projectGroupNo,
      modelGroupCode: model.modelGroupCode,
      taskPrompt: resolvedKwargs.prompt,
      startedAt,
    });
    const result = {
      ...normalized,
      ...(resolvedTask ?? {}),
      nextCommand:
        resolvedTask?.taskId
          ? `${runtimeCommandPrefix()} task-wait --taskId ${resolvedTask.taskId} --taskType IMAGE_CREATE --projectGroupNo ${projectGroupNo}`
          : `${runtimeCommandPrefix()} tasks --taskType IMAGE_CREATE --projectGroupNo ${projectGroupNo} -f json`,
    };
    if (resolvedTask?.taskId) {
      return maybeWaitCreatedTask('IMAGE_CREATE', result, kwargs);
    }
    return result;
  } catch (error) {
    throw new Error(rewriteAwbErrorMessage(error, { projectGroupNo }));
  }
}

async function estimateVideoFee(kwargs) {
  if (isAihubmixVideoModelSelector(kwargs)) {
    const { model, request } = await buildAihubmixVideoRequestForEstimate(kwargs);
    const costEstimate = buildAihubmixVideoCostEstimate(model, request, kwargs);
    return {
      provider: 'aihubmix',
      modelCode: model.modelCode,
      modelGroupCode: model.modelGroupCode,
      pointCost: null,
      billingNote: 'AiHubMix 外部计费，不消耗 AWB/灵境积分；实际成本由 AIHUBMIX_API_KEY 所属项目承担。',
      ...costEstimate,
      request,
    };
  }
  printRuntimeNote(['[AWB] 正在计算生视频积分...']);
  const { model, resolvedKwargs, promptParams, taskPrompt, uploads } = await resolveVideoPromptParams(kwargs);
  const [payload, resolvedProjectGroupNo] = await Promise.all([
    apiFetch('/api/material/creation/videoCreateFeeCalc', {
      body: {
        promptParams,
        modelCode: model.modelCode,
        modelGroupCode: model.modelGroupCode,
        taskPrompt: taskPrompt || resolvedKwargs.prompt || '',
        customTaskType: 'VIDEO_CREATE',
      },
    }),
    resolveProjectGroupNo(kwargs.projectGroupNo).catch(() => null),
  ]);
  const pointCost = extractPointCost(payload);
  const snapshot = resolvedProjectGroupNo ? await collectPointSnapshot(resolvedProjectGroupNo).catch(() => null) : null;
  const pointEstimate = buildPointEstimate(pointCost, snapshot);
  return {
    data: payload,
    pointCost: pointEstimate.pointCost,
    ...(payload && typeof payload === 'object' ? flattenRecord(payload) : {}),
    ...pointEstimate,
    uploadedFrames: JSON.stringify(uploads),
  };
}

async function createVideoTask(kwargs) {
  if (isAihubmixVideoModelSelector(kwargs)) {
    return createAihubmixVideoTask(kwargs);
  }
  const startedAt = Date.now();
  const projectGroupNo = await resolveProjectGroupNo(kwargs.projectGroupNo);
  try {
    printRuntimeNote(['[AWB] 正在校验模型参数并估算生视频积分...']);
    const { model, resolvedKwargs, promptParams, taskPrompt, uploads } = await resolveVideoPromptParams(kwargs);
    const [feePayload, snapshot] = await Promise.all([
      apiFetch('/api/material/creation/videoCreateFeeCalc', {
        body: {
          promptParams,
          modelCode: model.modelCode,
          modelGroupCode: model.modelGroupCode,
          taskPrompt: taskPrompt || resolvedKwargs.prompt || '',
          customTaskType: 'VIDEO_CREATE',
        },
      }).catch(() => null),
      collectPointSnapshot(projectGroupNo),
    ]);
    const pointCost = extractPointCost(feePayload);
    const pointEstimate = printPointEstimate('生视频', pointCost, snapshot);
    if (
      pointEstimate.pointCost != null &&
      pointEstimate.projectPointBalance != null &&
      pointEstimate.projectPointRemainingAfter < 0
    ) {
      throw new Error('项目组积分不足');
    }
    printRuntimeNote(['[AWB] 正在提交生视频任务...']);
    const payload = await apiFetch('/api/material/creation/videoCreate', {
      body: {
        promptParams,
        modelCode: model.modelCode,
        modelGroupCode: model.modelGroupCode,
        taskPrompt: taskPrompt || resolvedKwargs.prompt || '',
        projectGroupNo,
      },
    });
    const normalized = normalizeCreateResult(payload, {
      projectGroupNo,
      uploadedFrames: JSON.stringify(uploads),
      ...pointEstimate,
    });
    if (normalized.taskId) {
      return maybeWaitCreatedTask('VIDEO_GROUP', normalized, kwargs);
    }
    const resolvedTask = await resolveCreatedTaskFallback({
      taskType: 'VIDEO_GROUP',
      projectGroupNo,
      modelGroupCode: model.modelGroupCode,
      taskPrompt: taskPrompt || resolvedKwargs.prompt || '',
      startedAt,
    });
    const result = {
      ...normalized,
      ...(resolvedTask ?? {}),
      nextCommand:
        resolvedTask?.taskId
          ? `${runtimeCommandPrefix()} task-wait --taskId ${resolvedTask.taskId} --taskType VIDEO_GROUP --projectGroupNo ${projectGroupNo}`
          : `${runtimeCommandPrefix()} tasks --taskType VIDEO_GROUP --projectGroupNo ${projectGroupNo} -f json`,
    };
    if (resolvedTask?.taskId) {
      return maybeWaitCreatedTask('VIDEO_GROUP', result, kwargs);
    }
    return result;
  } catch (error) {
    throw new Error(rewriteAwbErrorMessage(error, { projectGroupNo }));
  }
}

function resolveAihubmixApiKey(kwargs = {}) {
  const direct = trimToNull(kwargs.aihubmixApiKey);
  if (direct) return direct;
  for (const envName of ['AIHUBMIX_API_KEY', 'AIHUBMIX_KEY', 'AIHUBMIX_TOKEN']) {
    const value = trimToNull(process.env[envName]);
    if (value) return value;
  }
  throw new Error('缺少 AiHubMix API Key。请设置 AIHUBMIX_API_KEY，或传 `--aihubmixApiKey <key>`。');
}

function aihubmixHeaders(kwargs = {}) {
  return {
    Authorization: `Bearer ${resolveAihubmixApiKey(kwargs)}`,
    'Content-Type': 'application/json',
  };
}

async function aihubmixFetch(pathname, options = {}) {
  const url = new URL(pathname, trimToNull(options.baseUrl) ?? process.env.AIHUBMIX_BASE_URL ?? AIHUBMIX_ORIGIN);
  const method = options.method ?? 'GET';
  const response = await fetch(url, {
    method,
    headers: method === 'GET'
      ? { Authorization: `Bearer ${resolveAihubmixApiKey(options.kwargs)}` }
      : aihubmixHeaders(options.kwargs),
    body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
  });
  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const message =
      payload?.error?.message ??
      payload?.message ??
      payload?.detail ??
      `${response.status} ${response.statusText}`;
    throw new Error(message);
  }
  return payload ?? response;
}

function mimeTypeFromPath(filePath) {
  const ext = path.extname(String(filePath ?? '')).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.gif': 'image/gif',
    '.mp4': 'video/mp4',
    '.mov': 'video/quicktime',
    '.webm': 'video/webm',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.m4a': 'audio/mp4',
  }[ext] ?? 'application/octet-stream';
}

async function fileToDataUrl(filePath) {
  const resolvedPath = path.resolve(filePath);
  const bytes = await fs.readFile(resolvedPath);
  return `data:${mimeTypeFromPath(resolvedPath)};base64,${bytes.toString('base64')}`;
}

async function resolveAihubmixReferenceValue(spec, fallbackFile) {
  const rawValue = trimToNull(spec?.value ?? spec?.url ?? spec?.file ?? fallbackFile);
  if (!rawValue) return null;
  if (/^https?:\/\//i.test(rawValue) || /^data:/i.test(rawValue)) return rawValue;
  return fileToDataUrl(rawValue);
}

async function firstAihubmixImageReference(kwargs) {
  for (const spec of [...collectAihubmixFrameSpecs(kwargs), ...collectAihubmixImageSpecs(kwargs)]) {
    const value = await resolveAihubmixReferenceValue(spec);
    if (value) return value;
  }
  return null;
}

function collectAihubmixImageSpecs(kwargs) {
  return [
    ...parseNamedResourceSpecs(kwargs.refImageUrls, { valueKey: 'value', itemLabel: '参考图片地址' }),
    ...parseNamedResourceSpecs(kwargs.refImageFiles, { valueKey: 'value', itemLabel: '参考图片文件' }),
    ...parseNamedResourceSpecs(parseJsonArg(kwargs.refImagesJson, []), { valueKey: 'value', itemLabel: '参考图片 JSON' }),
  ];
}

function collectAihubmixFrameSpecs(kwargs) {
  return trimToNull(kwargs.frameUrl ?? kwargs.frameFile)
    ? [{ value: kwargs.frameUrl ?? kwargs.frameFile }]
    : [];
}

function collectAihubmixVideoSpecs(kwargs) {
  return [
    ...parseNamedResourceSpecs(kwargs.refVideoUrls, { valueKey: 'value', itemLabel: '参考视频地址' }),
    ...parseNamedResourceSpecs(kwargs.refVideoFiles, { valueKey: 'value', itemLabel: '参考视频文件' }),
  ];
}

function envNumber(name, fallback) {
  const parsed = toNumberOrNull(process.env[name]);
  return parsed == null || parsed < 0 ? fallback : parsed;
}

function roundMoney(value) {
  return Math.round(value * 10000) / 10000;
}

function parseAihubmixSeconds(request = {}, kwargs = {}) {
  return Math.max(1, toNumberOrNull(request.parameters?.duration ?? request.seconds ?? kwargs.generatedTime ?? kwargs.seconds) ?? 5);
}

function extensionFromUrlOrPath(value) {
  const text = trimToNull(value);
  if (!text || /^data:/i.test(text)) return '';
  try {
    return path.extname(new URL(text).pathname).toLowerCase();
  } catch {
    return path.extname(text).toLowerCase();
  }
}

function validateAihubmixUrlExtension(value, allowedExts, label) {
  const ext = extensionFromUrlOrPath(value);
  if (ext && !allowedExts.has(ext)) {
    throw new Error(`${label} 格式不支持：${ext}。HappyHorse 支持 ${Array.from(allowedExts).map((item) => item.slice(1)).join('、')}。`);
  }
}

function validateAihubmixDataUrl(value, allowedMimePrefixes, label) {
  const match = String(value ?? '').match(/^data:([^;,]+)[;,]/i);
  if (!match) return;
  const mime = match[1].toLowerCase();
  if (!allowedMimePrefixes.some((prefix) => mime === prefix || mime.startsWith(`${prefix}/`))) {
    throw new Error(`${label} data URL 类型不支持：${mime}。`);
  }
}

async function validateAihubmixLocalImage(filePath, label) {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (!AIHUBMIX_HAPPYHORSE_IMAGE_EXTS.has(ext)) {
    throw new Error(`${label} 格式不支持：${ext || '未知'}。HappyHorse 图片支持 jpeg、jpg、png、bmp、webp。`);
  }
  const stat = await fs.stat(absolutePath);
  if (stat.size > AIHUBMIX_HAPPYHORSE_MAX_IMAGE_BYTES) {
    throw new Error(`${label} 文件过大：${roundMoney(stat.size / 1024 / 1024)}MB，单张图片不能超过 10MB。`);
  }
  const meta = await readImageMetadata(absolutePath).catch(() => null);
  if (meta?.width && meta?.height) {
    if (meta.width < AIHUBMIX_HAPPYHORSE_MIN_IMAGE_SIDE || meta.height < AIHUBMIX_HAPPYHORSE_MIN_IMAGE_SIDE) {
      throw new Error(`${label} 分辨率过小：${meta.width}x${meta.height}，图片边长需 >= 300px。`);
    }
    const ratio = meta.width / meta.height;
    if (ratio < AIHUBMIX_HAPPYHORSE_MIN_IMAGE_RATIO || ratio > AIHUBMIX_HAPPYHORSE_MAX_IMAGE_RATIO) {
      throw new Error(`${label} 宽高比不支持：${meta.width}:${meta.height}，需满足 2:5 <= 宽高比 <= 5:2。`);
    }
  }
}

async function validateAihubmixLocalVideo(filePath, label) {
  const absolutePath = path.resolve(filePath);
  const ext = path.extname(absolutePath).toLowerCase();
  if (!AIHUBMIX_HAPPYHORSE_VIDEO_EXTS.has(ext)) {
    throw new Error(`${label} 格式不支持：${ext || '未知'}。HappyHorse 参考视频支持 mp4、mov。`);
  }
  const stat = await fs.stat(absolutePath);
  if (stat.size > AIHUBMIX_HAPPYHORSE_MAX_VIDEO_BYTES) {
    throw new Error(`${label} 文件过大：${roundMoney(stat.size / 1024 / 1024)}MB，单个视频不能超过 100MB。`);
  }
}

async function validateAihubmixReferenceSpec(kind, spec, label) {
  const value = trimToNull(spec?.value ?? spec?.url ?? spec?.file ?? spec?.path);
  if (!value) return;
  if (/^data:/i.test(value)) {
    validateAihubmixDataUrl(value, [kind], label);
    return;
  }
  if (/^https?:\/\//i.test(value)) {
    validateAihubmixUrlExtension(
      value,
      kind === 'video' ? AIHUBMIX_HAPPYHORSE_VIDEO_EXTS : AIHUBMIX_HAPPYHORSE_IMAGE_EXTS,
      label,
    );
    return;
  }
  if (kind === 'video') {
    await validateAihubmixLocalVideo(value, label);
  } else if (kind === 'image') {
    await validateAihubmixLocalImage(value, label);
  }
}

async function validateAihubmixR2vImageUrlSpec(spec, index) {
  const label = `HappyHorse r2v 参考图 ${index + 1}`;
  const value = trimToNull(spec?.value ?? spec?.url ?? spec?.file ?? spec?.path);
  if (!value) {
    throw new Error(`${label} 缺少 URL。`);
  }
  if (!/^https?:\/\//i.test(value)) {
    throw new Error(`${label} 必须是公网 HTTP/HTTPS URL；happyhorse-1.0-r2v 不接受本地文件或 data URL。`);
  }
  validateAihubmixUrlExtension(value, AIHUBMIX_HAPPYHORSE_R2V_IMAGE_EXTS, label);
}

async function buildAihubmixR2vMedia(specs) {
  if (specs.length < AIHUBMIX_HAPPYHORSE_R2V_MIN_REFERENCE_IMAGES || specs.length > AIHUBMIX_HAPPYHORSE_R2V_MAX_REFERENCE_IMAGES) {
    throw new Error(`happyhorse-1.0-r2v 参考图数量必须是 ${AIHUBMIX_HAPPYHORSE_R2V_MIN_REFERENCE_IMAGES}-${AIHUBMIX_HAPPYHORSE_R2V_MAX_REFERENCE_IMAGES} 张。`);
  }
  await Promise.all(specs.map((spec, index) => validateAihubmixR2vImageUrlSpec(spec, index)));
  return specs.map((spec) => ({
    type: 'reference_image',
    url: trimToNull(spec.value ?? spec.url ?? spec.file ?? spec.path),
  }));
}

function aihubmixSizeFromRatio(ratio) {
  if (ratio === '9:16') return '720x1280';
  if (ratio === '1:1') return '960x960';
  if (ratio === '4:3') return '960x720';
  if (ratio === '3:4') return '720x960';
  return '1280x720';
}

function validateAihubmixVideoBasics(model, kwargs = {}) {
  const seconds = parseAihubmixSeconds({}, kwargs);
  const minSeconds = model.modelCode === 'happyhorse-1.0-r2v'
    ? AIHUBMIX_HAPPYHORSE_R2V_SECONDS_MIN
    : AIHUBMIX_HAPPYHORSE_SECONDS_MIN;
  if (seconds < minSeconds || seconds > AIHUBMIX_HAPPYHORSE_SECONDS_MAX) {
    throw new Error(`HappyHorse ${model.modelCode} 支持的生成时长是 ${minSeconds}-${AIHUBMIX_HAPPYHORSE_SECONDS_MAX} 秒，请调整 --generatedTime。`);
  }
  const ratio = trimToNull(kwargs.ratio);
  if (model.modelCode !== 'happyhorse-1.0-i2v' && ratio && !AIHUBMIX_HAPPYHORSE_ALLOWED_RATIOS.has(ratio)) {
    throw new Error(`HappyHorse ${model.modelCode} 支持的视频比例：16:9、9:16、1:1、4:3、3:4。`);
  }
  if (model.modelCode === 'happyhorse-1.0-i2v' && ratio) {
    throw new Error('happyhorse-1.0-i2v 的视频比例跟随原图，不支持额外传 --ratio。');
  }
}

function normalizeAihubmixResolution(kwargs = {}) {
  const raw = trimToNull(kwargs.resolution ?? kwargs.quality);
  if (!raw) return '1080P';
  const value = String(raw).trim().toUpperCase();
  if (value === '720' || value === '720P') return '720P';
  if (value === '1080' || value === '1080P' || value === 'HD') return '1080P';
  throw new Error('HappyHorse resolution 只支持 720P / 1080P。可用 `--quality 720P` 或 `--quality 1080P`。');
}

function validateAihubmixPromptLength(prompt, modelCode) {
  const text = String(prompt ?? '');
  const chineseChars = Array.from(text).filter((char) => /[\u3400-\u9FFF]/u.test(char)).length;
  const nonChineseChars = Array.from(text).filter((char) => !/[\u3400-\u9FFF\s]/u.test(char)).length;
  if (chineseChars > 2500) {
    throw new Error(`${modelCode} prompt 中文长度不能超过 2500 字。`);
  }
  if (nonChineseChars > 5000) {
    throw new Error(`${modelCode} prompt 非中文长度不能超过 5000 字符。`);
  }
}

function isAihubmix1080pEstimate(request = {}, kwargs = {}) {
  const resolution = String(request.parameters?.resolution ?? kwargs.resolution ?? '').toUpperCase();
  if (resolution === '1080P') return true;
  if (resolution === '720P') return false;
  const quality = String(kwargs.quality ?? request.quality ?? '').toLowerCase();
  if (/(^|[^0-9])(1080|2k|4k|hd|uhd)([^0-9]|$)/i.test(quality)) return true;
  const size = String(request.size ?? kwargs.size ?? '').toLowerCase();
  const match = size.match(/(\d+)\s*x\s*(\d+)/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return Math.max(width, height) >= 1920 || Math.min(width, height) >= 1080;
}

function buildAihubmixVideoCostEstimate(model = {}, request = {}, kwargs = {}) {
  const seconds = parseAihubmixSeconds(request, kwargs);
  const is1080p = isAihubmix1080pEstimate(request, kwargs);
  const modelEnvPrefix = `AIHUBMIX_HAPPYHORSE_${String(model.modelCode ?? 'DEFAULT').toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
  const usdPerSecond = is1080p
    ? envNumber(`${modelEnvPrefix}_1080P_USD_PER_SECOND`, envNumber('AIHUBMIX_HAPPYHORSE_1080P_USD_PER_SECOND', AIHUBMIX_HAPPYHORSE_COST_DEFAULTS.p1080UsdPerSecond))
    : envNumber(`${modelEnvPrefix}_720P_USD_PER_SECOND`, envNumber('AIHUBMIX_HAPPYHORSE_720P_USD_PER_SECOND', AIHUBMIX_HAPPYHORSE_COST_DEFAULTS.p720UsdPerSecond));
  const cnyPerUsd = envNumber('AIHUBMIX_CNY_PER_USD', AIHUBMIX_HAPPYHORSE_COST_DEFAULTS.cnyPerUsd);
  const estimatedCostUsd = roundMoney(seconds * usdPerSecond);
  const estimatedCostCny = roundMoney(estimatedCostUsd * cnyPerUsd);
  return {
    estimatedCostUsd,
    estimatedCostCny,
    estimatedBillingCurrency: 'USD/CNY',
    estimatedSeconds: seconds,
    estimatedUsdPerSecond: usdPerSecond,
    estimatedResolutionTier: is1080p ? '1080p' : '720p',
    costEstimateSource: AIHUBMIX_HAPPYHORSE_COST_DEFAULTS.source,
    costEstimateFormula: `${seconds}s * ${usdPerSecond} USD/s * ${cnyPerUsd} CNY/USD`,
    costEstimateNote: '估算只用于提交前确认；实际扣费以 AiHubMix 账户账单为准。',
  };
}

async function buildAihubmixVideoRequestForEstimate(kwargs = {}) {
  const selectedModel = await resolveModelSelection('video', kwargs);
  if (selectedModel.modelCode === 'happyhorse-1.0-r2v') {
    return buildAihubmixVideoRequest(kwargs);
  }
  return buildAihubmixVideoRequest({
    ...kwargs,
    frameFile: null,
    refImageFiles: null,
    refVideoFiles: null,
    refAudioFiles: null,
  }).catch(async (error) => {
    const model = selectedModel;
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('需要首帧/参考图')) {
      throw error;
    }
    const size =
      trimToNull(kwargs.size) ??
      (trimToNull(kwargs.quality) && String(kwargs.quality).includes('x') ? trimToNull(kwargs.quality) : null) ??
      (trimToNull(kwargs.ratio) === '9:16' ? '720x1280' : trimToNull(kwargs.ratio) === '1:1' ? '960x960' : '1280x720');
    return {
      model,
      request: {
        model: model.modelCode,
        prompt: trimToNull(kwargs.prompt ?? kwargs.frameText) ?? '<prompt>',
        seconds: trimToNull(kwargs.generatedTime) ?? trimToNull(kwargs.seconds) ?? '5',
        size,
      },
    };
  });
}

async function aihubmixContentItem(kind, spec) {
  const value = await resolveAihubmixReferenceValue(spec);
  if (!value) return null;
  const type = kind === 'video' ? 'video_url' : kind === 'audio' ? 'audio_url' : 'image_url';
  const role = kind === 'video' ? 'reference_video' : kind === 'audio' ? 'reference_audio' : 'reference_image';
  return {
    type,
    role,
    [type]: { url: value },
  };
}

async function buildAihubmixVideoRequest(kwargs = {}) {
  const model = await resolveModelSelection('video', kwargs);
  validateAihubmixVideoBasics(model, kwargs);
  const prompt = trimToNull(kwargs.prompt ?? kwargs.frameText);
  if (!prompt) {
    throw new Error('HappyHorse 视频生成需要 `--prompt`。');
  }
  validateAihubmixPromptLength(prompt, model.modelCode);
  const seconds = trimToNull(kwargs.generatedTime) ?? trimToNull(kwargs.seconds) ?? '5';
  const ratio = trimToNull(kwargs.ratio);
  if (model.modelCode === 'happyhorse-1.0-r2v') {
    const imageSpecs = collectAihubmixImageSpecs(kwargs);
    const media = await buildAihubmixR2vMedia(imageSpecs);
    const resolution = normalizeAihubmixResolution(kwargs);
    const request = {
      model: model.modelCode,
      input: {
        prompt,
        media,
      },
      parameters: {
        resolution,
        ratio: ratio || '16:9',
        duration: toInt(seconds, 5),
      },
    };
    const override = parseJsonArg(kwargs.aihubmixRequestJson, null);
    return {
      model,
      request: override && typeof override === 'object' && !Array.isArray(override)
        ? { ...request, ...override }
        : request,
    };
  }
  const size =
    trimToNull(kwargs.size) ??
    (trimToNull(kwargs.quality) && String(kwargs.quality).includes('x') ? trimToNull(kwargs.quality) : null) ??
    (model.modelCode === 'happyhorse-1.0-i2v' ? null : aihubmixSizeFromRatio(ratio));
  const body = {
    model: model.modelCode,
    prompt,
    seconds,
  };
  if (size) body.size = size;
  if (ratio && !String(size).includes('x')) body.ratio = ratio;

  const extraBody = parseJsonArg(kwargs.aihubmixExtraBodyJson, null);
  if (extraBody && typeof extraBody === 'object' && !Array.isArray(extraBody)) {
    body.extra_body = extraBody;
  }

  if (model.modelCode === 'happyhorse-1.0-i2v') {
    for (const spec of [...collectAihubmixFrameSpecs(kwargs), ...collectAihubmixImageSpecs(kwargs)]) {
      await validateAihubmixReferenceSpec('image', spec, 'HappyHorse 图生视频参考图');
    }
    const inputReference = await firstAihubmixImageReference(kwargs);
    if (!inputReference) {
      throw new Error('happyhorse-1.0-i2v 需要首帧/参考图：传 `--frameUrl` / `--frameFile` / `--refImageUrls` / `--refImageFiles`。');
    }
    body.input_reference = inputReference;
  }

  if (model.modelCode === 'happyhorse-1.0-video-edit') {
    const imageSpecs = [
      ...parseNamedResourceSpecs(kwargs.refImageUrls, { valueKey: 'value', itemLabel: '参考图片地址' }),
      ...parseNamedResourceSpecs(kwargs.refImageFiles, { valueKey: 'value', itemLabel: '参考图片文件' }),
    ];
    const videoSpecs = collectAihubmixVideoSpecs(kwargs);
    for (const spec of imageSpecs) {
      await validateAihubmixReferenceSpec('image', spec, 'HappyHorse 参考图片');
    }
    for (const spec of videoSpecs) {
      await validateAihubmixReferenceSpec('video', spec, 'HappyHorse 参考视频');
    }
    const audioSpecs = [
      ...parseNamedResourceSpecs(kwargs.refAudioUrls, { valueKey: 'value', itemLabel: '参考音频地址' }),
      ...parseNamedResourceSpecs(kwargs.refAudioFiles, { valueKey: 'value', itemLabel: '参考音频文件' }),
    ];
    const content = (await Promise.all([
      ...imageSpecs.map((item) => aihubmixContentItem('image', item)),
      ...videoSpecs.map((item) => aihubmixContentItem('video', item)),
      ...audioSpecs.map((item) => aihubmixContentItem('audio', item)),
    ])).filter(Boolean);
    if (model.modelCode === 'happyhorse-1.0-video-edit' && !videoSpecs.length) {
      throw new Error('happyhorse-1.0-video-edit 需要待编辑视频：传 `--refVideoUrls` 或 `--refVideoFiles`。');
    }
    if (content.length) {
      body.extra_body = {
        ...(body.extra_body ?? {}),
        content: [
          ...(Array.isArray(body.extra_body?.content) ? body.extra_body.content : []),
          ...content,
        ],
      };
    }
  }

  const override = parseJsonArg(kwargs.aihubmixRequestJson, null);
  return {
    model,
    request: override && typeof override === 'object' && !Array.isArray(override)
      ? { ...body, ...override }
      : body,
  };
}

function normalizeAihubmixVideoStatus(payload = {}, extra = {}) {
  const taskId = payload.id ?? payload.video_id ?? extra.taskId ?? null;
  const status = payload.status ?? null;
  const error = payload.error?.message ?? payload.error ?? payload.last_error?.message ?? null;
  return {
    provider: 'aihubmix',
    taskId,
    taskStatus: status ? String(status).toUpperCase() : null,
    modelName: payload.model ?? extra.modelName ?? null,
    modelCode: payload.model ?? extra.modelCode ?? null,
    modelGroupCode: payload.model ?? extra.modelGroupCode ?? null,
    firstResultUrl: taskId ? `${AIHUBMIX_ORIGIN}/v1/videos/${taskId}/content` : null,
    nextCommand: taskId ? `${runtimeCommandPrefix()} aihubmix-video-status --taskId ${taskId} --waitSeconds 300` : null,
    downloadCommand: taskId ? `${runtimeCommandPrefix()} aihubmix-video-download --taskId ${taskId} --outputFile ./output.mp4` : null,
    errorMsg: typeof error === 'string' ? error : error ? JSON.stringify(error) : null,
    raw: JSON.stringify(payload),
    ...extra,
  };
}

async function fetchAihubmixVideoStatus(kwargs = {}) {
  const taskId = trimToNull(kwargs.taskId);
  if (!taskId) throw new Error('请提供 `--taskId <video_id>`。');
  const payload = await aihubmixFetch(`/v1/videos/${taskId}`, { kwargs });
  return normalizeAihubmixVideoStatus(payload, { taskId });
}

async function waitForAihubmixVideo(kwargs = {}) {
  const waitSeconds = Math.max(0, toInt(kwargs.waitSeconds, 0));
  const pollIntervalMs = Math.max(1000, toInt(kwargs.pollIntervalMs, 5000));
  const deadline = Date.now() + waitSeconds * 1000;
  let result = null;
  do {
    result = await fetchAihubmixVideoStatus(kwargs);
    const status = String(result.taskStatus ?? '').toUpperCase();
    if (TERMINAL_TASK_STATES.has(status)) return { ...result, timedOut: false };
    if (waitSeconds <= 0 || Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  } while (true);
  return { ...(result ?? { taskId: kwargs.taskId }), timedOut: waitSeconds > 0 };
}

async function createAihubmixVideoTask(kwargs = {}) {
  printRuntimeNote([
    '[AWB] 当前模型走 AiHubMix 外部计费，不消耗 AWB/灵境积分。',
    '[AWB] 正在提交 AiHubMix 视频任务...',
  ]);
  const { model, request } = await buildAihubmixVideoRequest(kwargs);
  const costEstimate = buildAihubmixVideoCostEstimate(model, request, kwargs);
  const payload = await aihubmixFetch('/v1/videos', {
    method: 'POST',
    kwargs,
    body: request,
  });
  const normalized = normalizeAihubmixVideoStatus(payload, {
    modelName: model.modelName,
    modelCode: model.modelCode,
    modelGroupCode: model.modelGroupCode,
    pointCost: null,
    billingNote: 'AiHubMix 外部计费，不消耗 AWB/灵境积分',
    ...costEstimate,
    request: JSON.stringify(request),
  });
  if (toInt(kwargs.waitSeconds, 0) > 0 && normalized.taskId) {
    return waitForAihubmixVideo({ ...kwargs, taskId: normalized.taskId });
  }
  return normalized;
}

async function previewAihubmixVideoCreate(kwargs = {}) {
  const { model, request } = await buildAihubmixVideoRequestForEstimate(kwargs);
  const costEstimate = buildAihubmixVideoCostEstimate(model, request, kwargs);
  return {
    dryRun: true,
    action: 'video-create',
    provider: 'aihubmix',
    modelCode: model.modelCode,
    modelGroupCode: model.modelGroupCode,
    pointCost: null,
    billingNote: 'AiHubMix 外部计费，不消耗 AWB/灵境积分',
    ...costEstimate,
    request,
    raw: JSON.stringify({ request }),
  };
}

async function downloadAihubmixVideo(kwargs = {}) {
  const taskId = trimToNull(kwargs.taskId);
  if (!taskId) throw new Error('请提供 `--taskId <video_id>`。');
  const outputFile = path.resolve(trimToNull(kwargs.outputFile) ?? `${taskId}.mp4`);
  const response = await fetch(new URL(`/v1/videos/${taskId}/content`, process.env.AIHUBMIX_BASE_URL ?? AIHUBMIX_ORIGIN), {
    headers: { Authorization: `Bearer ${resolveAihubmixApiKey(kwargs)}` },
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error?.message ?? payload?.message ?? `${response.status} ${response.statusText}`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, bytes);
  return {
    provider: 'aihubmix',
    taskId,
    outputFile,
    sizeBytes: bytes.length,
  };
}

async function fetchTaskFeed(kwargs) {
  const feedTaskType = normalizeFeedTaskType(kwargs.taskType || 'IMAGE_CREATE');
  if (feedTaskType === 'AIHUBMIX_VIDEO') {
    throw new Error('AiHubMix 外部任务没有 AWB 任务列表；请用 `aihubmix-video-status --taskId <video_id>` 或 `task-wait --taskType AIHUBMIX_VIDEO --taskId <video_id>`。');
  }
  const projectGroupNo = await resolveProjectGroupNo(kwargs.projectGroupNo);
  const minTime = toInt(kwargs.minTime, Date.now());
  const pageSize = toInt(kwargs.pageSize, 20);
  const request = {
    taskType: feedTaskType,
    minTime,
    pageSize,
    projectGroupNo,
  };
  const payload = await apiFetch('/api/material/creation/task/feedPull', {
    query: request,
    body: request,
  });
  return normalizeTaskRows(payload).map((row) => ({
    ...row,
    feedTaskType,
    projectGroupNo,
  }));
}

async function fetchTaskFeedSince({
  taskType,
  projectGroupNo,
  sinceMs,
  untilMs = Date.now(),
  pageSize = 100,
  maxPages = 20,
}) {
  const rows = [];
  const seen = new Set();
  let minTime = untilMs;

  for (let page = 0; page < maxPages; page += 1) {
    const batch = await fetchTaskFeed({
      taskType,
      projectGroupNo,
      pageSize,
      minTime,
    });
    if (!batch.length) break;

    let oldestMs = null;
    for (const row of batch) {
      const createdMs = taskTimeMs(row);
      if (createdMs != null) {
        oldestMs = oldestMs == null ? createdMs : Math.min(oldestMs, createdMs);
      }
      const dedupeKey = trimToNull(row.taskId);
      if (dedupeKey) {
        if (seen.has(dedupeKey)) continue;
        seen.add(dedupeKey);
      }
      const afterSince = sinceMs == null || createdMs == null || createdMs >= sinceMs;
      const beforeUntil = createdMs == null || createdMs <= untilMs;
      if (afterSince && beforeUntil) {
        rows.push(row);
      }
    }

    if (oldestMs == null) break;
    if (sinceMs != null && oldestMs < sinceMs) break;
    if (oldestMs >= minTime) break;
    minTime = oldestMs - 1;
  }

  return rows;
}

async function buildUsageSummary(kwargs) {
  const projectGroupNo = await resolveProjectGroupNo(kwargs.projectGroupNo);
  const sinceMs = resolveUsageSinceMs(kwargs);
  const untilMs = parseUsageTimeMs(kwargs.untilMs ?? kwargs.until, Date.now());
  if (sinceMs != null && untilMs < sinceMs) {
    throw new Error('结束时间不能早于开始时间。请检查 `--since/--sinceMs` 与 `--until/--untilMs`。');
  }
  const startProjectPointBalance = resolveUsageStartBalance(kwargs);
  const pointPriceYuan = resolveUsagePointPriceYuan(kwargs);
  const pageSize = Math.min(Math.max(toInt(kwargs.pageSize, 100), 1), 200);
  const maxPages = Math.min(Math.max(toInt(kwargs.maxPages, 20), 1), 200);
  const projectGroup = await fetchProjectGroupSummary(projectGroupNo);
  const taskTypes = ['IMAGE_CREATE', 'IMAGE_EDIT', 'VIDEO_GROUP'];
  const taskGroups = await Promise.all(taskTypes.map((taskType) =>
    fetchTaskFeedSince({
      taskType,
      projectGroupNo,
      sinceMs,
      untilMs,
      pageSize,
      maxPages,
    }),
  ));
  const tasks = taskGroups.flat();
  const buckets = {
    image: createUsageBucket(),
    imageEdit: createUsageBucket(),
    video: createUsageBucket(),
  };
  for (const row of tasks) {
    addTaskToUsageBucket(buckets[taskUsageBucket(row.feedTaskType ?? row.taskType)], row);
  }
  const taskPointTotal = buckets.image.pointTotal + buckets.imageEdit.pointTotal + buckets.video.pointTotal;
  const currentProjectPointBalance = toNumberOrNull(projectGroup.projectGroupIntegralCurrent ?? projectGroup.pointBalance);
  const projectPointBalanceDelta =
    startProjectPointBalance != null && currentProjectPointBalance != null
      ? startProjectPointBalance - currentProjectPointBalance
      : null;
  const consumedProjectPoints = projectPointBalanceDelta == null ? null : Math.max(0, projectPointBalanceDelta);
  const balanceIncreasedPoints = projectPointBalanceDelta == null ? null : Math.max(0, -projectPointBalanceDelta);
  const estimatedConsumedPoints =
    projectPointBalanceDelta == null || projectPointBalanceDelta < 0
      ? taskPointTotal
      : consumedProjectPoints;
  const unattributedPointTotal = consumedProjectPoints == null
    ? 0
    : Math.max(0, consumedProjectPoints - taskPointTotal);
  const billingBasis = projectPointBalanceDelta == null
    ? 'task_point_sum'
    : projectPointBalanceDelta < 0
      ? 'task_point_sum_balance_increased'
      : 'project_balance_delta';
  const summary = {
    projectGroupNo,
    projectGroupName: projectGroup.projectGroupName ?? null,
    sinceMs,
    sinceText: sinceMs == null ? null : formatDateTime(sinceMs),
    untilMs,
    untilText: formatDateTime(untilMs),
    pageSize,
    maxPages,
    currentProjectPointBalance,
    projectPointMax: projectGroup.projectGroupIntegralMax ?? null,
    startProjectPointBalance,
    consumedProjectPoints,
    projectPointBalanceDelta,
    balanceIncreasedPoints,
    estimatedConsumedPoints,
    taskPointTotal,
    pointPriceYuan,
    estimatedCostYuan: calculateUsageCostYuan(estimatedConsumedPoints, pointPriceYuan),
    imageCostYuan: calculateUsageCostYuan(buckets.image.pointTotal + buckets.imageEdit.pointTotal, pointPriceYuan),
    videoCostYuan: calculateUsageCostYuan(buckets.video.pointTotal, pointPriceYuan),
    unattributedPointTotal,
    unattributedCostYuan: calculateUsageCostYuan(unattributedPointTotal, pointPriceYuan),
    billingBasis,
    image: buckets.image,
    imageEdit: buckets.imageEdit,
    video: buckets.video,
    imageTaskCount: buckets.image.successTaskCount + buckets.imageEdit.successTaskCount,
    imageResultCount: buckets.image.resultCount + buckets.imageEdit.resultCount,
    imagePointTotal: buckets.image.pointTotal + buckets.imageEdit.pointTotal,
    videoTaskCount: buckets.video.successTaskCount,
    videoResultCount: buckets.video.resultCount,
    videoPointTotal: buckets.video.pointTotal,
    scannedTaskCount: tasks.length,
    taskWindowLimited: sinceMs == null,
  };
  if (toBool(kwargs.includeTasks)) {
    summary.tasks = tasks.map((row) => ({
      taskId: row.taskId,
      taskType: row.feedTaskType ?? row.taskType,
      taskStatus: row.taskStatus,
      modelName: row.modelName,
      pointNo: row.pointNo,
      gmtCreate: row.gmtCreate,
      resultCount: row.resultCount,
    }));
  }
  return presentUsageSummary(summary);
}

async function findTaskOnce(kwargs) {
  if (normalizeFeedTaskType(kwargs.taskType) === 'AIHUBMIX_VIDEO') {
    return fetchAihubmixVideoStatus(kwargs);
  }
  const rows = await fetchTaskFeed({
    taskType: kwargs.taskType,
    projectGroupNo: kwargs.projectGroupNo,
    pageSize: kwargs.pageSize ?? 100,
    minTime: kwargs.minTime ?? Date.now(),
  });
  return rows.find((item) => item.taskId === kwargs.taskId) ?? null;
}

async function waitForTask(kwargs) {
  const waitSeconds = toInt(kwargs.waitSeconds, 300);
  const pollIntervalMs = toInt(kwargs.pollIntervalMs, 5000);
  const deadline = Date.now() + waitSeconds * 1000;
  let lastTask = null;

  while (Date.now() <= deadline) {
    lastTask = await findTaskOnce(kwargs);
    if (lastTask && TERMINAL_TASK_STATES.has(lastTask.taskStatus ?? '')) {
      return {
        ...lastTask,
        waitedMs: waitSeconds * 1000 - Math.max(0, deadline - Date.now()),
        timedOut: false,
      };
    }
    await sleep(pollIntervalMs);
  }

  return {
    ...(lastTask ?? {
      taskId: kwargs.taskId,
      taskStatus: null,
      firstResultUrl: null,
      resultFileList: '[]',
      resultFileDisplayList: '[]',
    }),
    waitedMs: waitSeconds * 1000,
    timedOut: true,
  };
}

async function maybeWaitCreatedTask(taskType, createResult, kwargs) {
  const waitSeconds = toInt(kwargs.waitSeconds, 0);
  if (waitSeconds <= 0 || !createResult?.taskId) {
    return createResult;
  }

  printRuntimeNote([
    `[AWB] 已提交任务，开始等待结果（最多 ${waitSeconds}s）...`,
    `[AWB] taskId: ${createResult.taskId}`,
  ]);

  const waited = await waitForTask({
    taskId: createResult.taskId,
    taskType,
    projectGroupNo: createResult.projectGroupNo ?? kwargs.projectGroupNo,
    pageSize: kwargs.pageSize ?? 100,
    waitSeconds,
    pollIntervalMs: kwargs.pollIntervalMs,
  });

  return {
    ...createResult,
    ...waited,
    submitted: true,
    nextCommand: waited.timedOut
      ? `${runtimeCommandPrefix()} task-wait --taskId ${createResult.taskId} --taskType ${taskType} --projectGroupNo ${createResult.projectGroupNo ?? kwargs.projectGroupNo ?? '<projectGroupNo>'}`
      : null,
  };
}

async function loadBatchItems(inputFile, mode) {
  const text = await fs.readFile(inputFile, 'utf8');
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('Batch input JSON must be an array.');
    }
    return parsed;
  }
  if (trimmed.startsWith('{')) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed?.items)) return parsed.items;
    throw new Error('Batch input JSON object must contain an `items` array.');
  }
  return trimmed
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      if (mode === 'image') return { prompt: line };
      if (mode === 'subject') return { name: line };
      return { prompt: line };
    });
}

async function runConcurrent(items, limit, worker) {
  const safeLimit = Math.max(1, toInt(limit, 1));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function runOne() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= items.length) return;
      try {
        results[currentIndex] = await worker(items[currentIndex], currentIndex);
      } catch (error) {
        results[currentIndex] = {
          inputIndex: currentIndex,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(safeLimit, items.length || 1) }, runOne));
  return results;
}

function summarizeBatchPointRows(rows) {
  const groups = new Map();
  let estimatedCount = 0;
  let errorCount = 0;
  let totalPointCost = 0;
  let teamPointBalance = null;

  for (const row of rows) {
    if (!row) continue;
    if (row.error) {
      errorCount += 1;
      continue;
    }

    const pointCost = toNumberOrNull(row.pointCost);
    if (pointCost == null) continue;

    estimatedCount += 1;
    totalPointCost += pointCost;
    if (teamPointBalance == null) {
      teamPointBalance = toNumberOrNull(row.teamPointBalance);
    }

    const projectGroupNo = row.projectGroupNo ?? row.currentProjectGroupNo ?? 'unknown';
    const projectGroupName = row.currentProjectGroupName ?? null;
    const projectPointBalance = toNumberOrNull(row.projectPointBalance);
    const group = groups.get(projectGroupNo) ?? {
      projectGroupNo,
      projectGroupName,
      projectPointBalance,
      totalPointCost: 0,
      itemCount: 0,
    };
    if (!group.projectGroupName && projectGroupName) {
      group.projectGroupName = projectGroupName;
    }
    if (group.projectPointBalance == null && projectPointBalance != null) {
      group.projectPointBalance = projectPointBalance;
    }
    group.totalPointCost += pointCost;
    group.itemCount += 1;
    groups.set(projectGroupNo, group);
  }

  return {
    totalCount: rows.length,
    estimatedCount,
    errorCount,
    totalPointCost,
    teamPointBalance,
    teamPointRemainingAfter:
      teamPointBalance != null ? teamPointBalance - totalPointCost : null,
    groups: Array.from(groups.values()).map((group) => ({
      ...group,
      projectPointRemainingAfter:
        group.projectPointBalance != null ? group.projectPointBalance - group.totalPointCost : null,
    })),
  };
}

function printBatchEstimateSummary(kindLabel, rows) {
  const summary = summarizeBatchPointRows(rows);
  const lines = [
    `[AWB] 批量${kindLabel}预估: 共 ${summary.totalCount} 条，成功估算 ${summary.estimatedCount} 条，失败 ${summary.errorCount} 条`,
    `[AWB] 本批预计总消耗积分: ${summary.totalPointCost}`,
  ];
  if (summary.teamPointBalance != null) {
    lines.push(`[AWB] 当前团队总积分: ${summary.teamPointBalance}`);
    lines.push(`[AWB] 本批提交后团队预计剩余: ${summary.teamPointRemainingAfter}`);
  }
  for (const group of summary.groups) {
    const label = group.projectGroupName
      ? `${group.projectGroupName} (${group.projectGroupNo})`
      : group.projectGroupNo;
    const balance = group.projectPointBalance ?? '未知';
    const remaining = group.projectPointRemainingAfter ?? '未知';
    lines.push(
      `[AWB] 项目组 ${label}: ${group.itemCount} 条，预计消耗 ${group.totalPointCost}，当前余额 ${balance}，提交后预计剩余 ${remaining}`,
    );
  }
  printRuntimeNote(lines);
  return summary;
}

function printModelListHint(kind, rows) {
  const first = Array.isArray(rows) ? rows.find((item) => item?.modelCode && item?.modelGroupCode) : null;
  if (!first) {
    printRuntimeNote([`[AWB] 当前未拿到可用${kind === 'video' ? '视频' : '图片'}模型。可稍后重试，或切换 --source catalog。`]);
    return;
  }

  const modelOptionsCmd =
    `${runtimeCommandPrefix()} model-options --modelGroupCode ${first.modelGroupCode}`;
  const previewCmd = buildModelPreviewCommand(kind, first);

  const lines = [];
  if (first.featureSummary) {
    lines.push(`[AWB] ${first.modelName ?? first.modelCode} 特征: ${first.featureSummary}`);
  }
  lines.push(`[AWB] 下一步建议: 先看参数 ${modelOptionsCmd}`);
  lines.push(`[AWB] 确认参数后可先预演: ${previewCmd}`);
  printRuntimeNote(lines);
}

function buildModelModeExamples(kind, modelRow, rowByKey = new Map()) {
  const modelGroupCode = modelRow?.modelGroupCode ?? '<modelGroupCode>';
  const examples = [];

  if (kind === 'image') {
    examples.push(`基础预演: ${runtimeCommandPrefix()} image-create --modelGroupCode ${modelGroupCode} --prompt "一只小狗" --quality <quality> --ratio <ratio> --generateNum 1 --dryRun true`);
    if (String(modelRow?.refFeature ?? '').includes('iref')) {
      examples.push(`参考图预演: ${runtimeCommandPrefix()} image-create --modelGroupCode ${modelGroupCode} --prompt "参考图里的角色在雨夜奔跑" --quality <quality> --ratio <ratio> --generateNum 1 --irefFiles "./a.webp" --dryRun true`);
    }
    return examples;
  }

  if (videoModelSupportsPromptOnly(modelRow)) {
    examples.push(`纯提示词预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --prompt "雨夜街头，人物缓慢走向镜头，电影感" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
  }
  if (rowByKey.get('frames')) {
    examples.push(`首尾帧预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --frameFile ./frame.webp --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
  }
  if (rowByKey.get('multi_param')) {
    const refFeature = String(modelRow?.['参考模式'] ?? modelRow?.refFeature ?? '');
    if (refFeature.includes('音频')) {
      examples.push(`多参考预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --prompt "@角色A 对镜说话" --refImageFiles "角色A=./char.webp" --refAudioFiles "角色A=./voice.mp3" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
    } else if (refFeature.includes('视频')) {
      examples.push(`多参考预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp" --refVideoFiles "动作=./motion.mp4" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
    } else {
      examples.push(`参考图预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
    }
  }
  if (rowByKey.get('multi_prompt')) {
    examples.push(`故事板预演: ${runtimeCommandPrefix()} video-create --modelGroupCode ${modelGroupCode} --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" --quality <quality> --generatedTime <seconds> --ratio <ratio> --dryRun true`);
  }

  return examples;
}

function printModelOptionSummary(model, modelDefinition, rows, kind) {
  const rowByKey = new Map((Array.isArray(rows) ? rows : []).map((item) => [item?.paramKey, item]));
  const summaryLines = [];
  const normalizedModel = normalizeModelRows([modelDefinition])[0] ?? {};
  const featureText = normalizedModel?.featureSummary ?? null;
  summaryLines.push(`[AWB] 模型: ${modelDefinition?.modelName ?? model?.modelName ?? model?.modelCode}`);
  summaryLines.push(`[AWB] 模型组: ${modelDefinition?.modelGroupCode ?? model?.modelGroupCode}`);
  if (featureText) {
    summaryLines.push(`[AWB] 能力: ${featureText}`);
  }
  for (const key of ['quality', 'generated_time', 'ratio', 'generate_num', 'direct_generate_num', 'generated_mode']) {
    const row = rowByKey.get(key);
    if (!row) continue;
    const label = row?.名称 ?? row?.paramName ?? key;
    const constraint = trimToNull(row?.约束);
    if (constraint) {
      summaryLines.push(`[AWB] ${label}: ${constraint}`);
    }
  }
  if (kind === 'image') {
    const refRow = rowByKey.get('iref') ?? rowByKey.get('cref') ?? rowByKey.get('sref');
    if (refRow && trimToNull(refRow?.约束)) {
      summaryLines.push(`[AWB] 参考图: ${refRow.约束}`);
    }
  }
  if (kind === 'video') {
    const frameRow = rowByKey.get('frames');
    if (frameRow && trimToNull(frameRow?.约束)) {
      summaryLines.push(`[AWB] 帧输入: ${frameRow.约束}`);
    }
    const refRow = rowByKey.get('multi_param');
    if (refRow && trimToNull(refRow?.约束)) {
      summaryLines.push(`[AWB] 多参考: ${refRow.约束}`);
    }
    const boardRow = rowByKey.get('multi_prompt');
    if (boardRow && trimToNull(boardRow?.约束)) {
      summaryLines.push(`[AWB] 故事板: ${boardRow.约束}`);
    }
  }
  for (const example of buildModelModeExamples(kind, normalizedModel, rowByKey)) {
    summaryLines.push(`[AWB] ${example}`);
  }
  summaryLines.push('[AWB] 表格说明: `底层参数` 是服务端 promptParams key；`推荐CLI用法` 是当前 CLI 推荐入口，所以两列不一定同名。');
  printRuntimeNote(summaryLines);
}

function applySequentialBatchBalances(rows) {
  const nextProjectBalance = new Map();
  let nextTeamBalance = null;

  return rows.map((row) => {
    if (!row || row.error) return row;
    const pointCost = toNumberOrNull(row.pointCost);
    if (pointCost == null) return row;

    const projectGroupNo = row.projectGroupNo ?? row.currentProjectGroupNo ?? 'unknown';
    const startingProjectBalance =
      nextProjectBalance.get(projectGroupNo) ?? toNumberOrNull(row.projectPointBalance);
    const projectPointRemainingAfter =
      startingProjectBalance != null ? startingProjectBalance - pointCost : row.projectPointRemainingAfter ?? null;
    if (startingProjectBalance != null) {
      nextProjectBalance.set(projectGroupNo, projectPointRemainingAfter);
    }

    const startingTeamBalance = nextTeamBalance ?? toNumberOrNull(row.teamPointBalance);
    const teamPointRemainingAfter =
      startingTeamBalance != null ? startingTeamBalance - pointCost : row.teamPointRemainingAfter ?? null;
    if (startingTeamBalance != null) {
      nextTeamBalance = teamPointRemainingAfter;
    }

    return {
      ...row,
      projectPointRemainingAfter,
      teamPointRemainingAfter,
    };
  });
}

function mergeBatchDefaults(defaults, item) {
  return { ...defaults, ...item };
}

async function createProjectGroup(kwargs) {
  const before = (await getProjectGroupsPayload()).list;
  const allUsers = await apiFetch('/api/anime/workbench/projectGroup/getGroupAllUser', {
    method: 'GET',
  });
  let groupUser = parseJsonArg(kwargs.membersJson, null);
  if (!Array.isArray(groupUser)) {
    const selectedUserIds = new Set(parseListArg(kwargs.userIds));
    groupUser = (Array.isArray(allUsers) ? allUsers : [])
      .filter((user) => Boolean(user?.isCheck) || selectedUserIds.has(user?.userId))
      .map((user) => ({
        userId: user.userId,
        role: user.isCheck ? user.role ?? 'CREATOR' : 'USER',
      }));
  }
  if (!groupUser.length) {
    throw new Error('No project group members resolved. Use `project-group-users` to inspect available members.');
  }
  if (!groupUser.some((item) => item.role === 'CREATOR')) {
    groupUser[0] = {
      ...groupUser[0],
      role: 'CREATOR',
    };
  }

  await apiFetch('/api/anime/workbench/projectGroup/createProjectGroup', {
    body: {
      projectGroupName: kwargs.name,
      point: toInt(kwargs.point, 0),
      groupUser,
    },
  });

  const afterPayload = await getProjectGroupsPayload();
  const beforeIds = new Set(before.map((item) => item?.projectGroupNo ?? item?.no).filter(Boolean));
  const created = afterPayload.list.find(
    (item) => !beforeIds.has(item?.projectGroupNo ?? item?.no),
  ) ?? afterPayload.list.find((item) => item?.projectGroupName === kwargs.name);

  const projectGroupNo = created?.projectGroupNo ?? created?.no ?? null;
  if (!projectGroupNo) {
    throw new Error('Project group created, but the new projectGroupNo could not be resolved.');
  }
  await apiFetch('/api/anime/workbench/projectGroup/setLastProjectGroup', {
    body: { projectGroupNo },
  });
  await saveState({ currentProjectGroupNo: projectGroupNo });
  return {
    ...(await fetchProjectGroupSummary(projectGroupNo)),
    created: true,
    memberCount: groupUser.length,
  };
}

async function previewProjectGroupCreate(kwargs) {
  const allUsers = await apiFetch('/api/anime/workbench/projectGroup/getGroupAllUser', {
    method: 'GET',
  });
  let groupUser = parseJsonArg(kwargs.membersJson, null);
  if (!Array.isArray(groupUser)) {
    const selectedUserIds = new Set(parseListArg(kwargs.userIds));
    groupUser = (Array.isArray(allUsers) ? allUsers : [])
      .filter((user) => Boolean(user?.isCheck) || selectedUserIds.has(user?.userId))
      .map((user) => ({
        userId: user.userId,
        role: user.isCheck ? user.role ?? 'CREATOR' : 'USER',
      }));
  }
  return {
    dryRun: true,
    action: 'project-group-create',
    request: {
      projectGroupName: kwargs.name,
      point: toInt(kwargs.point, 0),
      groupUser,
    },
    memberCount: groupUser.length,
  };
}

async function updateProjectGroup(kwargs) {
  const projectGroupNo = await resolveProjectGroupNo(kwargs.projectGroupNo);
  const body = {
    projectGroupNo,
  };
  if (kwargs.name != null && String(kwargs.name).trim() !== '') {
    body.projectGroupName = String(kwargs.name).trim();
  }
  if (kwargs.point != null && String(kwargs.point).trim() !== '') {
    body.point = toInt(kwargs.point, 0);
  }

  if (Object.keys(body).length === 1) {
    throw new Error('至少提供一个修改项：`--name` 或 `--point`。');
  }

  await apiFetch('/api/anime/workbench/projectGroup/modify', {
    body,
  });

  return {
    ...(await fetchProjectGroupSummary(projectGroupNo)),
    updated: true,
  };
}

async function previewProjectGroupUpdate(kwargs) {
  const projectGroupNo = await resolvePreviewProjectGroupNo(kwargs.projectGroupNo);
  const body = {
    projectGroupNo,
  };
  if (kwargs.name != null && String(kwargs.name).trim() !== '') {
    body.projectGroupName = String(kwargs.name).trim();
  }
  if (kwargs.point != null && String(kwargs.point).trim() !== '') {
    body.point = toInt(kwargs.point, 0);
  }
  if (Object.keys(body).length === 1) {
    throw new Error('至少提供一个修改项：`--name` 或 `--point`。');
  }
  return {
    dryRun: true,
    action: 'project-group-update',
    projectGroupNo,
    projectGroupName: body.projectGroupName ?? null,
    pointBalance: null,
    projectGroupIntegralMax: body.point ?? null,
    updated: false,
    request: body,
  };
}

async function previewImageCreate(kwargs) {
  const previewResolved = await resolveImagePromptParams({
    ...kwargs,
    skipUploads: true,
  });
  const feeResolved = dryRunNeedsImageUploads(kwargs)
    ? await resolveImagePromptParams(kwargs)
    : previewResolved;
  const { model, resolvedKwargs, promptParams } = previewResolved;
  const projectGroupNo = await resolvePreviewProjectGroupNo(kwargs.projectGroupNo);
  const [feePayload, snapshot] = await Promise.all([
    apiFetch('/api/material/creation/imageCreateFeeCalc', {
      body: {
        modelCode: feeResolved.model.modelCode,
        modelGroupCode: feeResolved.model.modelGroupCode,
        taskPrompt: feeResolved.resolvedKwargs.prompt || '',
        promptParams: feeResolved.promptParams,
        customTaskType: 'IMAGE_CREATE',
      },
    }).catch(() => null),
    projectGroupNo ? collectPointSnapshot(projectGroupNo).catch(() => null) : Promise.resolve(null),
  ]);
  const pointEstimate = buildPointEstimate(extractPointCost(feePayload), snapshot);
  return {
    dryRun: true,
    action: 'image-create',
    projectGroupNo,
    request: {
      modelCode: model.modelCode,
      modelGroupCode: model.modelGroupCode,
      projectGroupNo,
      taskPrompt: resolvedKwargs.prompt ?? '',
      promptParams,
      promptParamsJson: resolvedKwargs.promptParamsJson || null,
    },
    ...pointEstimate,
    localRefs: {
      crefFiles: await inspectLocalFiles(parseListArg(kwargs.crefFiles)),
      srefFiles: await inspectLocalFiles(parseListArg(kwargs.srefFiles)),
      irefFiles: await inspectLocalFiles(parseListArg(kwargs.irefFiles)),
    },
  };
}

async function previewVideoCreate(kwargs) {
  if (isAihubmixVideoModelSelector(kwargs)) {
    return previewAihubmixVideoCreate(kwargs);
  }
  const previewResolved = await resolveVideoPromptParams({
    ...kwargs,
    skipUploads: true,
  });
  const feeResolved = dryRunNeedsVideoUploads(kwargs)
    ? await resolveVideoPromptParams(kwargs)
    : previewResolved;
  const { model, resolvedKwargs, promptParams, taskPrompt } = previewResolved;
  const projectGroupNo = await resolvePreviewProjectGroupNo(kwargs.projectGroupNo);
  const [feePayload, snapshot] = await Promise.all([
    apiFetch('/api/material/creation/videoCreateFeeCalc', {
      body: {
        promptParams: feeResolved.promptParams,
        modelCode: feeResolved.model.modelCode,
        modelGroupCode: feeResolved.model.modelGroupCode,
        taskPrompt: feeResolved.taskPrompt || feeResolved.resolvedKwargs.prompt || '',
        customTaskType: 'VIDEO_CREATE',
      },
    }).catch(() => null),
    projectGroupNo ? collectPointSnapshot(projectGroupNo).catch(() => null) : Promise.resolve(null),
  ]);
  const pointEstimate = buildPointEstimate(extractPointCost(feePayload), snapshot);
  const frameFiles = parseListArg(kwargs.frameFile);
  const tailFrameFiles = parseListArg(kwargs.tailFrameFile);
  return {
    dryRun: true,
    action: 'video-create',
    projectGroupNo,
    request: {
      modelCode: model.modelCode,
      modelGroupCode: model.modelGroupCode,
      projectGroupNo,
      taskPrompt: taskPrompt || resolvedKwargs.prompt || '',
      promptParams,
      frameUrl: resolvedKwargs.frameUrl || null,
      tailFrameUrl: resolvedKwargs.tailFrameUrl || null,
      framesJson: resolvedKwargs.framesJson || null,
      promptParamsJson: resolvedKwargs.promptParamsJson || null,
    },
    ...pointEstimate,
    localFrames: {
      frameFile: await inspectLocalFiles(frameFiles),
      tailFrameFile: await inspectLocalFiles(tailFrameFiles),
    },
    localReferences: {
      refImageFiles: await inspectLocalFiles(
        parseNamedResourceSpecs(kwargs.refImageFiles, { valueKey: 'value', itemLabel: '参考图片文件' }).map((item) => item.value),
      ),
      refVideoFiles: await inspectLocalFiles(
        parseNamedResourceSpecs(kwargs.refVideoFiles, { valueKey: 'value', itemLabel: '参考视频文件' }).map((item) => item.value),
      ),
      refAudioFiles: await inspectLocalFiles(
        parseNamedResourceSpecs(kwargs.refAudioFiles, { valueKey: 'value', itemLabel: '参考音频文件' }).map((item) => item.value),
      ),
    },
  };
}

export function registerAwbCommands(cli) {
cli({
  site: SITE,
  name: 'auth-clear',
  description: commandHelp('清空本地登录令牌', {
    examples: ['opencli awb auth-clear --dryRun true', 'opencli awb auth-clear'],
    hint: '`auth-clear` 只清本地保存的 token/access key；不会清除当前 shell 里的 AWB_ACCESS_KEY / AWB_CODE。',
    dryRun: true,
  }),
  browser: false,
  args: [DRY_RUN_ARG],
  columns: ['已清空'],
  func: async (_page, kwargs) => {
    if (toBool(kwargs.dryRun)) {
      return presentAuthClearResult({
        cleared: false,
        dryRun: true,
        action: 'auth-clear',
        note: 'preview only; local auth files were not changed',
      });
    }
    await clearAuth();
    return presentAuthClearResult({ cleared: true });
  },
});

cli({
  site: SITE,
  name: 'auth-status',
  description: commandHelp('查看本地登录状态', {
    examples: ['opencli awb auth-status', 'opencli awb auth-status -f json'],
  }),
  browser: false,
  args: [],
  columns: ['登录状态', '认证方式', 'AccessKey', 'AccessKey来源', '有令牌', '有续期令牌', '过期时间', '失效原因', '更新时间'],
  func: async () => presentAuthStatus(safeAuthSummary(await loadAuth())),
});

cli({
  site: SITE,
  name: 'login-key',
  description: commandHelp('使用 AWB access key 登录', {
    examples: [
      'opencli awb login-key --accessKey <access_key>',
      'AWB_ACCESS_KEY=<access_key> opencli awb login-key --fromEnv true',
      'opencli awb login-key --accessKey <access_key> --skipVerify true',
      'opencli awb auth-status -f json',
    ],
    hint: '默认会先验证 access key 再保存；access key 会以 0600 权限保存到本地 AWB auth 文件。如果只想无状态使用，直接设置 AWB_ACCESS_KEY 即可（AWB_CODE 是旧别名，不是 user_id）。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'accessKey', help: 'AWB access key。也可设置环境变量 AWB_ACCESS_KEY（或旧别名 AWB_CODE）' },
    { name: 'fromEnv', help: '从 AWB_ACCESS_KEY / AWB_CODE 读取并保存。示例: --fromEnv true' },
    { name: 'skipVerify', help: '跳过联网验证，只保存 access key。示例: --skipVerify true' },
    DRY_RUN_ARG,
  ],
  columns: ['状态', '登录方式', '已保存', '已验证', 'AccessKey', '来源', '用户ID', '用户名'],
  func: async (_page, kwargs) => {
    const input = resolveLoginKeyInput(kwargs);
    if (!input?.accessKey) {
      throw new Error('缺少 access key。请传 `--accessKey <key>`，或设置 AWB_ACCESS_KEY 后使用 `--fromEnv true`（AWB_CODE 是旧别名）。');
    }
    const result = {
      status: 'success',
      loginMethod: 'access-key',
      saved: !toBool(kwargs.dryRun),
      verified: false,
      accessKeyPreview: maskAccessKey(input.accessKey),
      accessKeySourceText: accessKeySourceLabel(input.source, input.sourceName),
      userId: null,
      userName: null,
    };
    if (toBool(kwargs.dryRun)) {
      return presentLoginKeyResult({
        ...result,
        dryRun: true,
        action: 'login-key',
      });
    }
    const verification = toBool(kwargs.skipVerify)
      ? { verified: false, userId: null, userName: null }
      : await verifyLoginAccessKey(input.accessKey);
    await saveAuth({
      accessKey: input.accessKey,
      awbCode: input.accessKey,
      loginMethod: 'access-key',
      ...(verification.userId ? { userId: verification.userId } : {}),
      ...(verification.userName ? { userName: verification.userName } : {}),
      token: null,
      refreshToken: null,
      expiresAt: null,
      lastAuthError: null,
      authInvalidAt: null,
    });
    return presentLoginKeyResult({
      ...result,
      verified: verification.verified,
      userId: verification.userId,
      userName: verification.userName,
    });
  },
});

cli({
  site: SITE,
  name: 'login-qr',
  description: commandHelp('微信扫码登录', {
    examples: [
      'opencli awb login-qr',
      'opencli awb login-qr --waitSeconds 0 -f json',
      'opencli awb login-qr --qrSize 30',
      'opencli awb login-qr-status --sceneStr <sceneStr>',
    ],
    hint: '当前 CLI 会优先根据服务端返回的原始二维码内容直接在终端生成标准二维码，并同时打印图片链接与 sceneStr；如终端不支持，可直接打开链接扫码。',
  }),
  browser: false,
  args: [
    { name: 'waitSeconds', type: 'int', default: 180, help: '等待扫码完成的秒数。示例: 0=只取二维码链接，180=等待 3 分钟' },
    { name: 'pollIntervalMs', type: 'int', default: 2000, help: '轮询间隔毫秒数。示例: 2000' },
    { name: 'qrSize', type: 'int', default: 28, help: '终端二维码尺寸。默认更易扫码；可手动调大/调小。示例: 24、28、30、32' },
  ],
  columns: ['状态', '登录方式', '需绑定手机号', '当前团队', '团队数'],
  func: async (_page, kwargs) => {
    const qr = await apiFetch('/api/anime/user/account/wechat/mp/qrcode', {
      method: 'GET',
      auth: false,
    });
    const qrUrl = `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(qr.ticket)}`;
    const qrContent = String(qr.url || '').trim();
    const waitSeconds = toInt(kwargs.waitSeconds, 180);
    printRuntimeNote([
      '[AWB] 微信扫码登录已启动',
      `[AWB] 二维码图片链接: ${qrUrl}`,
      ...(qrContent ? [`[AWB] 二维码内容: ${qrContent}`] : []),
      `[AWB] sceneStr: ${qr.sceneStr}`,
      '[AWB] 如果只想拿到二维码链接而不等待，请使用: opencli awb login-qr --waitSeconds 0 -f json',
    ]);
    const qrRender = await renderQrImageInTerminal(qrUrl, {
      qrSize: kwargs.qrSize,
      qrContent,
    }).catch((error) => ({
      rendered: false,
      reason: error instanceof Error ? error.message : String(error),
    }));
    if (qrRender.rendered) {
      printRuntimeNote([`[AWB] 已在终端渲染二维码（尺寸 ${qrRender.targetSize ?? kwargs.qrSize}），直接用微信扫码即可。`]);
    } else {
      printRuntimeNote([`[AWB] 当前终端未渲染二维码 (${qrRender.reason})，请使用上面的图片链接扫码。`]);
    }

    if (waitSeconds <= 0) {
      return presentLoginResult({
        status: 'pending',
        loginMethod: 'wechat-qr',
        needsBind: false,
        qrUrl,
        sceneStr: qr.sceneStr,
        currentGroupName: null,
        currentGroupId: null,
        groupCount: 0,
      });
    }

    const result = await pollQrLogin(qr.sceneStr, {
      waitSeconds,
      pollIntervalMs: kwargs.pollIntervalMs,
    });
    return presentLoginResult({
      ...result,
      qrUrl,
      sceneStr: qr.sceneStr,
    });
  },
});

cli({
  site: SITE,
  name: 'login-qr-status',
  description: commandHelp('查询扫码登录状态', {
    command: 'login-qr-status',
    examples: [
      'opencli awb login-qr --waitSeconds 0 -f json',
      'opencli awb login-qr-status --sceneStr <sceneStr>',
      'opencli awb login-qr-status --sceneStr <sceneStr> --waitSeconds 10 -f json',
    ],
    hint:
      '这个命令用于轮询某一次二维码登录会话；`sceneStr` 需要先从 `login-qr --waitSeconds 0 -f json` 的返回里拿到。当返回 `needBind` 时，继续执行 `opencli awb bind-phone --phone <手机号> --code <验证码>`。',
  }),
  browser: false,
  args: [
    { name: 'sceneStr', required: true, help: '二维码登录场景 ID。示例: sceneStr 字段值' },
    { name: 'waitSeconds', type: 'int', default: 180, help: '最多等待多少秒。示例: 180' },
    { name: 'pollIntervalMs', type: 'int', default: 2000, help: '轮询间隔毫秒数。示例: 2000' },
  ],
  columns: ['状态', '登录方式', '需绑定手机号', '当前团队', '团队数'],
  func: async (_page, kwargs) => presentLoginResult(await pollQrLogin(kwargs.sceneStr, kwargs)),
});

cli({
  site: SITE,
  name: 'send-code',
  description: commandHelp('发送手机验证码', {
    examples: [
      "opencli awb send-code --phone 13800138000 --captchaVerifyParam '<aliyun-captcha>'",
    ],
    hint: '建议直接在平台完成注册/绑定手机号；这里只保留底层能力。这个接口仍然需要网站前端生成的 `captchaVerifyParam`，CLI 本身不负责过阿里云验证码。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'phone', required: true, help: '手机号。示例: 13800138000' },
    { name: 'captchaVerifyParam', required: true, help: '阿里云验证码返回值。示例: 直接粘贴前端拿到的 captchaVerifyParam' },
    { name: 'sceneId', default: SEND_CODE_SCENE_ID, help: '阿里云验证码场景 ID。通常不用改' },
    { name: 'productCode', default: SEND_CODE_PRODUCT_CODE, help: '产品编码。通常不用改' },
    DRY_RUN_ARG,
  ],
  columns: ['已发送', '手机号'],
  func: async (_page, kwargs) => {
    if (toBool(kwargs.dryRun)) {
      return withAliases({
        dryRun: true,
        action: 'send-code',
        sent: false,
        phone: kwargs.phone,
        request: {
          phone: kwargs.phone,
          productCode: toInt(kwargs.productCode, SEND_CODE_PRODUCT_CODE),
          captchaVerifyParam: kwargs.captchaVerifyParam,
          SceneId: kwargs.sceneId || SEND_CODE_SCENE_ID,
        },
      }, { sent: '已发送', phone: '手机号' });
    }
    await apiFetch('/api/anime/user/account/sendVerifyCode', {
      auth: false,
      body: {
        phone: kwargs.phone,
        productCode: toInt(kwargs.productCode, SEND_CODE_PRODUCT_CODE),
        captchaVerifyParam: kwargs.captchaVerifyParam,
        SceneId: kwargs.sceneId || SEND_CODE_SCENE_ID,
      },
    });
    return withAliases({ sent: true, phone: kwargs.phone }, { sent: '已发送', phone: '手机号' });
  },
});

cli({
  site: SITE,
  name: 'phone-login',
  description: commandHelp('手机验证码登录', {
    examples: ['opencli awb phone-login --phone 13800138000 --code 123456'],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'phone', required: true, help: '手机号。示例: 13800138000' },
    { name: 'code', required: true, help: '短信验证码。示例: 123456' },
    DRY_RUN_ARG,
  ],
  columns: ['状态', '登录方式', '当前团队', '团队数'],
  func: async (_page, kwargs) => {
    if (toBool(kwargs.dryRun)) {
      return presentLoginResult({
        status: 'dry-run',
        loginMethod: 'phone',
        needsBind: false,
        currentGroupName: null,
        currentGroupId: null,
        groupCount: 0,
        dryRun: true,
        action: 'phone-login',
        request: { phone: kwargs.phone, code: '<hidden>' },
      });
    }
    const data = await apiFetch('/api/anime/user/account/phoneLogin', {
      auth: false,
      body: {
        phone: kwargs.phone,
        code: kwargs.code,
      },
    });
    await saveLoginPayload(data, { loginMethod: 'phone' });
    const me = await currentUserSummary().catch(() => ({}));
    return presentLoginResult({
      status: 'success',
      loginMethod: 'phone',
      needsBind: false,
      qrUrl: null,
      sceneStr: null,
      currentGroupName: me.currentGroupName ?? null,
      currentGroupId: me.currentGroupId ?? null,
      groupCount: Array.isArray(data?.groupMembers) ? data.groupMembers.length : 0,
    });
  },
});

cli({
  site: SITE,
  name: 'bind-phone',
  description: commandHelp('绑定手机号', {
    examples: ['opencli awb bind-phone --phone 13800138000 --code 123456'],
    hint: '建议直接在平台完成绑定手机号；如果仍需走 CLI，且不传 `--tempToken`，会自动使用最近一次 `login-qr` 保存下来的临时 token。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'phone', required: true, help: '手机号。示例: 13800138000' },
    { name: 'code', required: true, help: '短信验证码。示例: 123456' },
    { name: 'tempToken', help: '扫码登录返回 `needBind` 时的临时 token。通常可留空' },
    DRY_RUN_ARG,
  ],
  columns: ['状态', '登录方式', '当前团队', '团队数'],
  func: async (_page, kwargs) => {
    const auth = await loadAuth();
    const tempToken = kwargs.tempToken || auth?.tempToken;
    if (toBool(kwargs.dryRun)) {
      return presentLoginResult({
        status: 'dry-run',
        loginMethod: 'wechat-bind-phone',
        needsBind: false,
        currentGroupName: null,
        currentGroupId: null,
        groupCount: 0,
        dryRun: true,
        action: 'bind-phone',
        request: { phone: kwargs.phone, code: '<hidden>', tempToken: tempToken ? '<hidden>' : '<not-provided>' },
      });
    }
    if (!tempToken) {
      throw new Error(`No temp token found. Use \`${runtimeCommandPrefix()} login-qr\` first and wait for \`needBind\`.`);
    }

    const data = await apiFetch('/api/anime/user/account/wechat/bindPhone', {
      auth: false,
      body: {
        phone: kwargs.phone,
        code: kwargs.code,
        tempToken,
      },
    });
    await saveLoginPayload(data, { loginMethod: 'wechat-bind-phone', tempToken: undefined });
    const me = await currentUserSummary().catch(() => ({}));
    return presentLoginResult({
      status: 'success',
      loginMethod: 'wechat-bind-phone',
      needsBind: false,
      qrUrl: null,
      sceneStr: null,
      currentGroupName: me.currentGroupName ?? null,
      currentGroupId: me.currentGroupId ?? null,
      groupCount: Array.isArray(data?.groupMembers) ? data.groupMembers.length : 0,
    });
  },
});

cli({
  site: SITE,
  name: 'me',
  description: commandHelp('查看当前账号信息', {
    examples: ['opencli awb me', 'opencli awb me -f json'],
  }),
  browser: false,
  args: [],
  columns: [
    '用户名',
    '权限',
    '当前团队',
    '当前项目组',
    '团队积分',
    '项目组积分',
    '登录有效期',
  ],
  func: async () => presentCurrentUserSummary(await currentUserSummary()),
});

cli({
  site: SITE,
  name: 'teams',
  description: commandHelp('列出可用团队', {
    examples: ['opencli awb teams', 'opencli awb teams -f json'],
  }),
  browser: false,
  args: [],
  columns: ['团队ID', '团队名称', '关系类型', '当前选中'],
  func: async () => {
    const groups = await apiFetch('/api/anime/user/group/getOwnGroupList', {
      body: {},
    });
    return presentTeamRows(normalizeRows(Array.isArray(groups) ? groups : []));
  },
});

cli({
  site: SITE,
  name: 'team-select',
  description: commandHelp('切换当前团队', {
    examples: ['opencli awb team-select --groupId <groupId>'],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'groupId', required: true, help: '目标团队 groupId。示例: cd8fa7f8fd73421b8bbdae10bc9f5e56' },
    DRY_RUN_ARG,
  ],
  columns: ['用户名', '当前团队', '团队积分'],
  func: async (_page, kwargs) => {
    if (toBool(kwargs.dryRun)) {
      return withAliases({
        dryRun: true,
        action: 'team-select',
        userName: null,
        currentGroupName: kwargs.groupId,
        teamPointBalance: null,
        request: { groupId: kwargs.groupId },
      }, {
        userName: '用户名',
        currentGroupName: '当前团队',
        teamPointBalance: '团队积分',
      });
    }
    const response = await apiFetch('/api/anime/user/group/updateCurrentGroup', {
      body: { groupId: kwargs.groupId },
    });
    if (response?.token || response?.session || response?.expires) {
      await saveLoginPayload(response, { currentGroupId: kwargs.groupId });
    }
    return withAliases(await currentUserSummary(), {
      userName: '用户名',
      currentGroupName: '当前团队',
      teamPointBalance: '团队积分',
    });
  },
});

cli({
  site: SITE,
  name: 'project-groups',
  description: commandHelp('列出项目组', {
    examples: ['opencli awb project-groups', 'opencli awb project-groups -f json'],
  }),
  browser: false,
  args: [],
  columns: ['项目组编号', '项目组名称', '当前选中', '最近使用'],
  func: async () => {
    const { list, lastProjectGroupNo } = await getProjectGroupsPayload();
    const state = await loadState();
    const selectedProjectGroupNo = lastProjectGroupNo ?? state?.currentProjectGroupNo ?? null;
    if (selectedProjectGroupNo) {
      await saveState({ currentProjectGroupNo: selectedProjectGroupNo });
    }
    return presentProjectGroupRows(list.map((item) => ({
      ...normalizeProjectGroupRecord(item, selectedProjectGroupNo),
      isLastSelected:
        (item?.projectGroupNo ?? item?.no ?? null) === lastProjectGroupNo,
    })));
  },
});

cli({
  site: SITE,
  name: 'project-group-users',
  description: commandHelp('列出项目组可选成员', {
    examples: ['opencli awb project-group-users -f json'],
  }),
  browser: false,
  args: [],
  columns: ['用户ID', '用户名', '角色', '已选中'],
  func: async () => {
    const payload = await apiFetch('/api/anime/workbench/projectGroup/getGroupAllUser', {
      method: 'GET',
    });
    return presentProjectGroupUserRows(normalizeRows(Array.isArray(payload) ? payload : []));
  },
});

cli({
  site: SITE,
  name: 'project-group-create',
  description: commandHelp('创建并切换项目组', {
    examples: [
      'opencli awb project-group-create --name "CLI 项目组"',
      'opencli awb project-group-create --name "CLI 项目组" --point 1000 --dryRun true',
    ],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'name', required: true, help: '项目组名称。示例: CLI 项目组' },
    { name: 'point', default: 0, help: '项目积分上限。示例: 0 或 1000' },
    { name: 'userIds', help: '额外成员 userId，多个用逗号分隔。示例: id1,id2' },
    { name: 'membersJson', help: '直接覆盖 groupUser 请求体的 JSON 数组' },
    DRY_RUN_ARG,
  ],
  columns: ['项目组编号', '项目组名称', '项目组余额', '项目组上限', '成员数'],
  func: async (_page, kwargs) =>
    presentProjectGroupSummary(
      toBool(kwargs.dryRun) ? await previewProjectGroupCreate(kwargs) : await createProjectGroup(kwargs),
    ),
});

cli({
  site: SITE,
  name: 'project-group-select',
  description: commandHelp('切换项目组', {
    examples: ['opencli awb project-group-select --projectGroupNo <projectGroupNo>'],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'projectGroupNo', required: true, help: '目标项目组编号。示例: 12956e17aa624d8d8addde3b0be9f633' },
    DRY_RUN_ARG,
  ],
  columns: ['项目组编号', '项目组名称', '项目组余额', '项目组上限'],
  func: async (_page, kwargs) => {
    if (toBool(kwargs.dryRun)) {
      return presentProjectGroupSummary({
        dryRun: true,
        action: 'project-group-select',
        projectGroupNo: kwargs.projectGroupNo,
        projectGroupName: null,
        pointBalance: null,
        projectGroupIntegralMax: null,
        request: { projectGroupNo: kwargs.projectGroupNo },
      });
    }
    await apiFetch('/api/anime/workbench/projectGroup/setLastProjectGroup', {
      body: { projectGroupNo: kwargs.projectGroupNo },
    });
    await saveState({ currentProjectGroupNo: kwargs.projectGroupNo });
    return presentProjectGroupSummary(await fetchProjectGroupSummary(kwargs.projectGroupNo));
  },
});

cli({
  site: SITE,
  name: 'project-group-current',
  description: commandHelp('查看当前项目组', {
    examples: ['opencli awb project-group-current -f json'],
  }),
  browser: false,
  args: [],
  columns: ['项目组编号', '项目组名称', '项目组余额', '项目组上限'],
  func: async () => presentProjectGroupSummary(await fetchProjectGroupSummary()),
});

cli({
  site: SITE,
  name: 'project-group-update',
  description: commandHelp('修改项目组名称或积分上限', {
    examples: [
      'opencli awb project-group-update --projectGroupNo <projectGroupNo> --point 1000',
      'opencli awb project-group-update --name "新项目组名" --point 2000 --dryRun true',
    ],
    hint: '统一入口：改名称、改积分上限、后续也适合继续扩到成员调整。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'projectGroupNo', help: '项目组编号；不传则使用当前项目组' },
    { name: 'name', help: '新的项目组名称' },
    { name: 'point', help: '新的项目组积分上限。示例: 1000' },
    DRY_RUN_ARG,
  ],
  columns: ['项目组编号', '项目组名称', '项目组余额', '项目组上限', '已更新'],
  func: async (_page, kwargs) =>
    presentProjectGroupSummary(
      toBool(kwargs.dryRun) ? await previewProjectGroupUpdate(kwargs) : await updateProjectGroup(kwargs),
    ),
});

cli({
  site: SITE,
  name: 'points',
  description: commandHelp('查看积分总览（团队 + 当前项目组）', {
    examples: ['opencli awb points', 'opencli awb points -f json'],
    hint: '这个命令用于排查“为什么团队有积分但生图/生视频仍失败”。重点看 `projectPointBalance` 和 `projectPointMax`。',
  }),
  browser: false,
  args: [],
  columns: ['团队积分', '项目组积分', '项目组上限', '当前项目组'],
  func: async () => {
    const payload = await apiFetch('/api/anime/member/benefits/queryGroupPoint', {
      body: {},
    });
    const projectGroup = await fetchProjectGroupSummary().catch(() => null);
    return presentPointSummary({
      pointBalance: extractPointBalance(payload),
      teamPointBalance: extractPointBalance(payload),
      projectPointBalance: projectGroup?.projectGroupIntegralCurrent ?? null,
      projectPointMax: projectGroup?.projectGroupIntegralMax ?? null,
      currentProjectGroupNo: projectGroup?.projectGroupNo ?? null,
      currentProjectGroupName: projectGroup?.projectGroupName ?? null,
      raw: JSON.stringify({
        team: payload,
        projectGroup,
      }),
    });
  },
});

cli({
  site: SITE,
  name: 'usage-summary',
  description: commandHelp('按项目组汇总图片/视频任务数与积分消耗', {
    examples: [
      'opencli awb usage-summary --projectGroupNo <projectGroupNo> --since "2026-04-27 00:00:00"',
      'opencli awb usage-summary --projectGroupNo <projectGroupNo> --sinceMs 1777219200000 --startProjectPointBalance 10000 --pointPriceYuan 0.1 -f json',
      'AWB_PROJECT_GROUP_NO=<projectGroupNo> AWB_USAGE_STARTED_AT=1777219200000 AWB_START_PROJECT_POINT_BALANCE=10000 opencli awb usage-summary -f json',
    ],
    hint: '任务数按项目组实时查询；积分优先用启动余额 - 当前余额，未提供启动余额时回退为成功任务 pointNo 合计。默认按 1 积分 = 0.1 元折算。',
  }),
  browser: false,
  args: [
    { name: 'projectGroupNo', help: '项目组编号。也可用 AWB_PROJECT_GROUP_NO / PROJECT_GROUP_NO / SANDBOX_PROJECT_GROUP_NO' },
    { name: 'since', help: '开始时间，支持 ISO 或 `2026-04-27 00:00:00`（按 +08:00 解析）' },
    { name: 'sinceMs', help: '开始时间戳，毫秒或秒。优先级高于 since' },
    { name: 'until', help: '结束时间，默认当前时间' },
    { name: 'untilMs', help: '结束时间戳，毫秒或秒。优先级高于 until' },
    { name: 'lastHours', help: '不传 since 时可查最近 N 小时。示例: --lastHours 24' },
    { name: 'startProjectPointBalance', help: '项目启动时项目组余额；也可用 AWB_START_PROJECT_POINT_BALANCE' },
    { name: 'startBalance', help: 'startProjectPointBalance 的简写别名' },
    { name: 'pointPriceYuan', help: '每积分人民币单价，用于估算金额。默认 0.1；也可用 AWB_POINT_PRICE_YUAN' },
    { name: 'yuanPerPoint', help: 'pointPriceYuan 的简写别名' },
    { name: 'pageSize', type: 'int', default: 100, help: '每次拉取任务数，最大 200。默认: 100' },
    { name: 'maxPages', type: 'int', default: 20, help: '每类任务最多翻页数。默认: 20' },
    { name: 'includeTasks', help: '是否在 JSON 中附带扫描到的任务明细。示例: --includeTasks true' },
  ],
  columns: ['项目组', '开始时间', '图片任务', '图片结果', '图片积分', '图片金额(元)', '视频任务', '视频结果', '视频积分', '视频金额(元)', '消耗积分', '消耗金额(元)', '未归因积分', '未归因金额(元)', '任务积分合计', '余额消耗', '余额增加', '当前项目组积分'],
  func: async (_page, kwargs) => buildUsageSummary(kwargs),
});

cli({
  site: SITE,
  name: 'point-packages',
  description: commandHelp('列出积分包', {
    examples: ['opencli awb point-packages', 'opencli awb point-packages -f json'],
    hint: '默认按平台当前积分方案实时请求；若平台偶发异常，则自动回退到最近一次成功缓存。',
  }),
  browser: false,
  args: [],
  columns: ['套餐编号', '套餐名称', '支付方式', '价格(元)', '积分', '标签', '来源'],
  func: async () => {
    try {
      const payload = await apiFetch('/api/anime/member/benefits/queryPointPackage', {
        body: { packageType: 12 },
      });
      const rows = normalizePointPackageRows(firstArray(payload), 'api');
      if (rows.length) {
        await savePointPackageCache(rows);
      }
      return presentPointPackageRows(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('未知异常')) {
        const fallbackRows =
          (await loadPointPackageCache())?.length
            ? await loadPointPackageCache()
            : await loadPointPackageRecordFallback();
        if (fallbackRows.length) {
          printRuntimeNote(['[AWB] 实时积分包接口当前未返回可用数据，已回退到最近一次同步缓存。']);
          return presentPointPackageRows(fallbackRows.map((item) => ({
            ...item,
            source: 'cache',
          })));
        }
        throw new Error('平台当前未返回可用积分包数据。通常是该账号/团队未开通购买，或平台接口本身异常。若你刚用浏览器抓到过套餐页，可重试本命令读取缓存。');
      }
      throw error;
    }
  },
});

cli({
  site: SITE,
  name: 'point-records',
  description: commandHelp('查询积分记录', {
    examples: [
      'opencli awb point-records',
      'opencli awb point-records --operation 消耗',
      'opencli awb point-records --operation 获得 -f json',
    ],
    hint: '支持 `全部 / 消耗 / 获得`；也兼容 `all / expend / expand / recharge`。会优先实时请求，失败后回退到最近一次缓存。',
  }),
  browser: false,
  args: [
    { name: 'current', type: 'int', default: 1, help: '页码。默认: 1' },
    { name: 'size', type: 'int', default: 10, help: '每页条数。默认: 10' },
    { name: 'operation', default: '全部', help: '记录类型：全部 / 消耗 / 获得。也接受 all / expend / expand / recharge。' },
    { name: 'requestJson', help: '直接覆盖请求体 JSON。示例: {"queryType":2,"page":1,"size":10}' },
  ],
  columns: ['类型', '标题', '积分', '时间', '来源'],
  func: async (_page, kwargs) => {
    const normalizedOperation = normalizePointRecordOperation(kwargs.operation);
    const body = normalizePointRecordRequestBody(
      parseJsonArg(kwargs.requestJson, null) ?? {
        page: toInt(kwargs.current, 1),
        size: toInt(kwargs.size, 10),
        queryType: resolvePointRecordQueryType(normalizedOperation),
      },
      normalizedOperation,
    );
    try {
      const payload = await apiFetch('/api/anime/member/benefits/queryPointRecord', {
        body,
      });
      const rows = normalizePointRecordRows(payload, 'api');
      if (rows.length) {
        const cache = (await loadPointRecordCache()) ?? {};
        cache[normalizedOperation || 'all'] = {
          rows,
          meta: {
            current: payload?.current ?? null,
            size: payload?.size ?? null,
            total: payload?.total ?? null,
            pages: payload?.pages ?? null,
            remainPoint: payload?.remainPoint ?? null,
          },
        };
        await savePointRecordCache(cache);
      }
      return presentPointRecordRows(rows);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('未知异常')) {
        const cache = Object.keys((await loadPointRecordCache()) ?? {}).length
          ? await loadPointRecordCache()
          : await loadPointRecordFallback();
        const snapshot = cache?.[normalizedOperation || 'all'];
        if (Array.isArray(snapshot?.rows) && snapshot.rows.length) {
          printRuntimeNote(['[AWB] 实时积分记录接口当前未返回可用数据，已回退到最近一次同步缓存。']);
          return presentPointRecordRows(snapshot.rows.map((item) => ({
            ...item,
            source: 'cache',
          })));
        }
        throw new Error('平台当前未返回积分记录数据。建议先在网页里打开积分记录页点一次 `全部 / 消耗 / 获得`，再重试本命令读取缓存。');
      }
      throw error;
    }
  },
});

cli({
  site: SITE,
  name: 'point-purchase',
  description: commandHelp('购买积分套餐并输出支付二维码', {
    examples: [
      'opencli awb point-purchase --packageNo b7ab4b0f3ce1495d860c7bc034f2ab2f',
      'opencli awb point-purchase --packageNo b7ab4b0f3ce1495d860c7bc034f2ab2f --waitSeconds 120 -f json',
    ],
    hint: '目前最小请求体只需要 `packageNo`；会在终端直接渲染微信支付二维码。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'packageNo', required: true, help: '积分套餐 packageNo。可先用 `opencli awb point-packages` 查看。' },
    { name: 'waitSeconds', type: 'int', default: 0, help: '下单后轮询支付状态的秒数。0=仅生成二维码。示例: 120' },
    { name: 'pollIntervalMs', type: 'int', default: 1500, help: '支付状态轮询间隔毫秒。示例: 1500' },
    { name: 'qrSize', type: 'int', default: 24, help: '终端支付二维码尺寸。示例: 24、28、32' },
    DRY_RUN_ARG,
  ],
  columns: ['套餐编号', '订单号', '支付状态码', '支付状态', '过期时间'],
  func: async (_page, kwargs) => {
    const packageNo = String(kwargs.packageNo || '').trim();
    if (!packageNo) {
      throw new Error(`缺少 packageNo。请先执行 ${runtimeCommandPrefix()} point-packages 查看套餐编号。`);
    }
    if (toBool(kwargs.dryRun)) {
      return presentPointOrder({
        dryRun: true,
        action: 'point-purchase',
        packageNo,
        rechargeNo: null,
        payStatus: null,
        payStatusText: 'dry-run',
        expireTime: null,
        request: { packageNo },
      });
    }

    const payload = await apiFetch('/api/anime/member/order/recharge', {
      body: { packageNo },
    });
    const rechargeNo = payload?.rechargeNo ?? null;
    const payUrl = payload?.payUrl ?? null;
    const expireTime = payload?.expireTime ?? null;

    printRuntimeNote([
      '[AWB] 已创建积分支付订单',
      `[AWB] packageNo: ${packageNo}`,
      ...(rechargeNo ? [`[AWB] rechargeNo: ${rechargeNo}`] : []),
      ...(expireTime ? [`[AWB] 订单过期时间: ${expireTime}`] : []),
      ...(payUrl ? [`[AWB] 支付链接: ${payUrl}`] : []),
      ...(rechargeNo ? [`[AWB] 可用以下命令查询支付状态: ${runtimeCommandPrefix()} point-pay-status --rechargeNo ${rechargeNo}`] : []),
    ]);

    if (payUrl) {
      const qrRender = await renderQrImageInTerminal('', {
        qrSize: kwargs.qrSize,
        qrContent: payUrl,
      }).catch((error) => ({
        rendered: false,
        reason: error instanceof Error ? error.message : String(error),
      }));
      if (qrRender.rendered) {
        printRuntimeNote([`[AWB] 已在终端渲染支付二维码（尺寸 ${qrRender.targetSize ?? kwargs.qrSize}）。`]);
      } else {
        printRuntimeNote([`[AWB] 当前终端未渲染支付二维码 (${qrRender.reason})，请复制支付链接自行生成二维码。`]);
      }
    }

    const status = rechargeNo
      ? await pollPayStatus(rechargeNo, {
          waitSeconds: kwargs.waitSeconds,
          pollIntervalMs: kwargs.pollIntervalMs,
        })
      : null;

    return presentPointOrder({
      packageNo,
      rechargeNo,
      payUrl,
      expireTime,
      payStatus: status?.payStatus ?? 10,
      payStatusText: status?.payStatusText ?? '待支付',
      timedOut: status?.timedOut ?? false,
      raw: JSON.stringify({
        create: payload,
        status,
      }),
    });
  },
});

cli({
  site: SITE,
  name: 'point-pay-status',
  description: commandHelp('查询积分支付订单状态', {
    examples: [
      'opencli awb point-pay-status --rechargeNo dc4cad9604164acc8d0b8a7753c09278',
      'opencli awb point-pay-status --rechargeNo dc4cad9604164acc8d0b8a7753c09278 --waitSeconds 60 -f json',
    ],
    hint: '创建订单后，可用 `rechargeNo` 轮询是否支付成功。',
  }),
  browser: false,
  args: [
    { name: 'rechargeNo', required: true, help: '支付订单号 rechargeNo。可由 `point-purchase` 返回。' },
    { name: 'waitSeconds', type: 'int', default: 0, help: '持续轮询秒数。0=只查一次。示例: 60' },
    { name: 'pollIntervalMs', type: 'int', default: 1500, help: '轮询间隔毫秒。示例: 1500' },
  ],
  columns: ['订单号', '支付状态码', '支付状态', '是否超时'],
  func: async (_page, kwargs) => {
    const rechargeNo = String(kwargs.rechargeNo || '').trim();
    if (!rechargeNo) {
      throw new Error('缺少 `rechargeNo`。');
    }
    return presentPointOrder(await pollPayStatus(rechargeNo, {
      waitSeconds: kwargs.waitSeconds,
      pollIntervalMs: kwargs.pollIntervalMs,
    }));
  },
});

cli({
  site: SITE,
  name: 'invoice-apply',
  description: commandHelp('提交开票申请', {
    examples: [
      'opencli awb invoice-apply --amountYuan 98.00 --invoiceType 普通发票 --subjectType 企业 --buyerName "灵境测试公司" --buyerTaxNo 91310000TEST12345X --remark 无 --proofFile ./payment.png --tradeNo 4200002504202604011234567890 --phone 13800138000 --email finance@example.com --wechatName lingjing-finance',
      'opencli awb invoice-apply --amountYuan 98.00 --invoiceType 专票 --subjectType 企业 --buyerName "灵境测试公司" --buyerTaxNo 91310000TEST12345X --remark "2026年4月充值开票" --proofFile ./payment.png --tradeNo 4200002504202604011234567890 --phone 13800138000 --email finance@example.com --wechatName lingjing-finance --dryRun true -f json',
    ],
    hint: '该命令会复用本机浏览器里的飞书登录态，但不会要求你手动打开网页。若提示飞书未登录，请先在 Dia/Chrome 登录飞书并打开过一次开票表单。',
    dryRun: true,
  }),
  browser: true,
  navigateBefore: false,
  args: [
    { name: 'amountYuan', required: true, help: '开票总金额（含税），按元填写。示例: 98.00' },
    { name: 'invoiceType', required: true, help: '发票类型：普通发票 / 增值税专用发票。也接受：普票 / 专票。' },
    { name: 'subjectType', required: true, help: '主体类型：企业 / 个人。' },
    { name: 'buyerName', required: true, help: '购买方名称。企业填公司名，个人填个人名称。' },
    { name: 'buyerTaxNo', required: true, help: '购买方统一社会信用代码 / 纳税人识别号。' },
    { name: 'remark', required: true, help: '发票备注；若无备注请明确填写 `无`。' },
    { name: 'proofFile', required: true, help: '付款凭证本地文件路径。支持图片/PDF/文本等本地文件。' },
    { name: 'tradeNo', required: true, help: '交易单号；微信支付可填付款凭证中的交易单号。' },
    { name: 'phone', required: true, help: '平台注册手机号。' },
    { name: 'email', required: true, help: '收票电子邮箱。' },
    { name: 'wechatName', required: true, help: '微信号或昵称，便于财务联系。' },
    DRY_RUN_ARG,
  ],
  columns: ['已提交', '发票类型', '主体类型', '金额(元)', '购买方名称', '凭证文件名', '凭证文件Token'],
  func: async (page, kwargs) => {
    const attachmentPreview = await inspectLocalFileInfo(kwargs.proofFile);
    const { invoiceType, subjectType, payload } = buildInvoiceFormPayload(kwargs, [
      {
        name: attachmentPreview.fileName,
        mimeType: attachmentPreview.mimeType,
        size: attachmentPreview.size,
      },
    ]);
    if (toBool(kwargs.dryRun)) {
      return presentInvoiceApplyResult({
        dryRun: true,
        action: 'invoice-apply',
        formUrl: AWB_INVOICE_FORM_URL,
        invoiceType: invoiceType.label,
        subjectType: subjectType.label,
        proofFile: attachmentPreview.filePath,
        proofFileName: attachmentPreview.fileName,
        proofFileSize: attachmentPreview.size,
        request: payload,
      });
    }
    printRuntimeNote([
      '[AWB] 正在上传开票凭证并提交申请...',
      `[AWB] 发票类型: ${invoiceType.label}`,
      `[AWB] 主体类型: ${subjectType.label}`,
      `[AWB] 付款凭证: ${attachmentPreview.fileName}`,
    ]);
    return presentInvoiceApplyResult(await submitInvoiceForm(page, kwargs));
  },
});

cli({
  site: SITE,
  name: 'redeem',
  description: commandHelp('兑换积分码', {
    examples: ['opencli awb redeem --code XXXX-XXXX-XXXX-XXXX'],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'code', required: true, help: '兑换码。格式: XXXX-XXXX-XXXX-XXXX' },
    DRY_RUN_ARG,
  ],
  columns: ['已兑换', '兑换码', '团队积分'],
  func: async (_page, kwargs) => {
    const code = normalizeCode(kwargs.code);
    if (!REDEEM_CODE_RE.test(code)) {
      throw new Error('Invalid code format. Expected XXXX-XXXX-XXXX-XXXX.');
    }
    if (toBool(kwargs.dryRun)) {
      return presentRedeemResult({
        dryRun: true,
        action: 'redeem',
        redeemed: false,
        code,
        teamPointBalance: null,
        request: { code },
      });
    }
    await apiFetch('/api/anime/member/redemption/redeemCode', {
      query: { code },
      body: {},
    });
    const points = await apiFetch('/api/anime/member/benefits/queryGroupPoint', {
      body: {},
    });
    return presentRedeemResult({
      redeemed: true,
      code,
      teamPointBalance: extractPointBalance(points),
    });
  },
});

cli({
  site: SITE,
  name: 'model-options',
  description: commandHelp('查看模型参数定义', {
    quickStart: [
      '先从 `image-models` 或 `video-models` 里复制 `modelGroupCode`',
      '再查当前模型模式、关键约束和 CLI 示例',
      '注意：左列是服务端底层参数名，右列是当前 CLI 推荐入口，不一定同名',
    ],
    examples: [
      'opencli awb model-options --modelGroupCode <g>',
      'opencli awb model-options --modelCode <m> -f json',
    ],
  }),
  browser: false,
  args: [
    { name: 'modelCode', help: '模型编码。可只传这个；若存在多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '模型组编码。推荐优先传这个；它在平台里是唯一的' },
    { name: 'selectedConfigsJson', default: '{}', help: '可选：带上已选参数再查询剩余参数定义。示例: \'{"quality":"720","generated_mode":"multi_param"}\'' },
  ],
  columns: ['底层参数', '名称', '类型', '约束', '推荐CLI用法'],
  func: async (_page, kwargs) => {
    ensureModelSelector('model-options', kwargs);
    const model = await resolveModelSelection('generic', kwargs);
    if (model.externalProvider === 'aihubmix') {
      const rows = model.modelCode === 'happyhorse-1.0-r2v'
        ? [
            { paramKey: 'input.prompt', paramName: '提示词', paramType: 'Prompt', cliFlag: '--prompt "character1 在雨夜奔跑"', allowedValues: '', 底层参数: 'input.prompt', 名称: '提示词', 类型: 'Prompt', 约束: '必填；最多 5000 个非中文字符或 2500 个中文字符；character1/character2 按 media 顺序指代参考图', 推荐CLI用法: '--prompt "character1 在雨夜奔跑"', raw: JSON.stringify({ required: true }) },
            { paramKey: 'input.media', paramName: '参考图', paramType: 'UrlList', cliFlag: '--refImageUrls "character1=https://example.com/a.jpg"', allowedValues: '1-9 images; JPEG/JPG/PNG/WEBP; HTTP/HTTPS URL', 底层参数: 'input.media', 名称: '参考图', 类型: 'UrlList', 约束: '必填 1-9 张公网图片 URL；短边 >= 400px；单张 <= 10MB', 推荐CLI用法: '--refImageUrls "character1=https://example.com/a.jpg"', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'parameters.resolution', paramName: '分辨率档位', paramType: 'EnumType', cliFlag: '--quality 1080P', allowedValues: '1080P, 720P', 底层参数: 'parameters.resolution', 名称: '分辨率档位', 类型: 'EnumType', 约束: '默认 1080P', 推荐CLI用法: '--quality 1080P', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'parameters.ratio', paramName: '视频比例', paramType: 'EnumType', cliFlag: '--ratio 16:9', allowedValues: '16:9, 9:16, 3:4, 4:3, 1:1', 底层参数: 'parameters.ratio', 名称: '视频比例', 类型: 'EnumType', 约束: '默认 16:9', 推荐CLI用法: '--ratio 16:9', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'parameters.duration', paramName: '时长', paramType: 'Integer', cliFlag: '--generatedTime 5', allowedValues: '3-15', 底层参数: 'parameters.duration', 名称: '时长', 类型: 'Integer', 约束: '单位秒；整数 3-15；默认 5', 推荐CLI用法: '--generatedTime 5', raw: JSON.stringify({ provider: 'aihubmix' }) },
          ]
        : [
            { paramKey: 'prompt', paramName: '提示词', paramType: 'Prompt', cliFlag: '--prompt "..."', allowedValues: '', 底层参数: 'prompt', 名称: '提示词', 类型: 'Prompt', 约束: '必填', 推荐CLI用法: '--prompt "..."', raw: JSON.stringify({ required: true }) },
            { paramKey: 'seconds', paramName: '时长', paramType: 'EnumType', cliFlag: '--generatedTime 5', allowedValues: '2-15', 底层参数: 'seconds', 名称: '时长', 类型: 'EnumType', 约束: '传给 AiHubMix 的 seconds', 推荐CLI用法: '--generatedTime 5', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'size', paramName: '分辨率', paramType: 'EnumType', cliFlag: '--size 1280x720', allowedValues: '1280x720, 720x1280, 960x960, 960x720, 720x960', 底层参数: 'size', 名称: '分辨率', 类型: 'EnumType', 约束: '默认按 ratio 映射；可直接传 --size', 推荐CLI用法: '--size 1280x720', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'input_reference', paramName: '首帧/图片参考', paramType: 'UrlOrBase64', cliFlag: '--frameUrl <url> / --frameFile ./a.webp', allowedValues: '', 底层参数: 'input_reference', 名称: '首帧/图片参考', 类型: 'UrlOrBase64', 约束: model.modelCode.endsWith('-i2v') ? '图生视频必填；视频比例跟随原图' : '按模型需要', 推荐CLI用法: '--frameUrl <url> / --frameFile ./a.webp', raw: JSON.stringify({ provider: 'aihubmix' }) },
            { paramKey: 'extra_body.content', paramName: '多模态参考', paramType: 'ReferenceList', cliFlag: '--refVideoUrls <url>', allowedValues: 'video_url', 底层参数: 'extra_body.content', 名称: '多模态参考', 类型: 'ReferenceList', 约束: 'video-edit 使用；本地文件会转 data URL', 推荐CLI用法: '--refVideoUrls <url>', raw: JSON.stringify({ provider: 'aihubmix' }) },
          ];
      printModelOptionSummary(model, null, rows, 'video');
      return rows;
    }
    const kind = inferModelKind(model.modelCode, model.modelGroupCode);
    const modelDefinition = await fetchResolvedModelDefinition(model, '');
    const payload = await apiFetch('/api/resource/model/config/options', {
      body: {
        modelCode: model.modelCode,
        modelGroupCode: model.modelGroupCode,
        selectedConfigs: parseJsonArg(kwargs.selectedConfigsJson, {}) ?? {},
      },
    });
    const rows = normalizeModelOptionRows(payload, kind, modelDefinition);
    printModelOptionSummary(model, modelDefinition, rows, kind);
    return rows;
  },
});

cli({
  site: SITE,
  name: 'image-models',
  description: commandHelp('列出生图模型', {
    quickStart: [
      '如果你已经知道模型名，可先用 `--model "<关键词>"` 过滤',
      '真正创建时优先复制 `modelGroupCode`，不必再记 `modelCode`',
      '输出里的中文列会直接标出该模型是否支持 `iref` / `cref` / `sref`',
    ],
    examples: ['opencli awb image-models', 'opencli awb image-models --model "Nano Banana 2"'],
  }),
  browser: false,
  args: [
    { name: 'source', default: 'usage', choices: ['catalog', 'usage'] },
    { name: 'model', help: '按模型名 / 分组码 / 提供方关键词过滤。示例: "Nano Banana 2" / "即梦" / "Discount"' },
    { name: 'provider', help: '按提供方过滤。示例: Google / 字节跳动' },
    { name: 'taskPrompt', default: '' },
  ],
  columns: [
    '模型',
    '提供方',
    '参考图',
    '通道',
    '模型组',
    '成功率',
  ],
  func: async (_page, kwargs) => {
    const viewerPermission = await resolveViewerPermission(kwargs);
    const source = kwargs.source || 'usage';
    const payload =
      source === 'usage'
        ? await apiFetch('/api/resource/model/list/usage/IMAGE_CREATE', {
            body: { taskPrompt: kwargs.taskPrompt || '' },
          })
        : await apiFetch('/api/material/creation/model/listIgnoreDelete', {
            method: 'GET',
            query: { taskType: 'IMAGE_CREATE' },
          });
    const rows = filterModelRows(normalizeModelRows(payload), { ...kwargs, viewerPermission });
    printModelListHint('image', rows);
    return rows;
  },
});

cli({
  site: SITE,
  name: 'video-models',
  description: commandHelp('列出生视频模型', {
    quickStart: [
      '如果你已经知道模型名，可先用 `--model "<关键词>"` 过滤',
      '真正创建时优先复制 `modelGroupCode`，不必再记 `modelCode`',
      '输出里的中文列会直接标出首帧、首尾帧、多参考、故事板、音效开关等能力',
    ],
    examples: ['opencli awb video-models', 'opencli awb video-models --model "即梦 3.0 Pro"'],
  }),
  browser: false,
  args: [
    { name: 'source', default: 'usage', choices: ['catalog', 'usage'] },
    { name: 'model', help: '按模型名 / 分组码 / 提供方关键词过滤。示例: "Veo 3.1" / "可灵" / "Discount"' },
    { name: 'provider', help: '按提供方过滤。示例: Google / 字节跳动' },
    { name: 'taskPrompt', default: '' },
  ],
  columns: [
    '模型',
    '提供方',
    '帧模式',
    '参考模式',
    '特色能力',
    '通道',
    '模型组',
    '成功率',
  ],
  func: async (_page, kwargs) => {
    const viewerPermission = await resolveViewerPermission(kwargs);
    const source = kwargs.source || 'usage';
    const payload =
      source === 'usage'
        ? await apiFetch('/api/resource/model/list/usage/VIDEO_CREATE', {
            body: { taskPrompt: kwargs.taskPrompt || '' },
          })
        : await apiFetch('/api/material/creation/model/listIgnoreDelete', {
            method: 'GET',
            query: { taskType: 'VIDEO_GROUP' },
          });
    const rows = filterModelRows([
      ...normalizeModelRows(payload),
      ...normalizeAihubmixVideoModelRows(),
    ], { ...kwargs, viewerPermission });
    printModelListHint('video', rows);
    return rows;
  },
});

cli({
  site: SITE,
  name: 'upload-files',
  description: commandHelp('上传文件到素材桶', {
    quickStart: [
      '这条命令只负责把素材放进 AWB 素材池，不负责火山加白/外部发布。',
      '生图复用看 `素材路径`；生视频复用优先看 `复用写法`（通常是 `--refImageUrls` / `--refVideoUrls`）。',
      '如果是要给 Seedance 2.0 / Grok / 真人主体参考生视频，图片上传后优先继续看 `主体注册写法`，把 backendPath 注册成 `subjectId` 再走 `--refSubjects`。',
    ],
    examples: [
      'opencli awb upload-files --files ./ref.png',
      'opencli awb upload-files --files ./frame.webp --sceneType material-video-create',
      'opencli awb upload-files --files ./char.webp,./scene.webp --sceneType material-video-create -f json',
    ],
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'files', required: true, help: '本地文件路径，支持逗号分隔或 JSON 数组。示例: ./a.png,./b.png' },
    {
      name: 'sceneType',
      default: TASK_UPLOAD_SCENE.IMAGE_CREATE,
      help: '上传场景。示例: material-image-draw 或 material-video-create',
    },
    DRY_RUN_ARG,
  ],
  columns: ['文件名', '上传场景', '素材路径', '素材组ID', '复用写法', '主体注册写法', '宽', '高'],
  func: async (_page, kwargs) => {
    const sceneType = kwargs.sceneType || TASK_UPLOAD_SCENE.IMAGE_CREATE;
    const allowedSceneTypes = [...new Set(Object.values(TASK_UPLOAD_SCENE))];
    if (!allowedSceneTypes.includes(sceneType)) {
      throw new Error(`不支持的 sceneType: ${sceneType}。可选值: ${allowedSceneTypes.join(', ')}`);
    }
    if (toBool(kwargs.dryRun)) {
      return presentUploadRows(await previewUploadFiles({ ...kwargs, sceneType }));
    }
    const rows = await uploadLocalFiles(parseListArg(kwargs.files), {
      sceneType,
    });
    return presentUploadRows(rows.map((item) => ({
      fileName: item.fileName,
      sceneType: item.sceneType,
      mimeType: item.mimeType,
      size: item.size,
      width: item.width,
      height: item.height,
      backendPath: item.backendPath,
      signedUrl: item.signedUrl,
      publicUrl: item.publicUrl,
      objectName: item.objectName,
      groupId: item.groupId,
      raw: JSON.stringify(item),
    })));
  },
});

const SUBJECT_UPLOAD_ARGS = [
  { name: 'name', required: true, help: '角色/主体名称。示例: 小莉' },
  { name: 'projectName', default: 'default', help: '素材组项目名。默认 default；会参与组名拼接。' },
  { name: 'stateKey', default: 'default', help: '状态名。默认 default；非 default 时组名会追加该状态。' },
  { name: 'groupName', help: '直接指定素材组名；传了就不再按 projectName/name/stateKey 自动拼接。' },
  { name: 'description', help: '素材组描述；不传则自动生成。敏感人设建议改成中性描述。' },
  { name: 'publishCode', help: '发布用安全代码名。只影响素材组名/素材名，不影响 `--refSubjects` 里的引用名。示例: actor_001' },
  { name: 'safePublishNaming', help: '是否自动用安全代码名代替真实角色名生成素材组名/素材名。示例: true / false。' },
  { name: 'primaryFile', help: '主参考图本地路径。建议传三视图或最稳的人物主参考图；它的资产 ID 会作为 subjectId。' },
  { name: 'primaryUrl', help: '已在 COS 上的主参考图 URL 或相对路径；不传本地文件时可用。' },
  { name: 'threeViewFile', help: '兼容别名，等同于 `--primaryFile`。' },
  { name: 'threeViewUrl', help: '兼容别名，等同于 `--primaryUrl`。' },
  { name: 'faceFile', help: '正面图本地路径。可选。' },
  { name: 'faceUrl', help: '正面图 URL 或相对路径。可选。' },
  { name: 'sideFile', help: '侧面图本地路径。可选。' },
  { name: 'sideUrl', help: '侧面图 URL 或相对路径。可选。' },
  { name: 'backFile', help: '背面图本地路径。可选。' },
  { name: 'backUrl', help: '背面图 URL 或相对路径。可选。' },
  { name: 'platform', help: '可选平台字段；默认不传，沿用平台默认值。' },
  DRY_RUN_ARG,
];

async function runSubjectUploadCommand(kwargs) {
  await assertInternalViewer(kwargs);
  return presentSubjectUploadResult(
    toBool(kwargs.dryRun) ? await previewSubjectUpload(kwargs) : await uploadSubjectAssets(kwargs),
  );
}

cli({
  site: SITE,
  name: 'subject-upload',
  description: commandHelp('上传真人/角色图片到主体素材组，返回可复用的 subjectId', {
    quickStart: [
      '1. 用 `--primaryFile` 传主参考图；如果已有 `upload-files` 返回的 backendPath，则改用 `--primaryUrl`',
      '2. 成功后记下返回的 `subjectId` 或 `nextRefSubject`',
      '3. 后续在支持主体引用的视频模型里，用 `--refSubjects "角色名=subjectId"` 引用，而不是继续直接传原图',
    ],
    examples: [
      'opencli awb subject-upload --name 小莉 --primaryFile ./three-view.png --faceFile ./front.png --sideFile ./side.png --backFile ./back.png --projectName default --dryRun true',
      'opencli awb subject-upload --name 小莉 --primaryUrl /material/video-create/xxx-char.webp -f json',
      'opencli awb subject-upload --name 小莉 --primaryFile ./three-view.png -f json',
    ],
    hint: '这条命令会按素材组逻辑把图片注册成可复用主体素材，并把主参考图的资产 ID 作为 `subjectId` 返回。已有 backendPath 时优先用 `--primaryUrl` 直接注册，再把返回的 `nextRefSubject` 粘到 `--refSubjects`。',
    dryRun: true,
  }),
  browser: false,
  args: SUBJECT_UPLOAD_ARGS,
  columns: ['主体名称', '素材组ID', '素材组名称', '主体ID', '引用写法', '复用素材组'],
  func: async (_page, kwargs) => runSubjectUploadCommand({ ...kwargs, defaultSafePublishNaming: false }),
});

cli({
  site: SITE,
  name: 'subject-publish',
  description: commandHelp('发布真人/角色图片为可复用主体资产，返回 Seedance/Grok 可直接使用的 subjectId', {
    quickStart: [
      '1. 本地真人图可直接用 `--primaryFile`；如果已经先 `upload-files`，就改用 `--primaryUrl`',
      '1.1 默认会给素材组名/素材名生成安全代码，避免直接拿敏感人设词去碰审核；需要自定义时传 `--publishCode`。',
      '2. 成功后直接复制返回的 `引用写法`（`nextRefSubject`）',
      '3. 在 Seedance 2.0 / Grok 参考生视频里，用 `--refSubjects` 而不是 `--refImageUrls`',
    ],
    examples: [
      'opencli awb subject-publish --name 小莉 --primaryFile ./front.webp -f json',
      'opencli awb subject-publish --name 小莉 --primaryUrl /material/video-create/xxx-char.webp -f json',
    ],
    hint: '这是给真人主体参考生视频准备 `asset-xxx` 的首选命令。常见链路是：`upload-files --sceneType material-video-create` → `subject-publish --primaryUrl <backendPath>` → `video-create --refSubjects "角色=asset-xxx"`。',
    dryRun: true,
  }),
  browser: false,
  args: SUBJECT_UPLOAD_ARGS,
  columns: ['主体名称', '素材组ID', '素材组名称', '主体ID', '引用写法', '复用素材组'],
  func: async (_page, kwargs) => runSubjectUploadCommand({ ...kwargs, defaultSafePublishNaming: true }),
});

cli({
  site: SITE,
  name: 'subject-publish-batch',
  description: commandHelp('批量发布真人/角色图片为可复用主体资产，返回可直接喂给 Seedance/Grok 的引用写法', {
    examples: [
      'opencli awb subject-publish-batch --inputFile ./subject-batch.json --dryRun true -f json',
      'opencli awb subject-publish-batch --inputFile ./subject-batch.json --projectName default -f json',
    ],
    hint: '适合 agent / 沙箱断线场景：先批量把真人图或已上传 backendPath 注册成主体 asset id，再把返回的 `引用写法` 批量喂给 `video-create --refSubjects`。单条优先字段：`name`、`primaryFile` / `primaryUrl`，可选 `face*` / `side*` / `back*`。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'inputFile', required: true, help: '输入文件：支持 JSON 数组、带 items 的 JSON、JSONL 或一行一个主体名。推荐 JSON / JSONL。' },
    { name: 'concurrency', type: 'int', default: 1 },
    { name: 'projectName', help: '默认素材组项目名；只在单条未提供时补上' },
    { name: 'stateKey', help: '默认状态名；只在单条未提供时补上' },
    { name: 'platform', help: '默认平台字段；只在单条未提供时补上' },
    DRY_RUN_ARG,
  ],
  columns: ['序号', '主体名称', '主体ID', '引用写法', '素材组ID', '复用素材组', '错误'],
  func: async (_page, kwargs) => {
    await assertInternalViewer(kwargs);
    const items = await loadBatchItems(kwargs.inputFile, 'subject');
    const defaults = {
      projectName: kwargs.projectName ?? null,
      stateKey: kwargs.stateKey ?? null,
      platform: kwargs.platform ?? null,
      safePublishNaming: true,
    };
    const rows = await runConcurrent(items, kwargs.concurrency, async (item, index) => {
      const merged = mergeBatchDefaults(defaults, item);
      if (!merged.name) {
        throw new Error('Each batch subject item must include `name`.');
      }
      if (!(merged.primaryFile || merged.primaryUrl || merged.threeViewFile || merged.threeViewUrl)) {
        throw new Error('Each batch subject item must include `primaryFile` or `primaryUrl`.');
      }
      const result = toBool(kwargs.dryRun) ? await previewSubjectUpload(merged) : await uploadSubjectAssets(merged);
      return {
        inputIndex: index,
        name: result.name ?? merged.name,
        subjectId: result.subjectId ?? null,
        nextRefSubject: result.nextRefSubject ?? null,
        groupId: result.groupId ?? null,
        publishLabel: result.publishLabel ?? null,
        reusedGroup: result.reusedGroup ?? null,
        error: null,
        raw: JSON.stringify({ input: item, result }),
      };
    });
    return presentSubjectBatchRows(rows);
  },
});

async function resolveSubjectGroupTarget(kwargs = {}) {
  const explicitGroupId = trimToNull(kwargs.groupId);
  if (explicitGroupId) {
    return {
      groupId: explicitGroupId,
      groupName: trimToNull(kwargs.groupName) ?? null,
      detail: await apiFetch(`/api/material/asset-groups/${explicitGroupId}`, { method: 'GET' }),
    };
  }
  const lookupGroupName = trimToNull(kwargs.groupName)
    ?? buildSubjectGroupName(kwargs, { defaultSafeNaming: toBool(kwargs.defaultSafePublishNaming) });
  if (!lookupGroupName) {
    throw new Error('请至少提供 `--groupId`，或提供 `--groupName` / `--name` 让 CLI 推导素材组名。');
  }
  const rows = await listAssetGroups({ name: lookupGroupName, pageNumber: 1, pageSize: 20 }).catch(() => []);
  const exact = rows.find((item) => trimToNull(item?.name) === lookupGroupName) ?? rows[0] ?? null;
  if (!exact) {
    throw new Error(`未找到主体素材组: ${lookupGroupName}`);
  }
  const groupId = exact.id ?? exact.groupId ?? null;
  if (!groupId) {
    throw new Error(`主体素材组 ${lookupGroupName} 缺少 groupId。`);
  }
  const detail = await apiFetch(`/api/material/asset-groups/${groupId}`, { method: 'GET' }).catch(() => exact);
  return {
    groupId,
    groupName: lookupGroupName,
    detail,
  };
}

function presentSubjectStatus(result) {
  return withAliases(result, {
    groupId: '素材组ID',
    groupName: '素材组名称',
    description: '素材组描述',
    projectName: '项目名',
    platform: '平台',
    usage: '用途',
    groupSource: '来源',
    createTime: '创建时间',
    updateTime: '更新时间',
    publishLabel: '发布标识',
    publishState: '发布状态',
    publishedAssetCount: '已发布资产数',
    subjectId: '主体ID',
    nextRefSubject: '引用写法',
    publishedAssetNames: '已发布资产',
  });
}

async function listThirdAssets(filters = {}) {
  const payload = await apiFetch('/api/material/creation/thirdAsset/list', {
    body: {
      pageNumber: toInt(filters.pageNumber, 1),
      pageSize: toInt(filters.pageSize, 100),
      ...(trimToNull(filters.actorName) ? { actorName: trimToNull(filters.actorName) } : {}),
      ...(trimToNull(filters.assetName) ? { assetName: trimToNull(filters.assetName) } : {}),
    },
  });
  return Array.isArray(payload?.data) ? payload.data : [];
}

cli({
  site: SITE,
  name: 'subject-status',
  description: commandHelp('查询主体素材组状态与可复用引用信息', {
    examples: [
      'opencli awb subject-status --groupId group-xxxxxxxx',
      'opencli awb subject-status --name 小莉 --projectName default --safePublishNaming true',
    ],
    hint: '适合排查“加白不过审时该改什么”。`subject-status` 主要看素材组名称、描述、平台、更新时间；若你是走 `subject-publish` 默认安全命名，建议带上 `--safePublishNaming true` 或直接传 `--groupId`。',
  }),
  browser: false,
  args: [
    { name: 'groupId', help: '主体素材组 groupId；已知时优先传这个。' },
    { name: 'groupName', help: '主体素材组名称；不知道 groupId 时可直接查这个。' },
    { name: 'name', help: '主体引用名称；若不传 groupId/groupName，CLI 会按命名规则推导组名。' },
    { name: 'projectName', default: 'default', help: '项目名；用于推导默认素材组名。' },
    { name: 'stateKey', default: 'default', help: '状态名；用于推导默认素材组名。' },
    { name: 'publishCode', help: '如果发布时用过安全代码名，可传它协助推导组名。' },
    { name: 'safePublishNaming', help: '推导组名时是否按安全代码名规则计算。示例: true / false。' },
    { name: 'subjectId', help: '可选：当前已拿到的主体ID。若传入，CLI 会顺带拼出引用写法。' },
  ],
  columns: ['素材组ID', '素材组名称', '素材组描述', '项目名', '平台', '用途', '来源', '创建时间', '更新时间', '发布标识', '发布状态', '已发布资产数', '主体ID', '引用写法'],
  func: async (_page, kwargs) => {
    const target = await resolveSubjectGroupTarget(kwargs);
    const detail = target.detail ?? {};
    const groupName = detail.name ?? target.groupName ?? null;
    const thirdAssets = groupName ? await listThirdAssets({ actorName: groupName, pageSize: 100 }).catch(() => []) : [];
    const primaryAsset = thirdAssets.find((item) => /三视图|primary/i.test(String(item?.assetName ?? ''))) ?? thirdAssets[0] ?? null;
    const subjectId = trimToNull(kwargs.subjectId) ?? trimToNull(primaryAsset?.thirdAssetId) ?? null;
    const aliasName = trimToNull(kwargs.name) ?? null;
    return presentSubjectStatus({
      groupId: detail.id ?? detail.groupId ?? target.groupId,
      groupName,
      description: detail.description ?? null,
      projectName: detail.projectName ?? trimToNull(kwargs.projectName) ?? null,
      platform: detail.platform ?? primaryAsset?.platform ?? null,
      usage: detail.usage ?? null,
      groupSource: detail.groupSource ?? null,
      createTime: detail.createTime ?? null,
      updateTime: detail.updateTime ?? null,
      publishLabel: resolveSubjectPublishLabel(kwargs, toBool(kwargs.defaultSafePublishNaming)),
      publishState: thirdAssets.length ? '已发布可引用' : '未查到已发布资产',
      publishedAssetCount: thirdAssets.length,
      subjectId,
      nextRefSubject: aliasName && subjectId ? `${aliasName}=${subjectId}` : null,
      publishedAssetNames: thirdAssets.map((item) => item?.assetName).filter(Boolean).join(' | ') || null,
      raw: JSON.stringify({ group: detail, thirdAssets }),
    });
  },
});

cli({
  site: SITE,
  name: 'subject-group-update',
  description: commandHelp('修改主体素材组名称或描述，适合加白不过审时快速调整文案', {
    examples: [
      'opencli awb subject-group-update --groupId group-xxxxxxxx --groupName subj-a1b2c3d4',
      'opencli awb subject-group-update --groupId group-xxxxxxxx --description "主体素材组 subj-a1b2c3d4 [default]" --dryRun true -f json',
    ],
    hint: '如果审核对人设词敏感，优先把 `--groupName` 和 `--description` 改成中性代码化文案。更新后可重新走 `subject-publish` / `subject-publish-batch` 复投。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'groupId', required: true, help: '主体素材组 groupId。建议先从 `subject-publish` 返回里拿。' },
    { name: 'groupName', help: '新的素材组名；建议用安全代码而不是敏感角色名。' },
    { name: 'description', help: '新的素材组描述；建议用中性描述。' },
    DRY_RUN_ARG,
  ],
  columns: ['素材组ID', '素材组名称', '素材组描述', '更新时间'],
  func: async (_page, kwargs) => {
    if (!trimToNull(kwargs.groupName) && !trimToNull(kwargs.description)) {
      throw new Error('至少提供 `--groupName` 或 `--description` 之一。');
    }
    if (toBool(kwargs.dryRun)) {
      return presentSubjectStatus({
        groupId: kwargs.groupId,
        groupName: trimToNull(kwargs.groupName) ?? null,
        description: trimToNull(kwargs.description) ?? null,
        updateTime: null,
        raw: JSON.stringify({ dryRun: true, request: { groupId: kwargs.groupId, name: trimToNull(kwargs.groupName) ?? null, description: trimToNull(kwargs.description) ?? null } }),
      });
    }
    await apiFetch(`/api/material/asset-groups/${kwargs.groupId}`, {
      method: 'PUT',
      body: {
        ...(trimToNull(kwargs.groupName) ? { name: trimToNull(kwargs.groupName) } : {}),
        ...(trimToNull(kwargs.description) ? { description: trimToNull(kwargs.description) } : {}),
      },
    });
    const detail = await apiFetch(`/api/material/asset-groups/${kwargs.groupId}`, { method: 'GET' }).catch(() => ({}));
    return presentSubjectStatus({
      groupId: detail?.id ?? detail?.groupId ?? kwargs.groupId,
      groupName: detail?.name ?? trimToNull(kwargs.groupName) ?? null,
      description: detail?.description ?? trimToNull(kwargs.description) ?? null,
      projectName: detail?.projectName ?? null,
      platform: detail?.platform ?? null,
      usage: detail?.usage ?? null,
      groupSource: detail?.groupSource ?? null,
      createTime: detail?.createTime ?? null,
      updateTime: detail?.updateTime ?? null,
      raw: JSON.stringify(detail),
    });
  },
});

cli({
  site: SITE,
  name: 'tasks',
  description: commandHelp('查询任务状态', {
    examples: ['opencli awb tasks --taskType IMAGE_CREATE', 'opencli awb tasks --taskType VIDEO_GROUP -f json'],
  }),
  browser: false,
  args: [
    { name: 'taskType', default: 'IMAGE_CREATE', choices: FEED_TASK_TYPES },
    { name: 'projectGroupNo', help: '要查询的项目组编号；不传则使用当前项目组' },
    { name: 'pageSize', type: 'int', default: 20 },
    { name: 'minTime', help: 'Unix 毫秒时间戳上界；不传默认当前时间' },
  ],
  columns: ['任务ID', '任务类型', '任务状态', '模型', '积分', '创建时间'],
  func: async (_page, kwargs) => presentTaskRows(await fetchTaskFeed(kwargs)),
});

cli({
  site: SITE,
  name: 'task-wait',
  description: commandHelp('等待任务完成', {
    quickStart: [
      '先从 `image-create` / `video-create` / `tasks` 结果里拿到 `taskId`',
      '再用这个命令等待完成并取回结果链接',
    ],
    examples: [
      'opencli awb task-wait --taskId <id> --taskType IMAGE_CREATE',
      'opencli awb task-wait --taskId <id> --taskType VIDEO_GROUP -f json',
    ],
    hint: '任务完成后会直接返回 `firstResultUrl`、`resultFileList`、`resultFileDisplayList`，适合继续用 shell 或 agent 消费。',
  }),
  browser: false,
  args: [
    { name: 'taskId', required: true },
    { name: 'taskType', default: 'IMAGE_CREATE', choices: FEED_TASK_TYPES },
    { name: 'projectGroupNo', help: '要查询的项目组编号；不传则使用当前项目组' },
    { name: 'pageSize', type: 'int', default: 100 },
    { name: 'waitSeconds', type: 'int', default: 300 },
    { name: 'pollIntervalMs', type: 'int', default: 5000 },
    TASK_RECORD_FILE_ARG,
  ],
  columns: ['任务ID', '任务状态', '模型', '首个结果', '等待秒数', '是否超时'],
  func: async (_page, kwargs) => {
    const result = await waitForTask(kwargs);
    await appendTaskRecord(kwargs, {
      event: result.timedOut ? 'checked' : 'completed',
      command: 'task-wait',
      taskType: normalizeFeedTaskType(kwargs.taskType || 'IMAGE_CREATE'),
      taskId: result.taskId ?? kwargs.taskId ?? null,
      taskStatus: result.taskStatus ?? null,
      projectGroupNo: result.projectGroupNo ?? kwargs.projectGroupNo ?? null,
      modelName: result.modelName ?? null,
      modelGroupCode: result.modelGroupCode ?? null,
      pointCost: result.pointNo ?? null,
      firstResultUrl: result.firstResultUrl ?? null,
      resultCount: result.resultCount ?? null,
      waitedMs: result.waitedMs ?? null,
      timedOut: result.timedOut ?? null,
    });
    return presentTaskWaitResult(result);
  },
});

cli({
  site: SITE,
  name: 'task-records',
  description: commandHelp('查看本地任务台账', {
    examples: [
      'opencli awb task-records --taskRecordFile .awb/tasks.jsonl',
      'opencli awb task-records --taskRecordFile .awb/tasks.jsonl --pendingOnly true -f json',
    ],
    hint: '这个命令只读本地 JSONL 台账，用于 agent/批量任务恢复上下文；任务真实状态仍以 `tasks` / `task-wait` 查询 AWB 后端为准。',
  }),
  browser: false,
  args: [
    TASK_RECORD_FILE_ARG,
    { name: 'taskType', choices: FEED_TASK_TYPES, help: '只看某类任务。示例: IMAGE_CREATE / VIDEO_GROUP' },
    { name: 'pendingOnly', help: '只看本地台账里尚未记录完成结果的任务。示例: true' },
    { name: 'limit', type: 'int', default: 100 },
  ],
  columns: ['任务ID', '任务类型', '任务状态', '模型', '项目组编号', '首个结果', '记录时间', '事件'],
  func: async (_page, kwargs) => withAliasesRows(
    (await loadTaskRecordRows(kwargs)).map((record) => ({
      ...record,
      taskStatus: taskStatusLabel(record.taskStatus),
    })),
    {
      taskId: '任务ID',
      taskType: '任务类型',
      taskStatus: '任务状态',
      modelName: '模型',
      projectGroupNo: '项目组编号',
      firstResultUrl: '首个结果',
      recordedAt: '记录时间',
      event: '事件',
    },
  ),
});

cli({
  site: SITE,
  name: 'task-record-poll',
  description: commandHelp('轮询本地台账里的未完成任务', {
    examples: [
      'opencli awb task-record-poll --taskRecordFile .awb/tasks.jsonl -f json',
      'opencli awb task-record-poll --taskRecordFile .awb/tasks.jsonl --waitSeconds 300 --pollIntervalMs 10000 -f json',
    ],
    hint: '读取 `task-records --pendingOnly true` 的结果，查询 AWB 后端，并把 checked/completed 事件追加回同一个 JSONL。默认只查一轮；传 waitSeconds 才持续轮询。',
  }),
  browser: false,
  args: [
    TASK_RECORD_FILE_ARG,
    { name: 'taskType', choices: FEED_TASK_TYPES, help: '只轮询某类任务。示例: IMAGE_CREATE / VIDEO_GROUP' },
    { name: 'projectGroupNo', help: '台账记录缺少项目组时使用的默认项目组编号' },
    { name: 'pageSize', type: 'int', default: 100 },
    { name: 'limit', type: 'int', default: 100 },
    { name: 'waitSeconds', type: 'int', default: 0, help: '持续轮询秒数。0=只查一轮' },
    { name: 'pollIntervalMs', type: 'int', default: 5000 },
  ],
  columns: ['任务ID', '任务类型', '任务状态', '模型', '项目组编号', '首个结果', '是否超时', '事件'],
  func: async (_page, kwargs) => withAliasesRows(
    (await pollTaskRecordRows(kwargs)).map((record) => ({
      ...record,
      taskStatus: taskStatusLabel(record.taskStatus),
    })),
    {
      taskId: '任务ID',
      taskType: '任务类型',
      taskStatus: '任务状态',
      modelName: '模型',
      projectGroupNo: '项目组编号',
      firstResultUrl: '首个结果',
      timedOut: '是否超时',
      event: '事件',
    },
  ),
});

cli({
  site: SITE,
  name: 'task-duration-stats',
  description: commandHelp('查询任务平均耗时统计', {
    examples: [
      'opencli awb task-duration-stats --bizType 视频生成 --modelUseType seedance2.0',
      'opencli awb task-duration-stats --scope channel --granularity day --platformType volcengine --pageSize 20 -f json',
    ],
    hint: '数据来自灵境任务执行统计看板；字段和 AWB 模型组不是一一对应，按 bizType / platformType / modelUseType / channel 做最佳对齐。',
  }),
  browser: false,
  args: [
    { name: 'scope', default: 'channel', choices: ['task', 'channel'], help: '统计口径：task 或 channel' },
    { name: 'granularity', default: 'day', choices: ['5m', 'day'], help: '统计粒度：5m 或 day' },
    { name: 'days', type: 'int', default: 7, help: '未指定 startTs 时向前看的天数' },
    { name: 'startTs', help: '开始时间。示例: "2026-04-20 00:00:00"' },
    { name: 'endTs', help: '结束时间。示例: "2026-04-27 23:59:59"' },
    { name: 'bizType', help: '业务类型。示例: 图片生成 / 视频生成 / 字幕去除' },
    { name: 'platformType', help: '平台类型。示例: volcengine / jimeng / openai / qwen' },
    { name: 'modelUseType', help: '模型用途。示例: seedance2.0 / gpt-image-2 / Banana pro' },
    { name: 'channel', help: '通道名；scope=channel 时生效' },
    { name: 'page', type: 'int', default: 1 },
    { name: 'pageSize', type: 'int', default: 20 },
    { name: 'orderBy', default: 'total_avg_ms', help: '排序字段。示例: total_avg_ms / success_avg_ms / total_cnt' },
    { name: 'orderDir', default: 'desc', choices: ['asc', 'desc'] },
  ],
  columns: ['统计时间', '业务类型', '平台', '模型用途', '通道', '总数', '成功数', '平均耗时秒', '成功平均秒', '失败平均秒', '最大耗时秒'],
  func: async (_page, kwargs) => presentTaskDurationStats(await fetchTaskDurationStats(kwargs)),
});

cli({
  site: SITE,
  name: 'seedance-subtitle-remove',
  description: commandHelp('创建 Seedance 2.0 视频去字幕任务', {
    examples: [
      'opencli awb seedance-subtitle-remove --videoUrl "https://..." --name clip-001 -f json',
      'opencli awb seedance-subtitle-remove --videoUrl "https://..." --waitSeconds 300 -f json',
    ],
    hint: '只用于 Seedance 2.0 生视频后的火山原始链接，且应在生成后 24 小时内提交。若使用 asset-edit 私有账号，传 `--authorization` 或设置 ASSET_EDIT_AUTHORIZATION。',
  }),
  browser: false,
  args: [
    { name: 'videoUrl', required: true, help: 'Seedance 2.0 生成后的火山原始视频链接，不是下载后重新上传的文件链接' },
    { name: 'name', help: '去字幕任务名' },
    { name: 'createdAt', help: '原视频生成时间；超过 24 小时会阻止，确认付费/有效时可加 force' },
    { name: 'authorization', help: 'asset-edit Authorization header；也可用 ASSET_EDIT_AUTHORIZATION / ASSET_EDIT_TOKEN' },
    { name: 'remoteTaskId', help: '可选：火山远端任务 ID，会作为 asset-edit task_id 传入' },
    { name: 'callbackUrl', help: '可选：asset-edit 完成后回调地址' },
    { name: 'cosPath', help: '可选：指定结果 cos_path' },
    { name: 'waitSeconds', type: 'int', default: 0, help: '创建后等待秒数；0=只提交不等待' },
    { name: 'pollIntervalMs', type: 'int', default: 5000 },
    { name: 'force', help: '跳过 URL/24小时本地保护。示例: --force true' },
  ],
  columns: ['去字幕任务ID', '远端任务ID', '状态', '回调状态', '结果链接', '过期时间', '创建时间', '错误'],
  func: async (_page, kwargs) => {
    const created = await createSeedanceSubtitleRemoveTask(kwargs);
    const taskId = created?.public_id ?? created?.id;
    if (toInt(kwargs.waitSeconds, 0) <= 0 || !taskId) {
      return presentAssetEditTask(created);
    }
    return presentAssetEditTask(await waitForAssetEditTask({ ...kwargs, taskId }));
  },
});

cli({
  site: SITE,
  name: 'seedance-subtitle-status',
  description: commandHelp('查询 Seedance 2.0 去字幕任务', {
    examples: [
      'opencli awb seedance-subtitle-status --taskId 123 -f json',
      'opencli awb seedance-subtitle-status --taskId 123 --waitSeconds 300 -f json',
    ],
  }),
  browser: false,
  args: [
    { name: 'taskId', required: true, help: 'asset-edit 去字幕 public_id' },
    { name: 'authorization', help: 'asset-edit Authorization header；也可用 ASSET_EDIT_AUTHORIZATION / ASSET_EDIT_TOKEN' },
    { name: 'cosPath', help: '可选：查询时附带 cos_path' },
    { name: 'waitSeconds', type: 'int', default: 0 },
    { name: 'pollIntervalMs', type: 'int', default: 5000 },
  ],
  columns: ['去字幕任务ID', '远端任务ID', '状态', '回调状态', '结果链接', '过期时间', '创建时间', '错误'],
  func: async (_page, kwargs) => presentAssetEditTask(await waitForAssetEditTask(kwargs)),
});

cli({
  site: SITE,
  name: 'aihubmix-video-status',
  description: commandHelp('查询 AiHubMix 视频任务', {
    examples: [
      'opencli awb aihubmix-video-status --taskId <video_id> -f json',
      'opencli awb aihubmix-video-status --taskId <video_id> --waitSeconds 300 -f json',
    ],
    hint: '用于 HappyHorse / AiHubMix 外部视频任务。默认读取 AIHUBMIX_API_KEY。',
  }),
  browser: false,
  args: [
    { name: 'taskId', required: true, help: 'AiHubMix 返回的 video_id' },
    { name: 'waitSeconds', type: 'int', default: 0 },
    { name: 'pollIntervalMs', type: 'int', default: 5000 },
    { name: 'aihubmixApiKey', help: 'API Key；默认读 AIHUBMIX_API_KEY / AIHUBMIX_KEY / AIHUBMIX_TOKEN' },
  ],
  columns: ['任务ID', '任务状态', '模型组', '下载接口', '是否超时', '错误'],
  func: async (_page, kwargs) => presentAihubmixVideoStatus(await waitForAihubmixVideo(kwargs)),
});

cli({
  site: SITE,
  name: 'aihubmix-video-download',
  description: commandHelp('下载 AiHubMix 视频结果', {
    examples: [
      'opencli awb aihubmix-video-download --taskId <video_id> --outputFile ./output.mp4',
    ],
    hint: '会调用 `/v1/videos/{video_id}/content` 并写入本地文件。默认读取 AIHUBMIX_API_KEY。',
  }),
  browser: false,
  args: [
    { name: 'taskId', required: true, help: 'AiHubMix 返回的 video_id' },
    { name: 'outputFile', default: 'output.mp4', help: '输出 mp4 文件路径' },
    { name: 'aihubmixApiKey', help: 'API Key；默认读 AIHUBMIX_API_KEY / AIHUBMIX_KEY / AIHUBMIX_TOKEN' },
  ],
  columns: ['任务ID', '输出文件', '大小'],
  func: async (_page, kwargs) => withAliases(await downloadAihubmixVideo(kwargs), {
    taskId: '任务ID',
    outputFile: '输出文件',
    sizeBytes: '大小',
  }),
});

cli({
  site: SITE,
  name: 'image-fee',
  description: commandHelp('高级预算：估算生图积分', {
    examples: [
      'opencli awb image-fee --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount --prompt "一只小狗" --quality 1K --ratio 16:9 --generateNum 1',
      'opencli awb image-fee --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount --prompt "参考图里的角色在雨夜奔跑" --quality 1K --ratio 16:9 --generateNum 1 --irefFiles "./a.webp,./b.webp"',
    ],
    hint: '主流程通常直接用 `image-create`；这里只在脚本预算、批量预算或 agent 预判时单独估算。常见概念：`generateNum`=最终返回几张图；`directGenerateNum`=少数模型才用的底层直出张数；`cref/sref/iref`=已上传素材路径；`*Files`=本地文件，CLI 会自动上传。注意：Nano Banana Pro / Nano Banana 2 当前真实支持的是 `iref` 多图参考。',
  }),
  browser: false,
  args: [
    { name: 'modelCode', help: '模型编码。可只传这个；若存在多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '模型组编码。推荐优先传这个；它在平台里是唯一的' },
    { name: 'prompt', default: '', help: '提示词。示例: 一只小狗坐在木地板上' },
    { name: 'projectGroupNo', help: '项目组编号；不传则尽量读取当前项目组，仅用于余额联查' },
    { name: 'ratio', help: '画幅比例。先用 model-options 查看该模型可选值。示例: 16:9' },
    { name: 'quality', help: '分辨率档位。先用 model-options 查看该模型可选值。示例: 2K' },
    { name: 'generateNum', help: '最终希望返回几张图；大多数模型常用这个。示例: 1' },
    { name: 'directGenerateNum', help: '模型底层直出张数；只对少数支持该参数的模型生效，不清楚时通常可不传。示例: 1' },
    { name: 'promptParamsJson', help: '高级用法：直接覆盖整个 promptParams JSON。只有想绕过单独参数时再用' },
    { name: 'cref', help: '已上传到 AWB 素材桶的角色参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'sref', help: '已上传到 AWB 素材桶的风格参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'iref', help: '已上传到 AWB 素材桶的画面参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'crefFiles', help: '本地角色参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
    { name: 'srefFiles', help: '本地风格参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
    { name: 'irefFiles', help: '本地画面参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
  ],
  columns: ['预计积分', '项目组余额', '提交后项目组剩余', '团队积分', '提交后团队剩余'],
  func: async (_page, kwargs) => {
    ensureModelSelector('image-fee', kwargs);
    ensureRequiredArgs('image-fee', kwargs, [
      { key: 'prompt', help: '例如 `--prompt "一只小狗"`' },
    ]);
    return presentPointEstimate(await estimateImageFee(kwargs));
  },
});

cli({
  site: SITE,
  name: 'image-create',
  description: commandHelp('创建生图任务', {
    quickStart: [
      '1. 先执行 `opencli awb model-options --modelGroupCode <g>` 看必填项',
      '2. 再执行 `opencli awb image-create ... --dryRun true` 看积分和余额',
      '3. 确认后去掉 `--dryRun true` 正式提交',
    ],
    commonArgs: [
      '`--prompt`: 想生成什么',
      '`--quality`: 清晰度档位，例如 `1K` / `2K`',
      '`--ratio`: 画幅比例，例如 `16:9` / `1:1`',
      '`--generateNum`: 最终返回几张图，大多数模型只需要这个数量参数',
      '`--irefFiles` / `--crefFiles` / `--srefFiles`: 本地参考图，CLI 会自动上传',
    ],
    advancedArgs: [
      '`--directGenerateNum`: 少数模型才需要的底层直出张数，不清楚时通常不传',
      '`--cref` / `--sref` / `--iref`: 已经在 AWB 里的素材 backendPath，不是本地文件',
      '`--promptParamsJson`: 直接覆盖底层 JSON，只在普通参数不够时再用',
    ],
    examples: [
      'opencli awb image-create --modelGroupCode <g> --prompt "一只小狗" --quality 1K --ratio 16:9 --generateNum 1 --dryRun true',
      'opencli awb image-create --modelGroupCode <g> --prompt "一只小狗" --quality 1K --ratio 16:9 --generateNum 1 --waitSeconds 120',
      'opencli awb image-create --modelGroupCode Nano_Banana2_ImageCreate_Group_Discount --prompt "参考图里的角色在雨夜奔跑" --quality 1K --ratio 16:9 --generateNum 1 --irefFiles "./a.webp,./b.webp"',
    ],
    hint: '真正提交前会先显示预计积分、当前余额和提交后预计剩余；如果想一步等到结果，追加 `--waitSeconds 120`。Nano Banana Pro / Nano Banana 2 当前真实支持的是 `iref` 多图参考，不是 `cref/sref`。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'modelCode', help: '模型编码。可只传这个；若存在多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '模型组编码。推荐优先传这个；它在平台里是唯一的' },
    { name: 'prompt', help: '提示词。示例: 一位赛博少女站在霓虹街头' },
    { name: 'projectGroupNo', help: '项目组编号；不传则使用当前项目组' },
    { name: 'ratio', help: '画幅比例。先用 model-options 查看该模型可选值。示例: 16:9' },
    { name: 'quality', help: '分辨率档位。先用 model-options 查看该模型可选值。示例: 2K' },
    { name: 'generateNum', help: '最终希望返回几张图；大多数模型常用这个。示例: 1' },
    { name: 'directGenerateNum', help: '模型底层直出张数；只对少数支持该参数的模型生效，不清楚时通常可不传。示例: 1' },
    { name: 'promptParamsJson', help: '高级用法：直接覆盖整个 promptParams JSON。只有想绕过单独参数时再用' },
    { name: 'cref', help: '已上传到 AWB 素材桶的角色参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'sref', help: '已上传到 AWB 素材桶的风格参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'iref', help: '已上传到 AWB 素材桶的画面参考图 backendPath，多个逗号分隔；适合复用已有素材' },
    { name: 'crefFiles', help: '本地角色参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
    { name: 'srefFiles', help: '本地风格参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
    { name: 'irefFiles', help: '本地画面参考图路径，多个逗号分隔；CLI 会先自动上传再作为参考图使用' },
    { name: 'waitSeconds', type: 'int', default: 0, help: '提交后额外等待结果秒数。0=只提交。示例: 120' },
    { name: 'pollIntervalMs', type: 'int', default: 5000, help: '等待结果时的轮询间隔毫秒。示例: 5000' },
    TASK_RECORD_FILE_ARG,
    DRY_RUN_ARG,
  ],
  columns: ['任务ID', '任务状态', '预计积分', '项目组余额', '提交后项目组剩余', '项目组编号', '首个结果'],
  func: async (_page, kwargs) => {
    ensureModelSelector('image-create', kwargs);
    ensureRequiredArgs('image-create', kwargs, [
      { key: 'prompt', help: '例如 `--prompt "一只小狗"`' },
    ]);
    const result = toBool(kwargs.dryRun) ? await previewImageCreate(kwargs) : await createImageTask(kwargs);
    if (!toBool(kwargs.dryRun)) {
      await appendTaskRecord(kwargs, {
        event: 'submitted',
        command: 'image-create',
        taskType: 'IMAGE_CREATE',
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? kwargs.projectGroupNo ?? null,
        modelCode: kwargs.modelCode ?? null,
        modelGroupCode: kwargs.modelGroupCode ?? result.modelGroupCode ?? null,
        promptSummary: taskPromptSummary(kwargs),
        pointCost: result.pointCost ?? null,
        waitSeconds: toInt(kwargs.waitSeconds, 0),
        firstResultUrl: result.firstResultUrl ?? null,
        timedOut: result.timedOut ?? null,
      });
    }
    return presentTaskCreateResult(result);
  },
});

cli({
  site: SITE,
  name: 'image-create-batch',
  description: commandHelp('批量创建生图任务', {
    examples: [
      'opencli awb image-create-batch --inputFile ./image-batch.json --modelGroupCode <g>',
      'opencli awb image-create-batch --inputFile ./image-batch.json --dryRun true -f json',
    ],
    hint: '建议先执行 `--dryRun true` 查看逐条积分、批量总积分和各项目组预计剩余，再正式提交。`generateNum` 是每条最终返回张数；`directGenerateNum` 只对少数模型生效；`*Files` 会作为每条任务的默认本地参考图并自动上传。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'inputFile', required: true, help: '输入文件：支持 JSON 数组、带 items 的 JSON、JSONL 或一行一个提示词' },
    { name: 'concurrency', type: 'int', default: 1 },
    { name: 'modelCode', help: '当单条任务未指定时使用的默认 modelCode；若有多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '当单条任务未指定时使用的默认 modelGroupCode；推荐优先传这个' },
    { name: 'projectGroupNo', help: '当单条任务未指定时使用的默认项目组编号' },
    { name: 'ratio', help: '默认画幅比例；只在你显式传入时才会带上' },
    { name: 'quality', help: '默认分辨率档位；只在你显式传入时才会带上' },
    { name: 'generateNum', help: '默认每条最终返回几张图；只在你显式传入时才会带上' },
    { name: 'directGenerateNum', help: '默认模型底层直出张数；只对少数模型生效，只在你显式传入时才会带上' },
    { name: 'crefFiles', help: '默认本地角色参考图；会自动上传，并给每条任务复用' },
    { name: 'srefFiles', help: '默认本地风格参考图；会自动上传，并给每条任务复用' },
    { name: 'irefFiles', help: '默认本地画面参考图；会自动上传，并给每条任务复用' },
    TASK_RECORD_FILE_ARG,
    DRY_RUN_ARG,
  ],
  columns: ['序号', '预计积分', '项目组余额', '提交后项目组剩余', '任务ID', '任务状态', '项目组编号', '错误'],
  func: async (_page, kwargs) => {
    const items = await loadBatchItems(kwargs.inputFile, 'image');
    if (toBool(kwargs.dryRun)) {
      const defaults = {
        modelCode: kwargs.modelCode ?? null,
        modelGroupCode: kwargs.modelGroupCode ?? null,
        projectGroupNo: kwargs.projectGroupNo ?? null,
        ratio: kwargs.ratio ?? null,
        quality: kwargs.quality ?? null,
        generateNum: kwargs.generateNum ?? null,
        directGenerateNum: kwargs.directGenerateNum ?? null,
        crefFiles: kwargs.crefFiles ?? null,
        srefFiles: kwargs.srefFiles ?? null,
        irefFiles: kwargs.irefFiles ?? null,
      };
      const rows = applySequentialBatchBalances(await runConcurrent(items, kwargs.concurrency, async (item, index) => {
        const merged = mergeBatchDefaults(defaults, item);
        if (!merged.modelCode && !merged.modelGroupCode) {
          throw new Error('Each batch image item must include `modelGroupCode` or `modelCode`.');
        }
        if (!merged.prompt) {
          throw new Error('Each batch image item must include `prompt`.');
        }
        const preview = await previewImageCreate(merged);
        return {
          inputIndex: index,
          ...preview,
          modelCode: merged.modelCode,
          modelGroupCode: merged.modelGroupCode,
          prompt: merged.prompt,
          error: null,
        };
      }));
      printBatchEstimateSummary('生图', rows);
      return presentBatchCreateRows(rows.map((row, index) => ({
        inputIndex: row?.inputIndex ?? index,
        pointCost: row?.pointCost ?? null,
        projectPointBalance: row?.projectPointBalance ?? null,
        projectPointRemainingAfter: row?.projectPointRemainingAfter ?? null,
        taskId: row?.taskId ?? null,
        taskStatus: row?.taskStatus ?? null,
        projectGroupNo: row?.projectGroupNo ?? row?.currentProjectGroupNo ?? null,
        error: row?.error ?? null,
        raw: JSON.stringify(row),
      })));
    }
    return presentBatchCreateRows(await runConcurrent(items, kwargs.concurrency, async (item, index) => {
      const merged = mergeBatchDefaults(kwargs, item);
      if (!merged.modelCode && !merged.modelGroupCode) {
        throw new Error('Each batch image item must include `modelGroupCode` or `modelCode`.');
      }
      if (!merged.prompt) {
        throw new Error('Each batch image item must include `prompt`.');
      }
      const result = await createImageTask(merged);
      await appendTaskRecord(kwargs, {
        event: 'submitted',
        command: 'image-create-batch',
        taskType: 'IMAGE_CREATE',
        inputIndex: index,
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? merged.projectGroupNo ?? null,
        modelCode: merged.modelCode ?? null,
        modelGroupCode: merged.modelGroupCode ?? result.modelGroupCode ?? null,
        promptSummary: taskPromptSummary(merged),
        pointCost: result.pointCost ?? null,
        firstResultUrl: result.firstResultUrl ?? null,
        timedOut: result.timedOut ?? null,
      });
      return {
        inputIndex: index,
        pointCost: result.pointCost ?? null,
        projectPointBalance: result.projectPointBalance ?? null,
        projectPointRemainingAfter: result.projectPointRemainingAfter ?? null,
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? null,
        error: null,
        raw: JSON.stringify({
          input: item,
          result,
        }),
      };
    }));
  },
});

cli({
  site: SITE,
  name: 'video-fee',
  description: commandHelp('高级预算：估算生视频积分', {
    examples: [
      'opencli awb video-fee --modelGroupCode JiMeng3Pro_VideoCreate_Group --frameText "镜头推进" --quality 720 --generatedTime 5 --ratio 16:9',
      'opencli awb video-fee --modelGroupCode <g> --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp" --quality 720 --generatedTime 5 --ratio 16:9',
      'opencli awb video-fee --modelGroupCode KeLing3_VideoCreate_Group --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" --quality 720 --generatedTime 5 --ratio 16:9',
    ],
    hint: '主流程通常直接用 `video-create`；这里只在脚本预算、批量预算或 agent 预判时单独估算。部分模型支持纯 prompt，无需首帧或参考。两种主要模式：首尾帧模式用 `frame*` / `framesJson`；参考生视频模式用 `refImage*` / `refVideo*` / `refAudio*` / `refSubjects`。故事板模式可直接用 `--storyboardPrompts`；只有更底层的特殊结构才需要 `--promptParamsJson`。如果模型支持主体引用，优先传 `--refSubjects "角色=asset-..."`。',
  }),
  browser: false,
  args: [
    { name: 'modelCode', help: '模型编码。可只传这个；若存在多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '模型组编码。推荐优先传这个；它在平台里是唯一的' },
    { name: 'projectGroupNo', help: '项目组编号；不传则尽量读取当前项目组，仅用于余额联查' },
    { name: 'frameText', default: '', help: '[首尾帧模式] 只用文字描述首帧画面；没有首帧图片时最常用。示例: 镜头缓慢推进' },
    { name: 'prompt', default: '', help: '全局视频提示词；描述整体动作、风格和镜头运动' },
    { name: 'ratio', help: '视频比例。先用 model-options 查看该模型可选值。示例: 16:9' },
    { name: 'quality', help: '分辨率档位。先用 model-options 查看该模型可选值。示例: 720' },
    { name: 'resolution', help: '[AiHubMix] 分辨率档位。示例: 720P / 1080P；不传默认 1080P' },
    { name: 'size', help: '[AiHubMix] 直接传视频分辨率。示例: 1280x720 / 720x1280 / 960x960' },
    { name: 'generatedTime', help: '最终视频时长秒数。示例: 5' },
    { name: 'frameUrl', help: '[首尾帧模式] 现成首帧图片 URL；适合直接用线上图片做首帧' },
    { name: 'frameFile', help: '[首尾帧模式] 本地首帧图片路径；CLI 会先自动上传再使用。示例: ./frame.webp' },
    { name: 'tailFrameText', help: '[首尾帧模式] 尾帧文字描述；适合做首尾帧过渡' },
    { name: 'tailFrameUrl', help: '[首尾帧模式] 尾帧图片 URL；适合做首尾帧过渡' },
    { name: 'tailFrameFile', help: '[首尾帧模式] 本地尾帧图片路径；CLI 会先自动上传再使用。示例: ./tail.webp' },
    { name: 'generatedMode', help: '[高级参数] 指定生成模式。示例: frames / multi_param / multi_prompt。通常不传，CLI 会按输入自动判断。' },
    { name: 'audio', help: '[部分模型] 是否启用音频/音效能力。示例: true / false；带音频参考时默认 true。' },
    { name: 'needAudio', help: '[部分模型] 是否要求输出带音频。示例: true / false；带音频参考时默认 true。' },
    { name: 'refImageFiles', help: '[参考生视频模式] 命名图片文件。格式: 名称=./a.webp,背景=./bg.webp；提示词里可用 @名称 引用。' },
    { name: 'refImageUrls', help: '[参考生视频模式] 命名图片地址。格式: 名称=/material/... 或 名称=https://...' },
    { name: 'refImagesJson', help: '[参考生视频模式] 高级图片参考 JSON。支持 name / displayName / file / url / subjectId / bindTo。' },
    { name: 'refVideoFiles', help: '[参考生视频模式] 命名视频文件。格式: 上一镜头=./prev.mp4' },
    { name: 'refVideoUrls', help: '[参考生视频模式] 命名视频地址。格式: 上一镜头=/material/... 或 https://...' },
    { name: 'refVideosJson', help: '[参考生视频模式] 高级视频参考 JSON。支持 name / displayName / file / url。' },
    { name: 'refAudioFiles', help: '[参考生视频模式] 命名音频文件。格式: 角色A=./voice.mp3；默认会绑定到同名图片/主体参考。' },
    { name: 'refAudioUrls', help: '[参考生视频模式] 命名音频地址。格式: 角色A=/material/... 或 https://...' },
    { name: 'refAudiosJson', help: '[参考生视频模式] 高级音频参考 JSON。支持 name / displayName / file / url / bindTo。' },
    { name: 'refSubjects', help: '[参考生视频模式] 命名主体引用。格式: 角色A=asset_xxx 或 actors.json 里的 subject_id；提示词里可用 @角色A 引用。已有 subjectId 时优先用这个。' },
    { name: 'refSubjectsJson', help: '[参考生视频模式] 高级主体参考 JSON。支持 name / displayName / elementId / desc。' },
    { name: 'storyboardPrompts', help: '[故事板模式] 分镜提示词。支持 JSON 数组或 `||` 分隔字符串。示例: "镜头1：城市远景||镜头2：人物走近镜头"' },
    { name: 'framesJson', help: '高级用法：直接覆盖整个 frames 数组 JSON；只有做多帧精细控制时再用' },
    { name: 'richTaskPrompt', default: '', help: '富文本任务提示词；只有需要底层富文本能力时再传' },
    { name: 'promptParamsJson', help: '高级用法：直接覆盖整个 promptParams JSON。只有想绕过单独参数时再用' },
    { name: 'aihubmixApiKey', help: '[AiHubMix] API Key；默认读 AIHUBMIX_API_KEY / AIHUBMIX_KEY / AIHUBMIX_TOKEN' },
    { name: 'aihubmixRequestJson', help: '[AiHubMix] 直接覆盖 /v1/videos 请求 JSON' },
    { name: 'aihubmixExtraBodyJson', help: '[AiHubMix] 合并到 extra_body 的 JSON' },
  ],
  columns: ['预计积分', '项目组余额', '提交后项目组剩余', '团队积分', '提交后团队剩余'],
  func: async (_page, kwargs) => {
    ensureModelSelector('video-fee', kwargs);
    return presentPointEstimate(await estimateVideoFee(kwargs));
  },
});

cli({
  site: SITE,
  name: 'video-create',
  description: commandHelp('创建生视频任务', {
    quickStart: [
      '1. 先执行 `opencli awb model-options --modelGroupCode <g>` 看必填项',
      '2. 再执行 `opencli awb video-create ... --dryRun true` 看积分和余额',
      '3. 确认后去掉 `--dryRun true` 正式提交',
    ],
    commonArgs: [
      '`--prompt`: 部分模型支持纯 prompt 直出，无需首帧或参考图',
      '`--frameText` 或 `--frameFile`: 首尾帧模式的最常用输入',
      '`--refImageFiles` / `--refSubjects`: 参考生视频模式的最常用输入，提示词里可写 `@角色A`；已有主体素材时优先用 `--refSubjects`',
      '`--quality`: 清晰度档位，例如 `720` / `1080`',
      '`--ratio`: 视频比例，例如 `16:9` / `9:16`',
      '`--generatedTime`: 目标视频时长秒数，例如 `5` / `10`',
    ],
    advancedArgs: [
      '`--tailFrameText` / `--tailFrameFile`: 做首尾帧过渡时再用',
      '`--refVideoFiles`: 附加视频参考；不会走 `@名称` 富文本引用，但会进入多参考请求',
      '`--refAudioFiles`: 附加音频参考；默认绑定到同名图片/主体参考，并自动补音色参考提示',
      '`--storyboardPrompts`: 故事板模式的平铺参数。格式: "镜头1：城市远景||镜头2：人物走近镜头"',
      '`--generatedMode multi_prompt`: 只有故事板模型才支持；通常和 `--storyboardPrompts` 一起用，不必手写 JSON',
      '`--framesJson`: 直接手写多帧输入，只在精细控制时再用',
      '`--promptParamsJson`: 直接覆盖底层 JSON，只在普通参数不够时再用',
    ],
    examples: [
      'opencli awb video-create --modelGroupCode <g> --frameText "镜头推进" --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true',
      'opencli awb video-create --modelGroupCode <g> --frameFile ./frame.webp --quality 720 --generatedTime 5 --ratio 16:9 --waitSeconds 180',
      'opencli awb video-create --modelGroupCode <g> --frameFile ./frame.webp --tailFrameFile ./tail.webp --quality 720 --generatedTime 5 --ratio 16:9',
      'opencli awb video-create --modelGroupCode <g> --prompt "@角色A 在雨夜奔跑" --refImageFiles "角色A=./char.webp" --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true',
      'opencli awb video-create --modelGroupCode KeLing3_VideoCreate_Group --storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头" --quality 720 --generatedTime 5 --ratio 16:9 --dryRun true',
      'opencli awb video-create --modelGroupCode <g> --prompt "@角色A 对镜说话" --refSubjects "角色A=asset-xxxxxxxx" --refAudioFiles "角色A=./voice.mp3" --quality 720 --generatedTime 5 --ratio 9:16',
    ],
    hint: '真正提交前会先显示预计积分、当前余额和提交后预计剩余；如果想一步等到结果，追加 `--waitSeconds 180`。部分模型支持纯 prompt，无需首帧或参考。参考生视频模式请不要再混用 `frame*` 与 `ref*`。故事板模式现在可直接用 `--storyboardPrompts`；只有更底层的特殊结构才需要 `--promptParamsJson`。如已拿到主体素材 ID，优先传 `--refSubjects`。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'modelCode', help: '模型编码。可只传这个；若存在多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '模型组编码。推荐优先传这个；它在平台里是唯一的' },
    { name: 'projectGroupNo', help: '项目组编号；不传则使用当前项目组' },
    { name: 'frameText', default: '', help: '[首尾帧模式] 只用文字描述首帧画面；没有首帧图片时最常用。示例: 镜头缓慢推进' },
    { name: 'prompt', default: '', help: '全局视频提示词；描述整体动作、风格和镜头运动' },
    { name: 'ratio', help: '视频比例。先用 model-options 查看该模型可选值。示例: 16:9' },
    { name: 'quality', help: '分辨率档位。先用 model-options 查看该模型可选值。示例: 720' },
    { name: 'resolution', help: '[AiHubMix] 分辨率档位。示例: 720P / 1080P；不传默认 1080P' },
    { name: 'size', help: '[AiHubMix] 直接传视频分辨率。示例: 1280x720 / 720x1280 / 960x960' },
    { name: 'generatedTime', help: '最终视频时长秒数。示例: 5、10' },
    { name: 'frameUrl', help: '[首尾帧模式] 现成首帧图片 URL；适合直接用线上图片做首帧' },
    { name: 'frameFile', help: '[首尾帧模式] 本地首帧图片路径；CLI 会先自动上传再使用。示例: ./frame.webp' },
    { name: 'tailFrameText', help: '[首尾帧模式] 尾帧文字描述；适合做首尾帧过渡' },
    { name: 'tailFrameUrl', help: '[首尾帧模式] 尾帧图片 URL；适合做首尾帧过渡' },
    { name: 'tailFrameFile', help: '[首尾帧模式] 本地尾帧图片路径；CLI 会先自动上传再使用。示例: ./tail.webp' },
    { name: 'generatedMode', help: '[高级参数] 指定生成模式。示例: frames / multi_param / multi_prompt。通常不传，CLI 会按输入自动判断。' },
    { name: 'audio', help: '[部分模型] 是否启用音频/音效能力。示例: true / false；带音频参考时默认 true。' },
    { name: 'needAudio', help: '[部分模型] 是否要求输出带音频。示例: true / false；带音频参考时默认 true。' },
    { name: 'refImageFiles', help: '[参考生视频模式] 命名图片文件。格式: 名称=./a.webp,背景=./bg.webp；提示词里可用 @名称 引用。' },
    { name: 'refImageUrls', help: '[参考生视频模式] 命名图片地址。格式: 名称=/material/... 或 名称=https://...' },
    { name: 'refImagesJson', help: '[参考生视频模式] 高级图片参考 JSON。支持 name / displayName / file / url / subjectId / bindTo。' },
    { name: 'refVideoFiles', help: '[参考生视频模式] 命名视频文件。格式: 上一镜头=./prev.mp4' },
    { name: 'refVideoUrls', help: '[参考生视频模式] 命名视频地址。格式: 上一镜头=/material/... 或 https://...' },
    { name: 'refVideosJson', help: '[参考生视频模式] 高级视频参考 JSON。支持 name / displayName / file / url。' },
    { name: 'refAudioFiles', help: '[参考生视频模式] 命名音频文件。格式: 角色A=./voice.mp3；默认会绑定到同名图片/主体参考。' },
    { name: 'refAudioUrls', help: '[参考生视频模式] 命名音频地址。格式: 角色A=/material/... 或 https://...' },
    { name: 'refAudiosJson', help: '[参考生视频模式] 高级音频参考 JSON。支持 name / displayName / file / url / bindTo。' },
    { name: 'refSubjects', help: '[参考生视频模式] 命名主体引用。格式: 角色A=asset_xxx 或 actors.json 里的 subject_id；提示词里可用 @角色A 引用。已有 subjectId 时优先用这个。' },
    { name: 'refSubjectsJson', help: '[参考生视频模式] 高级主体参考 JSON。支持 name / displayName / elementId / desc。' },
    { name: 'storyboardPrompts', help: '[故事板模式] 分镜提示词。支持 JSON 数组或 `||` 分隔字符串。示例: "镜头1：城市远景||镜头2：人物走近镜头"' },
    { name: 'framesJson', help: '高级用法：直接覆盖整个 frames 数组 JSON；只有做多帧精细控制时再用' },
    { name: 'richTaskPrompt', default: '', help: '富文本任务提示词；只有需要底层富文本能力时再传' },
    { name: 'promptParamsJson', help: '高级用法：直接覆盖整个 promptParams JSON。只有想绕过单独参数时再用' },
    { name: 'aihubmixApiKey', help: '[AiHubMix] API Key；默认读 AIHUBMIX_API_KEY / AIHUBMIX_KEY / AIHUBMIX_TOKEN' },
    { name: 'aihubmixRequestJson', help: '[AiHubMix] 直接覆盖 /v1/videos 请求 JSON' },
    { name: 'aihubmixExtraBodyJson', help: '[AiHubMix] 合并到 extra_body 的 JSON' },
    { name: 'waitSeconds', type: 'int', default: 0, help: '提交后额外等待结果秒数。0=只提交。示例: 180' },
    { name: 'pollIntervalMs', type: 'int', default: 5000, help: '等待结果时的轮询间隔毫秒。示例: 5000' },
    TASK_RECORD_FILE_ARG,
    DRY_RUN_ARG,
  ],
  columns: ['任务ID', '任务状态', '预计积分', '项目组余额', '提交后项目组剩余', '项目组编号', '首个结果'],
  func: async (_page, kwargs) => {
    ensureModelSelector('video-create', kwargs);
    if (!hasVideoSubmissionContent(kwargs)) {
      throw new Error([
        '缺少视频内容。',
        '- 可传 `--prompt` 走纯提示词模式（仅限模型本身允许无帧输入时）',
        '- 或传首尾帧：`--frameFile` / `--frameUrl` / `--frameText` / `--framesJson`',
        '- 或传参考生视频：`--refImageFiles` / `--refImageUrls` / `--refSubjects` / `--refVideoFiles` / `--refAudioFiles`',
        '- 或传故事板：`--storyboardPrompts "镜头1：城市远景||镜头2：人物走近镜头"`',
        '- 或直接用 `--promptParamsJson` 透传高级模式',
        `可先查看模型参数: ${runtimeCommandPrefix()} model-options --modelCode ${kwargs.modelCode} --modelGroupCode ${kwargs.modelGroupCode}`,
      ].join('\n'));
    }
    const result = toBool(kwargs.dryRun) ? await previewVideoCreate(kwargs) : await createVideoTask(kwargs);
    if (!toBool(kwargs.dryRun)) {
      await appendTaskRecord(kwargs, {
        event: 'submitted',
        command: 'video-create',
        taskType: result.provider === 'aihubmix' ? 'AIHUBMIX_VIDEO' : 'VIDEO_GROUP',
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? kwargs.projectGroupNo ?? null,
        modelCode: kwargs.modelCode ?? null,
        modelGroupCode: kwargs.modelGroupCode ?? result.modelGroupCode ?? null,
        promptSummary: taskPromptSummary(kwargs),
        pointCost: result.pointCost ?? null,
        waitSeconds: toInt(kwargs.waitSeconds, 0),
        firstResultUrl: result.firstResultUrl ?? null,
        timedOut: result.timedOut ?? null,
      });
    }
    return presentTaskCreateResult(result);
  },
});

cli({
  site: SITE,
  name: 'video-create-batch',
  description: commandHelp('批量创建生视频任务', {
    examples: [
      'opencli awb video-create-batch --inputFile ./video-batch.json --modelGroupCode <g>',
      'opencli awb video-create-batch --inputFile ./video-batch.json --dryRun true -f json',
    ],
    hint: '建议先执行 `--dryRun true` 查看逐条积分、批量总积分和各项目组预计剩余，再正式提交。部分模型支持纯 prompt，所以单条也可以只给 `prompt`。最常用的是每条传 `frameText`、默认 `frameFile`，或直接传 `refImage*` / `refSubjects`；`framesJson` 只在做多帧精细控制时再用。故事板模式现在也可直接传 `storyboardPrompts`，不必再手写 `promptParamsJson`。',
    dryRun: true,
  }),
  browser: false,
  args: [
    { name: 'inputFile', required: true, help: '输入文件：支持 JSON 数组、带 items 的 JSON、JSONL 或一行一个提示词' },
    { name: 'concurrency', type: 'int', default: 1 },
    { name: 'modelCode', help: '当单条任务未指定时使用的默认 modelCode；若有多个分组，CLI 会提示你补 `--modelGroupCode`' },
    { name: 'modelGroupCode', help: '当单条任务未指定时使用的默认 modelGroupCode；推荐优先传这个' },
    { name: 'projectGroupNo', help: '当单条任务未指定时使用的默认项目组编号' },
    { name: 'prompt', help: '默认全局视频提示词；只在单条任务未提供时才会带上' },
    { name: 'ratio', help: '默认视频比例；只在你显式传入时才会带上' },
    { name: 'quality', help: '默认分辨率档位；只在你显式传入时才会带上' },
    { name: 'size', help: '[AiHubMix] 默认视频分辨率；只在你显式传入时才会带上' },
    { name: 'generatedTime', help: '默认视频时长；只在你显式传入时才会带上' },
    { name: 'frameText', help: '[首尾帧模式默认值] 默认首帧文字描述；只在单条任务未提供时才会带上' },
    { name: 'frameUrl', help: '[首尾帧模式默认值] 默认首帧图片 URL；只在单条任务未提供时才会带上' },
    { name: 'frameFile', help: '[首尾帧模式默认值] 默认本地首帧图片；CLI 会自动上传，只在单条任务未提供时才会带上' },
    { name: 'tailFrameText', help: '[首尾帧模式默认值] 默认尾帧文字描述；只在单条任务未提供时才会带上' },
    { name: 'tailFrameUrl', help: '[首尾帧模式默认值] 默认尾帧图片 URL；只在单条任务未提供时才会带上' },
    { name: 'tailFrameFile', help: '[首尾帧模式默认值] 默认本地尾帧图片；CLI 会自动上传，只在单条任务未提供时才会带上' },
    { name: 'generatedMode', help: '[高级默认值] 默认生成模式；示例: frames / multi_param / multi_prompt。通常不传。' },
    { name: 'audio', help: '[部分模型默认值] 默认是否启用音频/音效能力；只在单条任务未提供时才会带上' },
    { name: 'needAudio', help: '[部分模型默认值] 默认是否要求输出带音频；只在单条任务未提供时才会带上' },
    { name: 'refImageFiles', help: '[参考生视频模式默认值] 默认命名图片参考文件；格式: 名称=./a.webp,背景=./bg.webp' },
    { name: 'refImageUrls', help: '[参考生视频模式默认值] 默认命名图片参考地址；格式: 名称=/material/... 或 https://...' },
    { name: 'refImagesJson', help: '[参考生视频模式默认值] 默认高级图片参考 JSON。支持 name / displayName / file / url / subjectId / bindTo。' },
    { name: 'refVideoFiles', help: '[参考生视频模式默认值] 默认命名视频参考文件；格式: 上一镜头=./prev.mp4' },
    { name: 'refVideoUrls', help: '[参考生视频模式默认值] 默认命名视频参考地址；格式: 上一镜头=/material/... 或 https://...' },
    { name: 'refVideosJson', help: '[参考生视频模式默认值] 默认高级视频参考 JSON。支持 name / displayName / file / url。' },
    { name: 'refAudioFiles', help: '[参考生视频模式默认值] 默认命名音频参考文件；格式: 角色A=./voice.mp3' },
    { name: 'refAudioUrls', help: '[参考生视频模式默认值] 默认命名音频参考地址；格式: 角色A=/material/... 或 https://...' },
    { name: 'refAudiosJson', help: '[参考生视频模式默认值] 默认高级音频参考 JSON。支持 name / displayName / file / url / bindTo。' },
    { name: 'refSubjects', help: '[参考生视频模式默认值] 默认命名主体引用；格式: 角色A=asset_xxx。真人资产优先用这个。' },
    { name: 'refSubjectsJson', help: '[参考生视频模式默认值] 默认高级主体参考 JSON。支持 name / displayName / elementId / desc。' },
    { name: 'storyboardPrompts', help: '[故事板模式默认值] 默认故事板分镜提示词。支持 JSON 数组或 `||` 分隔字符串。' },
    { name: 'framesJson', help: '默认直接覆盖整个 frames 数组 JSON；只有做多帧精细控制时再用' },
    { name: 'richTaskPrompt', help: '默认富文本任务提示词；只在单条任务未提供时才会带上' },
    { name: 'promptParamsJson', help: '默认直接覆盖 promptParams JSON；只有普通参数不够时再用' },
    { name: 'aihubmixApiKey', help: '[AiHubMix] API Key；默认读 AIHUBMIX_API_KEY / AIHUBMIX_KEY / AIHUBMIX_TOKEN' },
    { name: 'aihubmixRequestJson', help: '[AiHubMix] 直接覆盖 /v1/videos 请求 JSON' },
    { name: 'aihubmixExtraBodyJson', help: '[AiHubMix] 合并到 extra_body 的 JSON' },
    TASK_RECORD_FILE_ARG,
    DRY_RUN_ARG,
  ],
  columns: ['序号', '预计积分', '项目组余额', '提交后项目组剩余', '任务ID', '任务状态', '项目组编号', '错误'],
  func: async (_page, kwargs) => {
    const items = await loadBatchItems(kwargs.inputFile, 'video');
    if (toBool(kwargs.dryRun)) {
      const defaults = buildVideoBatchDefaults(kwargs);
      const rows = applySequentialBatchBalances(await runConcurrent(items, kwargs.concurrency, async (item, index) => {
        const merged = mergeBatchDefaults(defaults, item);
        if (!merged.modelCode && !merged.modelGroupCode) {
          throw new Error('Each batch video item must include `modelGroupCode` or `modelCode`.');
        }
        if (!hasVideoSubmissionContent(merged)) {
          throw new Error('Each batch video item must include content via `prompt`, `storyboardPrompts`, frame inputs, reference inputs, or `promptParamsJson`.');
        }
        const preview = await previewVideoCreate(merged);
        return {
          inputIndex: index,
          ...preview,
          modelCode: merged.modelCode,
          modelGroupCode: merged.modelGroupCode,
          error: null,
        };
      }));
      printBatchEstimateSummary('生视频', rows);
      return presentBatchCreateRows(rows.map((row, index) => ({
        inputIndex: row?.inputIndex ?? index,
        pointCost: row?.pointCost ?? null,
        projectPointBalance: row?.projectPointBalance ?? null,
        projectPointRemainingAfter: row?.projectPointRemainingAfter ?? null,
        taskId: row?.taskId ?? null,
        taskStatus: row?.taskStatus ?? null,
        projectGroupNo: row?.projectGroupNo ?? row?.currentProjectGroupNo ?? null,
        error: row?.error ?? null,
        raw: JSON.stringify(row),
      })));
    }
    return presentBatchCreateRows(await runConcurrent(items, kwargs.concurrency, async (item, index) => {
      const merged = mergeBatchDefaults(kwargs, item);
      if (!merged.modelCode && !merged.modelGroupCode) {
        throw new Error('Each batch video item must include `modelGroupCode` or `modelCode`.');
      }
      if (!hasVideoSubmissionContent(merged)) {
        throw new Error('Each batch video item must include content via `prompt`, `storyboardPrompts`, frame inputs, reference inputs, or `promptParamsJson`.');
      }
      const result = await createVideoTask(merged);
      await appendTaskRecord(kwargs, {
        event: 'submitted',
        command: 'video-create-batch',
        taskType: result.provider === 'aihubmix' ? 'AIHUBMIX_VIDEO' : 'VIDEO_GROUP',
        inputIndex: index,
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? merged.projectGroupNo ?? null,
        modelCode: merged.modelCode ?? null,
        modelGroupCode: merged.modelGroupCode ?? result.modelGroupCode ?? null,
        promptSummary: taskPromptSummary(merged),
        pointCost: result.pointCost ?? null,
        firstResultUrl: result.firstResultUrl ?? null,
        timedOut: result.timedOut ?? null,
      });
      return {
        inputIndex: index,
        pointCost: result.pointCost ?? null,
        projectPointBalance: result.projectPointBalance ?? null,
        projectPointRemainingAfter: result.projectPointRemainingAfter ?? null,
        taskId: result.taskId ?? null,
        taskStatus: result.taskStatus ?? null,
        projectGroupNo: result.projectGroupNo ?? null,
        error: null,
        raw: JSON.stringify({
          input: item,
          result,
        }),
      };
    }));
  },
});

}
