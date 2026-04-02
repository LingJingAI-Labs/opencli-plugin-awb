import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const API_ORIGIN = 'https://animeworkbench.lingjingai.cn';
export const WEB_ORIGIN = API_ORIGIN;
const OPENCLI_HOME_DIR = path.join(os.homedir(), '.opencli');
const STANDALONE_HOME_DIR = path.join(os.homedir(), '.lingjingai', 'awb');
const LEGACY_OPENCLI_AUTH_PATH = path.join(OPENCLI_HOME_DIR, 'awb-auth.json');
const LEGACY_OPENCLI_STATE_PATH = path.join(OPENCLI_HOME_DIR, 'awb-state.json');
const LEGACY_COMPAT_AUTH_PATH = path.join(os.homedir(), '.animeworkbench_auth.json');
const IS_OPENCLI_RUNTIME =
  process.argv.some((arg) => /(^|[\\/])opencli(?:$|[\\/])/.test(String(arg))) ||
  import.meta.url.includes('/.opencli/plugins/');
export const APP_HOME_DIR =
  process.env.AWB_STATE_DIR ||
  (IS_OPENCLI_RUNTIME ? OPENCLI_HOME_DIR : STANDALONE_HOME_DIR);
export const AUTH_PATH =
  process.env.AWB_AUTH_PATH ||
  path.join(APP_HOME_DIR, IS_OPENCLI_RUNTIME ? 'awb-auth.json' : 'auth.json');
export const AUTH_COMPAT_PATH =
  process.env.AWB_AUTH_COMPAT_PATH ||
  (IS_OPENCLI_RUNTIME ? LEGACY_COMPAT_AUTH_PATH : null);
export const STATE_PATH =
  process.env.AWB_STATE_PATH ||
  path.join(APP_HOME_DIR, IS_OPENCLI_RUNTIME ? 'awb-state.json' : 'state.json');
export const PRODUCT_CODE = '1004';
export const SOURCE = 'pc';
export const SEND_CODE_SCENE_ID = '18rjt5bc';
export const SEND_CODE_PRODUCT_CODE = 1001;
export const REDEEM_CODE_RE = /^(?:[A-Z0-9]{4}-){3}[A-Z0-9]{4}$/i;
export const TASK_UPLOAD_SCENE = {
  IMAGE_CREATE: 'material-image-draw',
  IMAGE_EDIT: 'material-image-edit',
  VIDEO_CREATE: 'material-video-create',
  VIDEO_GROUP: 'material-video-create',
  LIP_SYNC: 'material-image-draw',
};

function parentDir(filePath) {
  return path.dirname(filePath);
}

async function ensureParent(filePath) {
  await fs.mkdir(parentDir(filePath), { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, 'utf8');
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, value) {
  await ensureParent(filePath);
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function writeJsonSecure(filePath, value) {
  await writeJson(filePath, value);
  await fs.chmod(filePath, 0o600).catch(() => {});
}

function sha1(input, encoding = 'hex') {
  return crypto.createHash('sha1').update(input).digest(encoding);
}

function hmacSha1(key, input, encoding = 'hex') {
  return crypto.createHmac('sha1', key).update(input).digest(encoding);
}

function encodeCosValue(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function buildCosAuthorization({
  secretKey,
  secretId,
  method,
  objectName,
  contentLength,
  host,
  startTime,
  expiredTime,
}) {
  const signTime = `${startTime};${expiredTime}`;
  const signKey = hmacSha1(secretKey, signTime);
  const httpString = [
    method.toLowerCase(),
    `/${objectName}`,
    '',
    `content-length=${encodeCosValue(contentLength)}&host=${encodeCosValue(host)}`,
    '',
  ].join('\n');
  const stringToSign = ['sha1', signTime, sha1(httpString), ''].join('\n');
  const signature = hmacSha1(signKey, stringToSign);
  return [
    'q-sign-algorithm=sha1',
    `q-ak=${secretId}`,
    `q-sign-time=${signTime}`,
    `q-key-time=${signTime}`,
    'q-header-list=content-length;host',
    'q-url-param-list=',
    `q-signature=${signature}`,
  ].join('&');
}

function safeFileName(filePath) {
  return path
    .basename(filePath)
    .replace(/[^0-9A-Za-z._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'upload.bin';
}

function guessMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.mp3':
      return 'audio/mpeg';
    case '.wav':
      return 'audio/wav';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

function parsePngSize(buffer) {
  const signature = '89504e470d0a1a0a';
  if (buffer.length < 24 || buffer.subarray(0, 8).toString('hex') !== signature) {
    return null;
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    format: 'png',
  };
}

function parseJpegSize(buffer) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1];
    const size = buffer.readUInt16BE(offset + 2);
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
        format: 'jpeg',
      };
    }
    offset += 2 + size;
  }
  return null;
}

