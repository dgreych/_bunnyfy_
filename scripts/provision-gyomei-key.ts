import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { generateApiKey, parseApiKeysJson } from '../src/security/apiKeys.ts';

const CONSUMER_ID = 'gyomei-production';
const TEMPORARY_INSECURE_BASE_URL = 'http://node1.vexhost.com.br:20072';
const GYOMEI_SCOPES = Object.freeze([
  'ai:chat',
  'audio:write',
  'canvas:write',
  'downloads:write',
  'images:write',
  'media:read',
  'media:write',
]);
const GYOMEI_YOUTUBE_ONLY_SCOPES = Object.freeze(['downloads:write']);

interface Arguments {
  apiDir: string;
  botDir: string;
  baseUrl: string;
  rotate: boolean;
  youtubeOnly: boolean;
  allowInsecureHttp: boolean;
}

interface ApiKeyDefinition {
  id: string;
  key: string;
  scopes: string[];
}

function parseArguments(argv: readonly string[]): Arguments {
  const values = new Map<string, string>();
  let rotate = false;
  let youtubeOnly = false;
  let allowInsecureHttp = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--rotate') {
      rotate = true;
      continue;
    }
    if (argument === '--youtube-only') {
      youtubeOnly = true;
      continue;
    }
    if (argument === '--allow-insecure-http') {
      allowInsecureHttp = true;
      continue;
    }
    if (!['--api-dir', '--bot-dir', '--base-url'].includes(argument)) {
      throw new Error('argumento desconhecido');
    }
    const value = argv[index + 1];
    if (!value) throw new Error('argumento sem valor');
    values.set(argument, value);
    index += 1;
  }

  const apiDir = path.resolve(values.get('--api-dir') ?? process.cwd());
  const botDirRaw = values.get('--bot-dir');
  if (!botDirRaw) throw new Error('diretório do Gyomei ausente');

  const baseUrl = new URL(values.get('--base-url') ?? 'http://127.0.0.1:8080');
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new Error('URL base inválida');
  }

  const normalizedBaseUrl = baseUrl.toString().replace(/\/+$/, '');
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(baseUrl.hostname);
  const temporaryInsecureEndpoint =
    normalizedBaseUrl === TEMPORARY_INSECURE_BASE_URL
    && baseUrl.pathname === '/'
    && !baseUrl.search
    && !baseUrl.hash;

  if (baseUrl.protocol === 'http:' && !loopback) {
    if (!allowInsecureHttp || !temporaryInsecureEndpoint) {
      throw new Error('HTTP público só é permitido na allocation temporária explícita');
    }
  }
  if (allowInsecureHttp && !temporaryInsecureEndpoint) {
    throw new Error('--allow-insecure-http só pode ser usado com a allocation temporária exata');
  }

  return {
    apiDir,
    botDir: path.resolve(botDirRaw),
    baseUrl: normalizedBaseUrl,
    rotate,
    youtubeOnly,
    allowInsecureHttp,
  };
}

async function readOptional(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
}

function readEnvValue(content: string, name: string): string | undefined {
  for (const line of content.split(/\r?\n/)) {
    const match = new RegExp(`^\\s*${name}\\s*=(.*)$`).exec(line);
    if (!match) continue;
    const raw = match[1]!.trim();
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }
  return undefined;
}

function upsertEnvValues(content: string, values: ReadonlyMap<string, string>): string {
  const pending = new Map(values);
  const lines = content.split(/\r?\n/).filter((line, index, all) => !(index === all.length - 1 && line === ''));
  const output = lines.map((line) => {
    for (const [name, value] of pending) {
      if (new RegExp(`^\\s*${name}\\s*=`).test(line)) {
        pending.delete(name);
        return `${name}=${value}`;
      }
    }
    return line;
  });

  if (output.length > 0 && output.at(-1) !== '') output.push('');
  for (const [name, value] of pending) output.push(`${name}=${value}`);
  return `${output.join('\n')}\n`;
}

function parseExistingDefinitions(raw: string | undefined): ApiKeyDefinition[] {
  if (!raw?.trim()) return [];
  parseApiKeysJson(raw);
  const value = JSON.parse(raw) as unknown;
  if (!Array.isArray(value)) throw new Error('registro moderno inválido');
  return value as ApiKeyDefinition[];
}

async function assertExpectedRepository(directory: string, packageName: string): Promise<void> {
  const packageJson = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8')) as { name?: unknown };
  if (packageJson.name !== packageName) throw new Error('repositório inesperado');
}

async function writePrivateFile(filePath: string, content: string): Promise<void> {
  const directory = path.dirname(filePath);
  const tempName = `.env.provision-${process.pid}-${randomBytes(6).toString('hex')}.local`;
  const tempPath = path.join(directory, tempName);
  try {
    await fs.writeFile(tempPath, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  await assertExpectedRepository(args.apiDir, 'bunnyfy');
  await assertExpectedRepository(args.botDir, 'nazuna-gyomei');

  const apiEnvPath = path.join(args.apiDir, '.env');
  const botEnvPath = path.join(args.botDir, '.env.local');
  const apiEnv = await readOptional(apiEnvPath);
  const botEnv = await readOptional(botEnvPath);
  const definitions = parseExistingDefinitions(readEnvValue(apiEnv, 'BUNNYFY_API_KEYS'));
  const existingIndex = definitions.findIndex((definition) => definition.id === CONSUMER_ID);
  if (existingIndex >= 0 && !args.rotate) {
    throw new Error('o consumidor já possui chave; use --rotate conscientemente');
  }

  const apiKey = generateApiKey('live');
  const scopes = args.youtubeOnly ? GYOMEI_YOUTUBE_ONLY_SCOPES : GYOMEI_SCOPES;
  const definition = { id: CONSUMER_ID, key: apiKey, scopes: [...scopes] };
  if (existingIndex >= 0) definitions.splice(existingIndex, 1, definition);
  else definitions.push(definition);

  const serializedDefinitions = JSON.stringify(definitions);
  parseApiKeysJson(serializedDefinitions);

  const mediaSigningSecret = readEnvValue(apiEnv, 'MEDIA_SIGNING_SECRET') || randomBytes(32).toString('base64url');
  const nextApiEnv = upsertEnvValues(
    apiEnv,
    new Map([
      ['PUBLIC_BASE_URL', args.baseUrl],
      ['BUNNYFY_API_KEYS', serializedDefinitions],
      ['MEDIA_SIGNING_SECRET', mediaSigningSecret],
    ]),
  );
  const nextBotEnv = upsertEnvValues(
    botEnv,
    new Map([
      ['BUNNYFY_BASE_URL', args.baseUrl],
      ['BUNNYFY_API_TOKEN', apiKey],
      ['BUNNYFY_ENABLED', 'false'],
      ['BUNNYFY_ALLOW_INSECURE_HTTP', args.allowInsecureHttp ? 'true' : 'false'],
      ['BUNNYFY_AI_MODE', 'off'],
      ['BUNNYFY_YOUTUBE_MODE', args.youtubeOnly ? 'exclusive' : 'off'],
    ]),
  );

  await writePrivateFile(apiEnvPath, nextApiEnv);
  try {
    await writePrivateFile(botEnvPath, nextBotEnv);
  } catch (error) {
    await writePrivateFile(apiEnvPath, apiEnv);
    throw error;
  }

  process.stdout.write('Chave Gyomei criada e instalada nos dois arquivos privados; integração permanece desativada até o smoke.\n');
}

main().catch(() => {
  process.stderr.write('Não foi possível provisionar a chave Gyomei com segurança.\n');
  process.exitCode = 1;
});
