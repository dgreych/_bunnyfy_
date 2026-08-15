import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function positiveInteger(name, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name]?.trim();
  const value = raw ? Number(raw) : fallback;
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} inválido`);
  }
  return value;
}

async function readSharedSecret() {
  const direct = process.env.YOUTUBE_EGRESS_SHARED_SECRET?.trim();
  const secretFile = process.env.YOUTUBE_EGRESS_SHARED_SECRET_FILE?.trim();
  if (direct && secretFile) throw new Error('configure somente uma origem para o segredo');
  if (!secretFile) return direct || '';
  const resolved = path.resolve(secretFile);
  const stat = await fs.stat(resolved);
  if (!stat.isFile() || (stat.mode & 0o077) !== 0) {
    throw new Error('arquivo de segredo precisa ser regular e privado');
  }
  return (await fs.readFile(resolved, 'utf8')).trim();
}

const config = Object.freeze({
  host: process.env.HOST?.trim() || '127.0.0.1',
  port: positiveInteger('PORT', 43119, 65_535),
  secret: await readSharedSecret(),
  ytDlpPath: process.env.YTDLP_PATH?.trim() || 'yt-dlp',
  ffmpegPath: process.env.FFMPEG_PATH?.trim() || 'ffmpeg',
  jsRuntime: process.env.YOUTUBE_JS_RUNTIME?.trim() || 'node:/usr/bin/node',
  workDir: path.resolve(process.env.YOUTUBE_EGRESS_WORK_DIR?.trim() || '/tmp/bunnyfy-youtube-egress'),
  timeoutMs: positiveInteger('YOUTUBE_EGRESS_TIMEOUT_MS', 120_000, 300_000),
  maxBytes: positiveInteger('YOUTUBE_EGRESS_MAX_BYTES', 100 * 1024 * 1024, 500 * 1024 * 1024),
  maxDurationSeconds: positiveInteger('YOUTUBE_EGRESS_MAX_DURATION_SECONDS', 1_800, 7_200),
  maxBodyBytes: positiveInteger('YOUTUBE_EGRESS_MAX_BODY_BYTES', 2_048, 16_384),
});

if (config.secret.length < 32) throw new Error('YOUTUBE_EGRESS_SHARED_SECRET ausente ou curto');
if (config.host !== '127.0.0.1' && config.host !== '::1') {
  throw new Error('worker deve escutar somente em loopback');
}

let busy = false;

function digest(value) {
  return createHash('sha256').update(value).digest();
}

function authorized(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return false;
  const provided = header.slice('Bearer '.length);
  return timingSafeEqual(digest(provided), digest(config.secret));
}

function sendJson(response, statusCode, body) {
  const payload = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': payload.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(payload);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > config.maxBodyBytes) throw new Error('body-too-large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function parseInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  if (Object.keys(value).sort().join(',') !== 'inputType,value') return undefined;
  if (value.inputType === 'url' && typeof value.value === 'string' && /^[A-Za-z0-9_-]{11}$/.test(value.value)) {
    return `https://www.youtube.com/watch?v=${value.value}`;
  }
  if (
    value.inputType === 'query'
    && typeof value.value === 'string'
    && value.value.trim().length > 0
    && value.value.trim().length <= 200
    && !hasControlChars(value.value)
  ) {
    return `ytsearch1:${value.value.trim()}`;
  }
  return undefined;
}