function parseWebpSize(buffer) {
  if (buffer.length < 30) return null;
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF') return null;
  if (buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  const chunkType = buffer.subarray(12, 16).toString('ascii');
  if (chunkType === 'VP8 ') {
    if (buffer.length < 30) return null;
    return {
      width: buffer.readUInt16LE(26) & 0x3fff,
      height: buffer.readUInt16LE(28) & 0x3fff,
      format: 'webp',
    };
  }
  if (chunkType === 'VP8L') {
    const bits = buffer.readUInt32LE(21);
    return {
      width: (bits & 0x3fff) + 1,
      height: ((bits >> 14) & 0x3fff) + 1,
      format: 'webp',
    };
  }
  if (chunkType === 'VP8X') {
    return {
      width: 1 + buffer.readUIntLE(24, 3),
      height: 1 + buffer.readUIntLE(27, 3),
      format: 'webp',
    };
  }
  return null;
}

export async function readImageMetadata(filePath) {
  const buffer = await fs.readFile(filePath);
  const parsed = parsePngSize(buffer) ?? parseJpegSize(buffer) ?? parseWebpSize(buffer);
  return {
    size: buffer.length,
    mimeType: guessMimeType(filePath),
    ...(parsed ?? {}),
  };
}

export async function loadAuth() {
  const fallbackAuthPath =
    !IS_OPENCLI_RUNTIME && AUTH_PATH !== LEGACY_OPENCLI_AUTH_PATH
      ? LEGACY_OPENCLI_AUTH_PATH
      : null;
  const fallbackCompatPath =
    !IS_OPENCLI_RUNTIME && AUTH_COMPAT_PATH !== LEGACY_COMPAT_AUTH_PATH
      ? LEGACY_COMPAT_AUTH_PATH
      : null;
  const [primary, compat, fallbackPrimary, fallbackCompat] = await Promise.all([
    readJson(AUTH_PATH, null),
    AUTH_COMPAT_PATH ? readJson(AUTH_COMPAT_PATH, null) : Promise.resolve(null),
    fallbackAuthPath ? readJson(fallbackAuthPath, null) : Promise.resolve(null),
    fallbackCompatPath ? readJson(fallbackCompatPath, null) : Promise.resolve(null),
  ]);
  const resolvedPrimary = primary ?? fallbackPrimary;
  const resolvedCompat = compat ?? fallbackCompat;
  if (!resolvedPrimary && !resolvedCompat) return null;
  return mergeAuthRecords(resolvedPrimary, resolvedCompat);
}

export async function saveAuth(auth) {
  const current = mergeAuthRecords(
    await readJson(AUTH_PATH, null),
    AUTH_COMPAT_PATH ? await readJson(AUTH_COMPAT_PATH, null) : null,
  );
  const next = {
    ...current,
    ...auth,
    updatedAt: new Date().toISOString(),
  };
  const writes = [writeJsonSecure(AUTH_PATH, next)];
  if (AUTH_COMPAT_PATH) {
    writes.push(writeJsonSecure(AUTH_COMPAT_PATH, toCompatAuthShape(next)));
  }
  await Promise.all(writes);
  return next;
}

export async function clearAuth() {
  const deletes = [fs.unlink(AUTH_PATH).catch(() => {})];
  if (AUTH_COMPAT_PATH) {
    deletes.push(fs.unlink(AUTH_COMPAT_PATH).catch(() => {}));
  }
  await Promise.all(deletes);
}

export async function loadState() {
  const current = await readJson(STATE_PATH, null);
  if (current) return current;
  if (!IS_OPENCLI_RUNTIME && STATE_PATH !== LEGACY_OPENCLI_STATE_PATH) {
    return (await readJson(LEGACY_OPENCLI_STATE_PATH, {})) ?? {};
  }
  return {};
}

export async function saveState(state) {
  const current = (await loadState()) ?? {};
  const next = {
    ...current,
    ...state,
    updatedAt: new Date().toISOString(),
  };
  await writeJson(STATE_PATH, next);
  return next;
}

export function parseJsonArg(value, fallback = undefined) {
  if (value === undefined || value === null || value === '') return fallback;
  return JSON.parse(value);
}

export function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function unwrapApiResponse(payload, fallbackMessage = 'Request failed') {
  if (payload == null) return payload;
  if (typeof payload !== 'object') return payload;

  if ('code' in payload && payload.code !== 200) {
    throw new Error(payload.msg || fallbackMessage);
  }

  if ('data' in payload) return payload.data;
  return payload;
}

function buildHeaders(token) {
  const headers = {
    'content-type': 'application/json',
    productcode: PRODUCT_CODE,
    source: SOURCE,
    timestamp: String(Date.now()),
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') return {};
  const parts = token.split('.');
  if (parts.length < 2) return {};
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    return JSON.parse(Buffer.from(base64 + padding, 'base64').toString('utf8'));
  } catch {
    return {};
  }
}

function normalizeExpiresAt(expires) {
  if (expires === undefined || expires === null || expires === '') return undefined;
  const value = Number(expires);
  if (!Number.isFinite(value)) return undefined;
  return value < 1_000_000_000_000 ? Date.now() + value : value;
}

function choosePreferredToken(primary, compat) {
  const primaryExpiresAt = normalizeExpiresAt(primary?.expiresAt) ?? 0;
  const compatExpiresAt = normalizeExpiresAt(compat?.expiresAt) ?? 0;
  if (!primary?.token && compat?.token) {
    return { token: compat.token, expiresAt: compatExpiresAt || compat?.expiresAt };
  }
  if (compat?.token && compatExpiresAt > primaryExpiresAt + 1000) {
    return { token: compat.token, expiresAt: compatExpiresAt || compat?.expiresAt };
  }
  return { token: primary?.token, expiresAt: primaryExpiresAt || primary?.expiresAt };
}

function mergeAuthRecords(primary, compat) {
  const merged = {
    ...(compat ?? {}),
    ...(primary ?? {}),
  };
  const preferred = choosePreferredToken(primary, compat);
  const jwtPayload = decodeJwtPayload(preferred.token);
  const firstGroupMember =
    Array.isArray(primary?.groupMembers) && primary.groupMembers.length
      ? primary.groupMembers[0]
      : Array.isArray(compat?.groupMembers) && compat.groupMembers.length
        ? compat.groupMembers[0]
        : null;

  merged.token = preferred.token ?? merged.token ?? null;
  merged.expiresAt = preferred.expiresAt ?? merged.expiresAt ?? null;
  merged.refreshToken = primary?.refreshToken ?? compat?.refreshToken ?? merged.refreshToken ?? null;
  merged.groupId =
    primary?.groupId ??
    compat?.groupId ??
    primary?.currentGroupId ??
    compat?.currentGroupId ??
    firstGroupMember?.groupId ??
    jwtPayload.groupId ??
    null;
  merged.currentGroupId = primary?.currentGroupId ?? compat?.currentGroupId ?? merged.groupId ?? null;
  merged.userId = primary?.userId ?? compat?.userId ?? jwtPayload.sub ?? jwtPayload.userId ?? null;
  merged.userName =
    primary?.userName ??
    compat?.userName ??
    jwtPayload.userName ??
    jwtPayload.username ??
    null;
  return merged;
}

function toCompatAuthShape(auth) {
  if (!auth || typeof auth !== 'object') return {};
  return {
    refreshToken: auth.refreshToken ?? null,
    groupId: auth.groupId ?? auth.currentGroupId ?? null,
    userId: auth.userId ?? null,
    token: auth.token ?? null,
    expiresAt: normalizeExpiresAt(auth.expiresAt) ?? auth.expiresAt ?? null,
    userName: auth.userName ?? null,
    updatedAt: auth.updatedAt ?? new Date().toISOString(),
  };
}

export async function saveLoginPayload(payload, extras = {}) {
  const existing = (await loadAuth()) ?? {};
  const nextToken = payload?.token ?? existing.token;
  const jwtPayload = decodeJwtPayload(nextToken);
  const inferredGroupMember =
    Array.isArray(payload?.groupMembers) && payload.groupMembers.length === 1
      ? payload.groupMembers[0]
      : null;
  const inferredGroupId =
    extras?.groupId ??
    extras?.currentGroupId ??
    payload?.groupId ??
    payload?.currentGroupId ??
    inferredGroupMember?.groupId ??
    existing.groupId ??
    existing.currentGroupId ??
    jwtPayload.groupId;
  const inferredUserId =
    extras?.userId ??
    payload?.userId ??
    payload?.id ??
    existing.userId ??
    jwtPayload.sub ??
    jwtPayload.userId;
  const inferredUserName =
    extras?.userName ??
    payload?.userName ??
    existing.userName ??
    jwtPayload.userName ??
    jwtPayload.username;
  const next = {
    ...existing,
    ...extras,
    token: nextToken,
    refreshToken:
      payload?.session ??
      payload?.refreshToken ??
      extras?.refreshToken ??
      existing.refreshToken,
    expiresAt:
      normalizeExpiresAt(payload?.expires) ??
      normalizeExpiresAt(payload?.expiresAt) ??
      existing.expiresAt,
    groupId: inferredGroupId ?? null,
    currentGroupId: extras?.currentGroupId ?? payload?.currentGroupId ?? inferredGroupId ?? null,
    currentGroupName:
      extras?.currentGroupName ??
      payload?.groupName ??
      payload?.currentGroupName ??
      existing.currentGroupName ??
      null,
    userId: inferredUserId ?? null,
    userName: inferredUserName ?? null,
    groupMembers: payload?.groupMembers ?? existing.groupMembers,
    tempToken: payload?.tempToken ?? existing.tempToken,
    lastAuthError: null,
    authInvalidAt: null,
  };
  return saveAuth(next);
}

export function isAuthExpiredMessage(message) {
  const text = String(message ?? '').trim();
  return /登录状态已过期|登录已过期|登录失效|refresh token.*expired|session.*expired/i.test(text);
}

export async function markAuthInvalid(reason = '登录状态已过期') {
  const existing = (await loadAuth()) ?? {};
  return saveAuth({
    ...existing,
    token: null,
    refreshToken: null,
    expiresAt: null,
    lastAuthError: reason,
    authInvalidAt: new Date().toISOString(),
  });
}

function reloginHint(reason = '登录状态已过期') {
  return `${reason}，请重新执行 \`opencli awb login-qr\``;
}

export async function refreshAuth(forceRefreshToken) {
  const auth = (await loadAuth()) ?? {};
  const refreshToken = forceRefreshToken ?? auth.refreshToken;
  if (!refreshToken) {
    if (auth?.lastAuthError) {
      throw new Error(reloginHint(auth.lastAuthError));
    }
    throw new Error('未找到可续期的登录信息，请先执行 `opencli awb login-qr` 或 `opencli awb phone-login`。');
  }

  try {
    const response = await fetch(`${API_ORIGIN}/api/anime/user/account/refreshToken`, {
      method: 'POST',
      headers: buildHeaders(auth.token),
      body: JSON.stringify({ refreshToken }),
    });
    const payload = unwrapApiResponse(await response.json(), '刷新登录态失败');
    return saveLoginPayload(payload, { refreshToken });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isAuthExpiredMessage(message)) {
      await markAuthInvalid('登录状态已过期');
      throw new Error(reloginHint('登录状态已过期'));
    }
    throw error;
  }
}

