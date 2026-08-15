import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { buildConfig } from '../src/config.ts';

const PLACEHOLDER_PATTERN = /SUBSTITUA|COLOQUE|PLACEHOLDER|SUA?_CHAVE|SEU_TOKEN/i;
const MODEL_PATTERN = /^[A-Za-z0-9._/-]+$/;

function parseArguments(argv: readonly string[]): { model: string; allowedModels: string[]; enable: boolean } {
  let model = '';
  const allowedModels: string[] = [];
  let enable = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === '--enable') {
      enable = true;
      continue;
    }
    if (!['--model', '--allow-model'].includes(argument) || !argv[index + 1]) {
      throw new Error('argumentos inválidos');
    }
    const value = argv[index + 1]!.trim();
    if (argument === '--model') model = value;
    else allowedModels.push(value);
    index += 1;
  }
  if (!MODEL_PATTERN.test(model) || model.length > 200) throw new Error('modelo inválido');
  const effectiveAllowedModels = allowedModels.length > 0 ? allowedModels : [model];
  if (
    effectiveAllowedModels.length > 32 ||
    effectiveAllowedModels.some((value) => !MODEL_PATTERN.test(value) || value.length > 200) ||
    new Set(effectiveAllowedModels).size !== effectiveAllowedModels.length ||
    !effectiveAllowedModels.includes(model)
  ) {
    throw new Error('allowlist de modelos inválida');
  }
  return { model, allowedModels: effectiveAllowedModels, enable };
}

async function readPrivateKey(): Promise<string> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    total += bytes.length;
    if (total > 2_048) throw new Error('entrada privada acima do limite');
    chunks.push(bytes);
  }
  const key = Buffer.concat(chunks, total).toString('utf8').trim();
  if (key.length < 16 || key.length > 512 || PLACEHOLDER_PATTERN.test(key) || /\s/.test(key)) {
    throw new Error('credencial inválida');
  }
  return key;
}

function parseEnv(content: string): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2]!.trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[match[1]!] = value;
  }
  return result;
}

function upsert(content: string, values: ReadonlyMap<string, string>): string {
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

async function main(): Promise<void> {
  const args = parseArguments(process.argv.slice(2));
  const key = await readPrivateKey();
  const envPath = path.resolve(process.cwd(), '.env');
  let current = '';
  try {
    current = await fs.readFile(envPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  const values = new Map([
    ['NVIDIA_API_KEY', key],
    ['NVIDIA_MODEL', args.model],
    ['NVIDIA_ALLOWED_MODELS', args.allowedModels.join(',')],
    ...(args.enable ? ([['AI_CHAT_ENABLED', 'true']] as const) : []),
  ]);
  const next = upsert(current, values);
  buildConfig({ ...process.env, ...parseEnv(next) });

  const tempPath = path.resolve(process.cwd(), `.env.configure-${process.pid}-${randomBytes(6).toString('hex')}`);
  try {
    await fs.writeFile(tempPath, next, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await fs.rename(tempPath, envPath);
    await fs.chmod(envPath, 0o600);
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
  process.stdout.write(`Configuração privada de IA ${args.enable ? 'ativada' : 'atualizada'} sem exibir a credencial.\n`);
}

main().catch(() => {
  process.stderr.write('Não foi possível atualizar a configuração privada de IA.\n');
  process.exitCode = 1;
});