function hasControlChars(value) {
  return [...value].some((char) => {
    const code = char.codePointAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function parseMetadata(stdout) {
  const line = stdout.split('\n').map((entry) => entry.trim()).filter(Boolean).at(-1);
  if (!line) throw new Error('metadata-missing');
  const value = JSON.parse(line);
  if (!value || typeof value !== 'object') throw new Error('metadata-invalid');
  const duration = Number(value.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > config.maxDurationSeconds) {
    throw new Error('duration-invalid');
  }
  const title = typeof value.title === 'string' ? value.title.trim().slice(0, 500) : '';
  return { duration, title };
}

async function produceAudio(input, jobDir) {
  const outputTemplate = path.join(jobDir, 'media.%(ext)s');
  const metadataTemplate = 'after_move:{"title":%(title)j,"duration":%(duration)j,"ext":%(ext)j}';
  const maxMegabytes = Math.max(1, Math.floor(config.maxBytes / (1024 * 1024)));
  const ffmpegArgs = config.ffmpegPath === 'ffmpeg'
    ? []
    : ['--ffmpeg-location', config.ffmpegPath];
  const args = [
    '--quiet',
    '--no-warnings',
    '--no-playlist',
    '--js-runtimes',
    config.jsRuntime,
    '--match-filter',
    `duration <= ${config.maxDurationSeconds} & !is_live`,
    '--max-filesize',
    `${maxMegabytes}M`,
    ...ffmpegArgs,
    '-x',
    '--audio-format',
    'mp3',
    '--audio-quality',
    '128K',
    '--print',
    metadataTemplate,
    '-o',
    outputTemplate,
    '--',
    input,
  ];

  const { stdout } = await execFileAsync(config.ytDlpPath, args, {
    timeout: config.timeoutMs,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
    shell: false,
    encoding: 'utf8',
  });
  const metadata = parseMetadata(stdout);
  const outputPath = path.join(jobDir, 'media.mp3');
  const stat = await fs.stat(outputPath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > config.maxBytes) throw new Error('output-invalid');
  return { outputPath, sizeBytes: stat.size, ...metadata };
}

async function handleAudio(request, response) {
  if (!authorized(request)) {
    request.resume();
    sendJson(response, 401, { ok: false, code: 'UNAUTHORIZED' });
    return;
  }
  if (busy) {
    request.resume();
    sendJson(response, 429, { ok: false, code: 'BUSY' });
    return;
  }
  if (request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    request.resume();
    sendJson(response, 415, { ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
    return;
  }

  let payload;
  try {
    payload = await readJsonBody(request);
  } catch {
    sendJson(response, 400, { ok: false, code: 'INVALID_BODY' });
    return;
  }
  const input = parseInput(payload);
  if (!input) {
    sendJson(response, 400, { ok: false, code: 'INVALID_INPUT' });
    return;
  }

  busy = true;
  const jobDir = path.join(config.workDir, randomUUID());
  try {
    await fs.mkdir(jobDir, { recursive: false, mode: 0o700 });
    const result = await produceAudio(input, jobDir);
    const file = await fs.open(result.outputPath, 'r');
    const title = Buffer.from(result.title, 'utf8').toString('base64url');
    response.writeHead(200, {
      'content-type': 'audio/mpeg',
      'content-length': result.sizeBytes,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'x-bunnyfy-duration-seconds': String(result.duration),
      'x-bunnyfy-title': title,
    });
    await pipeline(file.createReadStream({ autoClose: true }), response);
  } catch (error) {
    if (!response.headersSent) {
      const timeout = error && typeof error === 'object' && error.killed === true;
      sendJson(response, timeout ? 504 : 503, {
        ok: false,
        code: timeout ? 'TIMEOUT' : 'UNAVAILABLE',
      });
    } else {
      response.destroy();
    }
  } finally {
    busy = false;
    await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

await fs.mkdir(config.workDir, { recursive: true, mode: 0o700 });
await fs.chmod(config.workDir, 0o700);

const server = http.createServer((request, response) => {
  const requestId = randomUUID();
  response.setHeader('x-request-id', requestId);
  if (request.method === 'GET' && request.url === '/health') {
    sendJson(response, 200, { ok: true, busy });
    return;
  }
  if (request.method === 'POST' && request.url === '/v1/youtube/audio') {
    void handleAudio(request, response);
    return;
  }
  request.resume();
  sendJson(response, 404, { ok: false, code: 'NOT_FOUND' });
});

server.requestTimeout = config.timeoutMs + 10_000;
server.headersTimeout = 10_000;
server.listen(config.port, config.host, () => {
  process.stdout.write(`youtube-egress ready on ${config.host}:${config.port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