export async function ensureAuth() {
  const auth = await loadAuth();
  if (!auth?.token) {
    if (auth?.refreshToken) {
      return refreshAuth(auth.refreshToken);
    }
    if (auth?.lastAuthError) {
      throw new Error(reloginHint(auth.lastAuthError));
    }
    throw new Error('当前未登录，请先执行 `opencli awb login-qr` 或 `opencli awb phone-login`。');
  }
  if (
    auth.expiresAt !== undefined &&
    auth.expiresAt !== null &&
    Number(auth.expiresAt) <= Date.now() + 30_000
  ) {
    return refreshAuth();
  }
  return auth;
}

export async function apiFetch(pathname, options = {}) {
  const {
    method = 'POST',
    query,
    body,
    auth = true,
    retryOnUnauthorized = true,
  } = options;

  let token;
  if (auth) {
    token = (await ensureAuth()).token;
  }

  const url = new URL(pathname, API_ORIGIN);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }
  }

  const response = await fetch(url, {
    method,
    headers: buildHeaders(token),
    body: method === 'GET' ? undefined : body === undefined ? undefined : JSON.stringify(body),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  const unauthorized = response.status === 401 || payload?.code === 401;
  if (auth && retryOnUnauthorized && unauthorized) {
    await refreshAuth();
    return apiFetch(pathname, { ...options, retryOnUnauthorized: false });
  }

  if (!response.ok) {
    throw new Error(payload?.msg || `${response.status} ${response.statusText}`);
  }

  return unwrapApiResponse(payload);
}

export function firstArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const nested of Object.values(value)) {
    const found = firstArray(nested);
    if (found.length) return found;
  }
  return [];
}

export function flattenRecord(record, prefix = '', out = {}) {
  if (record == null) return out;
  for (const [key, value] of Object.entries(record)) {
    const nextKey = prefix ? `${prefix}_${key}` : key;
    if (value == null) {
      out[nextKey] = value;
    } else if (Array.isArray(value)) {
      out[nextKey] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      flattenRecord(value, nextKey, out);
    } else {
      out[nextKey] = value;
    }
  }
  return out;
}

export function extractPointBalance(payload) {
  if (payload == null) return null;
  if (typeof payload === 'number') return payload;
  if (typeof payload !== 'object') return null;

  const candidates = [
    payload.point,
    payload.groupPoint,
    payload.availablePoint,
    payload.totalPoint,
    payload.teamIntegral,
    payload.projectGroupIntegralCurrent,
    payload.personIntegralCurrent,
  ];

  for (const value of candidates) {
    if (value === undefined || value === null || value === '') continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }

  return null;
}

export async function resolveProjectGroupNo(explicit) {
  if (explicit) return explicit;

  const state = await loadState();
  const last = await apiFetch('/api/anime/workbench/projectGroup/getLastProjectGroup', {
    method: 'GET',
  }).catch(() => null);
  const projectGroupNo =
    (typeof last === 'string' ? last : null) ??
    last?.projectGroupNo ??
    last?.lastProjectGroupNo ??
    last?.projectGroup?.projectGroupNo ??
    state.currentProjectGroupNo;

  if (!projectGroupNo) {
    throw new Error(
      'No project group selected. Use `opencli awb project-group-select --projectGroupNo <id>` or `opencli awb project-group-create --name <name>` first.',
    );
  }

  await saveState({ currentProjectGroupNo: projectGroupNo });
  return projectGroupNo;
}

export function normalizeCode(value) {
  return String(value || '').trim().toUpperCase();
}

export function safeAuthSummary(auth) {
  const expiresAt = auth?.expiresAt ?? null;
  const hasToken = Boolean(auth?.token);
  const hasRefreshToken = Boolean(auth?.refreshToken);
  const lastAuthError = auth?.lastAuthError ?? null;
  return {
    hasToken,
    hasRefreshToken,
    hasTempToken: Boolean(auth?.tempToken),
    expiresAt,
    loginState: lastAuthError
      ? '登录失效'
      : !hasToken
        ? '未登录'
        : expiresAt != null && Number(expiresAt) <= Date.now()
          ? hasRefreshToken
            ? '缓存过期'
            : '已过期'
          : '已登录',
    lastAuthError,
    authInvalidAt: auth?.authInvalidAt ?? null,
    updatedAt: auth?.updatedAt ?? null,
  };
}

export function sanitizeLoginResult(result) {
  return {
    status: result.status,
    loginMethod: result.loginMethod,
    needsBind: Boolean(result.needsBind),
    qrUrl: result.qrUrl,
    sceneStr: result.sceneStr,
    currentGroupName: result.currentGroupName ?? null,
    currentGroupId: result.currentGroupId ?? null,
    groupCount: result.groupCount ?? 0,
  };
}

export async function uploadLocalFile(filePath, options = {}) {
  const sceneType = options.sceneType ?? TASK_UPLOAD_SCENE.IMAGE_CREATE;
  const projectNo = options.projectNo ?? '';
  const absolutePath = path.resolve(filePath);
  const buffer = await fs.readFile(absolutePath);
  const imageMeta =
    guessMimeType(absolutePath).startsWith('image/')
      ? await readImageMetadata(absolutePath).catch(() => ({
          size: buffer.length,
          mimeType: guessMimeType(absolutePath),
        }))
      : {
          size: buffer.length,
          mimeType: guessMimeType(absolutePath),
        };
  const groupId = crypto.randomUUID().replaceAll('-', '');
  const secret = await apiFetch('/api/anime/workbench/TencentCloud/getSecret', {
    body: {
      sceneType,
      groupId,
      projectNo,
    },
  });
  const objectName = `${secret.path}${secret.prefix}${Date.now()}-${safeFileName(absolutePath)}`;
  const host = `${secret.bucket}.cos.${secret.region}.myqcloud.com`;
  const authorization = buildCosAuthorization({
    secretKey: secret.credentials.tmpSecretKey,
    secretId: secret.credentials.tmpSecretId,
    method: 'PUT',
    objectName,
    contentLength: buffer.length,
    host,
    startTime: secret.startTime,
    expiredTime: secret.expiredTime,
  });

  const uploadResponse = await fetch(`https://${host}/${objectName}`, {
    method: 'PUT',
    headers: {
      authorization,
      'content-length': String(buffer.length),
      'content-type': imageMeta.mimeType,
      host,
      'x-cos-security-token': secret.credentials.sessionToken,
    },
    body: buffer,
  });

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status} ${uploadResponse.statusText}`);
  }

  const signedUrl = await apiFetch('/api/anime/workbench/TencentCloud/getObjectSignUrl', {
    method: 'GET',
    query: { objectName },
  });

  return {
    filePath: absolutePath,
    fileName: path.basename(absolutePath),
    sceneType,
    mimeType: imageMeta.mimeType,
    size: imageMeta.size ?? buffer.length,
    width: imageMeta.width ?? null,
    height: imageMeta.height ?? null,
    objectName,
    backendPath: `/${objectName}`,
    signedUrl,
    publicUrl: `https://${host}/${objectName}`,
    bucket: secret.bucket,
    region: secret.region,
    groupId,
  };
}

export async function uploadLocalFiles(filePaths, options = {}) {
  const results = [];
  for (const filePath of filePaths) {
    results.push(await uploadLocalFile(filePath, options));
  }
  return results;
}
