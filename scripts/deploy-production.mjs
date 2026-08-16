#!/usr/bin/env node

import crypto from 'node:crypto';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { setTimeout } from 'node:timers';
import { URL, fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
const LOCK_PATH = '.deploy/tavern-v4-release-lock.json';
const GYOMEI_RUNTIME_IA_PATH = 'dados/src/funcs/private/.runtime-ia.js';
const GYOMEI_ENV_PATH = '.env.local';
const STARTING_EVIDENCE_WINDOW_MS = 30_000;
const STARTING_MAX_SAMPLE_GAP_MS = 12_000;
const START_MAX_ATTEMPTS = 120;
const START_SAMPLE_INTERVAL_MS = 3_000;
const SERVERS = Object.freeze({
  bunnyfy: Object.freeze({
    identifier: '90eb70dc',
    uuid: '90eb70dc-2ea5-472b-8e51-6c80b80ce76f',
    name: 'BunnyFy'
  }),
  gyomei: Object.freeze({
    identifier: 'd56f3096',
    uuid: 'd56f3096-96a0-4841-acdc-44f14b4aa59b',
    name: 'Gyomei Nazuna'
  })
});
const DENYLIST = new Set(['0b8a7d48']);
const CONFIRMATIONS = Object.freeze({
  bunnyfy: 'DEPLOY_BUNNYFY_PRODUCTION',
  gyomei: 'DEPLOY_GYOMEI_PRODUCTION'
});
const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const PROTECTED = [
  '.env', '.env.local', '.git/', '.github/', 'data/', 'database/', 'logs/', 'node_modules/',
  'sessions/', 'storage/', 'dados/database/', 'dados/logs/', 'dados/sessions/'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function safeErrorMessage(error) {
  const raw = error instanceof Error ? error.message : 'erro não identificado';
  return String(raw)
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/(?:https?:\/\/)[^\s)]+/gi, '[url-redacted]')
    .replace(/(?:ptlc_|cfut_|nvapi-)[A-Za-z0-9._-]+/g, '[token-redacted]')
    .slice(0, 500);
}

function stateEvidence(state) {
  return `state=${state?.state || 'unknown'}, uptimeMs=${Number(state?.uptime || 0)}, memory=${Number(state?.memoryBytes || 0) > 0 ? 'active' : 'zero'}`;
}

function argument(name) {
  return process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) || '';
}

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`A configuração protegida ${name} não está disponível.`);
  return value;
}

function validSha(value, label) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(normalized)) throw new Error(`${label} precisa ser um SHA completo de 40 caracteres.`);
  return normalized;
}

function validReleaseId(value) {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,99}$/.test(normalized)) {
    throw new Error('release_id inválido; use 8 a 100 caracteres seguros.');
  }
  return normalized;
}

function isReplaceableFailedLock(lock) {
  if (!lock || typeof lock !== 'object' || Array.isArray(lock)) return false;
  const allowedKeys = new Set([
    'schemaVersion', 'releaseId', 'bunnyfySha', 'gyomeiSha', 'stage',
    'createdAt', 'readyAt', 'failedAt'
  ]);
  if (!Object.keys(lock).every(key => allowedKeys.has(key))) return false;
  if (lock.schemaVersion !== 1 || lock.stage !== 'gyomei_failed_rolled_back') return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{7,99}$/.test(lock.releaseId)) return false;
  if (!/^[a-f0-9]{40}$/.test(lock.bunnyfySha) || !/^[a-f0-9]{40}$/.test(lock.gyomeiSha)) return false;
  if (typeof lock.createdAt !== 'string' || !Number.isFinite(Date.parse(lock.createdAt))) return false;
  if (typeof lock.failedAt !== 'string' || !Number.isFinite(Date.parse(lock.failedAt))) return false;
  if (lock.readyAt !== undefined && (typeof lock.readyAt !== 'string' || !Number.isFinite(Date.parse(lock.readyAt)))) return false;
  return true;
}

function supportsStartingCompatibility(server) {
  return server?.identifier === SERVERS.bunnyfy.identifier || server?.identifier === SERVERS.gyomei.identifier;
}

function hasStartingCompatibilityEvidence(observations) {
  if (!Array.isArray(observations) || observations.length < 2) return false;
  const last = observations.at(-1);
  for (let start = 0; start < observations.length - 1; start += 1) {
    const window = observations.slice(start);
    if (last.observedAt - window[0].observedAt < STARTING_EVIDENCE_WINDOW_MS) continue;
    let valid = true;
    let observedGrowth = false;
    for (let index = 0; index < window.length; index += 1) {
      const current = window[index];
      if (current.state !== 'starting' || current.uptime < 15_000 || current.memoryBytes <= 0) {
        valid = false;
        break;
      }
      if (index === 0) continue;
      const previous = window[index - 1];
      const gap = current.observedAt - previous.observedAt;
      if (gap <= 0 || gap > STARTING_MAX_SAMPLE_GAP_MS || current.uptime < previous.uptime) {
        valid = false;
        break;
      }
      if (current.uptime > previous.uptime) observedGrowth = true;
    }
    if (valid && observedGrowth) return true;
  }
  return false;
}

function validatePath(relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.startsWith('/') || relativePath.includes('\\')) {
    throw new Error(`${label} contém caminho inválido.`);
  }
  const normalized = path.posix.normalize(relativePath);
  if (normalized !== relativePath || normalized.split('/').includes('..')) throw new Error(`${label} escapa da raiz.`);
  const lower = normalized.toLowerCase();
  if (PROTECTED.some(item => lower === item.replace(/\/$/, '') || lower.startsWith(item))) {
    throw new Error(`${label} tenta tocar caminho persistente/protegido: ${relativePath}`);
  }
  if (/(^|\/)(docs?|tests?|__tests__)(\/|$)/i.test(normalized)) {
    throw new Error(`${label} não é arquivo de runtime: ${relativePath}`);
  }
  return normalized;
}

function loadManifest(manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest?.schemaVersion !== 1 || !['bunnyfy', 'gyomei'].includes(manifest?.role)) {
    throw new Error('Manifesto de produção incompatível.');
  }
  if (typeof manifest.repository !== 'string' || !manifest.repository.includes('/')) throw new Error('Repositório ausente no manifesto.');
  if (!Array.isArray(manifest.files) || !manifest.files.length || !Array.isArray(manifest.delete)) {
    throw new Error('Manifesto precisa declarar files e delete explicitamente.');
  }
  manifest.files = manifest.files.map(value => validatePath(value, 'files'));
  manifest.delete = manifest.delete.map(value => validatePath(value, 'delete'));
  if (new Set(manifest.files).size !== manifest.files.length || new Set(manifest.delete).size !== manifest.delete.length) {
    throw new Error('Manifesto contém caminhos duplicados.');
  }
  if (manifest.delete.some(value => manifest.files.includes(value))) throw new Error('Um caminho não pode ser enviado e removido no mesmo lote.');
  for (const relativePath of manifest.files) {
    const absolutePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw new Error(`Arquivo allowlisted ausente no checkout: ${relativePath}`);
    }
  }
  return manifest;
}

function validateCheckout(manifest, expectedSha) {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim().toLowerCase();
  if (head !== expectedSha) throw new Error('O HEAD do checkout diverge de expected_sha.');
  if (String(process.env.GITHUB_SHA || '').trim().toLowerCase() !== expectedSha) {
    throw new Error('O SHA entregue pelo GitHub diverge de expected_sha.');
  }
  if (process.env.GITHUB_REPOSITORY !== manifest.repository) throw new Error('O workflow foi executado no repositório errado.');
  const tracked = new Set(execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean));
  for (const relativePath of manifest.files) {
    if (!tracked.has(relativePath)) throw new Error(`Arquivo allowlisted não está no commit: ${relativePath}`);
  }
}

class PanelClient {
  constructor(panel, apiKey) {
    const url = new URL(panel);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('PTERODACTYL_PANEL inválido.');
    }
    this.panel = url.toString().replace(/\/$/, '');
    this.apiKey = apiKey;
  }

  async request(serverId, endpoint, { method = 'GET', body, allowed = [] } = {}) {
    if (DENYLIST.has(serverId)) throw new Error('Servidor bloqueado pela denylist absoluta.');
    let lastStatus = 0;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      try {
        const response = await globalThis.fetch(`${this.panel}/api/client/servers/${serverId}${endpoint}`, {
          method,
          redirect: 'error',
          signal: globalThis.AbortSignal.timeout(45_000),
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
            ...(body === undefined ? {} : { 'Content-Type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' })
          },
          body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body)
        });
        lastStatus = response.status;
        if (response.ok || allowed.includes(response.status)) return response;
        if (TRANSIENT_STATUS.has(response.status) && attempt < 8) {
          await sleep(Math.min(1000 * attempt, 5000));
          continue;
        }
        throw new Error(`Painel recusou uma operação (HTTP ${response.status}).`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith('Painel recusou')) throw error;
        if (attempt === 8) throw new Error(`Falha de rede no painel${lastStatus ? ` (HTTP ${lastStatus})` : ''}.`);
        await sleep(Math.min(1000 * attempt, 5000));
      }
    }
    throw new Error('Falha inesperada no painel.');
  }

  async json(serverId, endpoint) {
    return (await this.request(serverId, endpoint)).json();
  }

  async assertIdentity(server) {
    const payload = await this.json(server.identifier, '');
    const actual = payload?.attributes || {};
    if (actual.identifier !== server.identifier || actual.uuid !== server.uuid || actual.name !== server.name) {
      throw new Error(`Identidade recusada para ${server.name}.`);
    }
    return actual;
  }

  async listBackups(server) {
    let page = 1;
    const backups = [];
    do {
      const payload = await this.json(server.identifier, `/backups?page=${page}`);
      backups.push(...(payload?.data || []).map(item => item?.attributes || {}));
      const totalPages = Number(payload?.meta?.pagination?.total_pages || 1);
      if (page >= totalPages) break;
      page += 1;
    } while (page <= 20);
    return backups;
  }

  isValidLockedBackup(backup) {
    return backup?.is_locked === true && backup?.is_successful === true && Boolean(backup?.completed_at);
  }

  async ensureLockedBackup(server, releaseId, identity) {
    const existing = await this.listBackups(server);
    if (existing.some(backup => this.isValidLockedBackup(backup))) {
      console.log(`Backup locked concluído reutilizado em ${server.name}.`);
      return;
    }

    const limit = Number(identity?.feature_limits?.backups);
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new Error(`${server.name} não permite criar backups; nenhuma parada foi feita.`);
    }
    const inProgress = existing.some(backup => !backup?.completed_at);
    if (existing.length >= limit && !inProgress) {
      throw new Error(`${server.name} atingiu o limite de backups sem cópia locked válida; nada foi removido.`);
    }

    const response = await this.request(server.identifier, '/backups', {
      method: 'POST',
      allowed: [400, 409, 422],
      body: {
        name: `pre-${releaseId}-${server.identifier}`.slice(0, 100),
        ignored: ['.git', 'node_modules', 'logs', 'dados/logs'].join('\n'),
        is_locked: true
      }
    });
    let createdUuid = '';
    if (response.ok) {
      const payload = await response.json();
      createdUuid = String(payload?.attributes?.uuid || '');
      console.log(`Backup preventivo solicitado em ${server.name}; aguardando conclusão.`);
    } else {
      console.log(`Criação concorrente detectada em ${server.name}; aguardando backup válido.`);
    }

    for (let attempt = 0; attempt < 180; attempt += 1) {
      await sleep(5000);
      const backups = await this.listBackups(server);
      if (backups.some(backup => this.isValidLockedBackup(backup))) {
        console.log(`Backup locked concluído confirmado em ${server.name}.`);
        return;
      }
      const created = createdUuid ? backups.find(backup => backup?.uuid === createdUuid) : null;
      if (created?.completed_at && created?.is_successful === false) {
        throw new Error(`O backup preventivo de ${server.name} terminou com falha; nenhuma parada foi feita.`);
      }
    }
    throw new Error(`Backup locked de ${server.name} não concluiu no tempo seguro; nenhuma parada foi feita.`);
  }

  async state(server) {
    const payload = await this.json(server.identifier, '/resources');
    return {
      state: String(payload?.attributes?.current_state || 'unknown'),
      uptime: Number(payload?.attributes?.resources?.uptime || 0),
      memoryBytes: Number(payload?.attributes?.resources?.memory_bytes || 0),
      observedAt: Date.now()
    };
  }

  async power(server, signal) {
    await this.request(server.identifier, '/power', { method: 'POST', body: { signal } });
  }

  async stop(server) {
    const before = await this.state(server);
    if (before.state !== 'offline') await this.power(server, 'stop');
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const current = await this.state(server);
      if (current.state === 'offline') return before;
      await sleep(3000);
    }
    throw new Error(`${server.name} não confirmou offline.`);
  }

  async startAndWait(server, applicationProbe = null) {
    await this.power(server, 'start');
    console.log(`START aceito para ${server.name}; iniciando observação sanitizada.`);
    let runningSince = 0;
    let applicationReadySince = 0;
    let observations = [];
    let previousState = null;
    for (let attempt = 0; attempt < START_MAX_ATTEMPTS; attempt += 1) {
      await sleep(START_SAMPLE_INTERVAL_MS);
      const current = await this.state(server);
      const stateChanged = previousState !== current.state;
      if (stateChanged || attempt === 0 || (attempt + 1) % 5 === 0) {
        console.log(`START amostra ${server.name} #${attempt + 1}: ${stateEvidence(current)}.`);
      }
      previousState = current.state;
      if (current.state === 'running' && current.uptime >= 15_000) {
        if (!runningSince) runningSince = Date.now();
        if (Date.now() - runningSince >= 15_000) {
          console.log(`${server.name} confirmou running estável.`);
          return current;
        }
      } else {
        runningSince = 0;
      }
      if (supportsStartingCompatibility(server)) {
        observations.push(current);
        observations = observations.filter(item => current.observedAt - item.observedAt <= 60_000);
        // Os eggs autorizados podem permanecer em `starting`. Esse ramo só é
        // aceito após 30 s de processo contínuo, memória real e uptime crescente.
        if (hasStartingCompatibilityEvidence(observations)) {
          console.log(`${server.name} confirmou processo contínuo sob compatibilidade estrita do egg.`);
          return { ...current, compatibilityStarting: true };
        }
      }
      if (typeof applicationProbe === 'function' && (attempt + 1) % 5 === 0) {
        const applicationReady = await applicationProbe();
        if (applicationReady) {
          if (!applicationReadySince) applicationReadySince = Date.now();
          console.log(`START probe de aplicação respondeu para ${server.name}.`);
          if (Date.now() - applicationReadySince >= 5_000) {
            console.log(`${server.name} confirmou aplicação saudável apesar do rótulo do painel.`);
            return { ...current, compatibilityApplication: true };
          }
        } else {
          applicationReadySince = 0;
        }
      }
    }
    const last = observations.at(-1);
    throw new Error(`${server.name} não confirmou processo estável pelo classificador autorizado; última evidência: ${stateEvidence(last)}.`);
  }

  async list(server, relativeDir, cache = null) {
    const cacheKey = `${server.identifier}:${relativeDir || '/'}`;
    if (cache?.has(cacheKey)) return cache.get(cacheKey);
    const directory = relativeDir ? `/${relativeDir}` : '/';
    const response = await this.request(server.identifier, `/files/list?directory=${encodeURIComponent(directory)}`, { allowed: [404] });
    let entries = new Map();
    if (response.status !== 404) {
      const payload = await response.json();
      entries = new Map((payload?.data || []).map(item => [item?.attributes?.name, item?.attributes || {}]));
    }
    cache?.set(cacheKey, entries);
    return entries;
  }

  async directoryExists(server, relativeDir, cache) {
    if (!relativeDir || relativeDir === '.') return true;
    const parent = path.posix.dirname(relativeDir);
    if (!(await this.directoryExists(server, parent, cache))) return false;
    const entries = await this.list(server, parent === '.' ? '' : parent, cache);
    const entry = entries.get(path.posix.basename(relativeDir));
    return Boolean(entry && entry.is_file === false);
  }

  async exists(server, relativePath, cache = new Map()) {
    const parent = path.posix.dirname(relativePath);
    const parentPath = parent === '.' ? '' : parent;
    if (!(await this.directoryExists(server, parentPath, cache))) return false;
    const entries = await this.list(server, parentPath, cache);
    const entry = entries.get(path.posix.basename(relativePath));
    return Boolean(entry && entry.is_file === true);
  }

  async readExisting(server, relativePath) {
    const response = await this.request(server.identifier, `/files/contents?file=${encodeURIComponent(`/${relativePath}`)}`, { allowed: [404] });
    if (response.status === 404) return null;
    return Buffer.from(await response.arrayBuffer());
  }

  async read(server, relativePath, cache = new Map()) {
    if (!(await this.exists(server, relativePath, cache))) return null;
    return this.readExisting(server, relativePath);
  }

  async ensureDir(server, relativeDir) {
    if (!relativeDir || relativeDir === '.') return;
    const parent = path.posix.dirname(relativeDir);
    await this.ensureDir(server, parent);
    const entries = await this.list(server, parent === '.' ? '' : parent);
    const name = path.posix.basename(relativeDir);
    if (entries.has(name)) return;
    await this.request(server.identifier, '/files/create-folder', {
      method: 'POST', body: { root: parent === '.' ? '/' : `/${parent}`, name }
    });
  }

  async write(server, relativePath, contents) {
    await this.ensureDir(server, path.posix.dirname(relativePath));
    await this.request(server.identifier, `/files/write?file=${encodeURIComponent(`/${relativePath}`)}`, {
      method: 'POST', body: contents
    });
    const remote = await this.read(server, relativePath);
    if (!remote || sha256(remote) !== sha256(contents)) throw new Error(`SHA remoto divergente em ${relativePath}.`);
  }

  async remove(server, relativePath) {
    if (!(await this.exists(server, relativePath))) return;
    await this.request(server.identifier, '/files/delete', {
      method: 'POST', body: { root: '/', files: [relativePath] }
    });
    if (await this.exists(server, relativePath)) throw new Error(`Remoção remota não confirmada em ${relativePath}.`);
  }
}

async function snapshot(client, server, paths) {
  const saved = new Map();
  const directoryCache = new Map();
  const groups = new Map();
  for (const relativePath of [...new Set(paths)]) {
    const parent = path.posix.dirname(relativePath);
    const parentPath = parent === '.' ? '' : parent;
    if (!groups.has(parentPath)) groups.set(parentPath, []);
    groups.get(parentPath).push(relativePath);
  }
  for (const [parentPath, group] of groups) {
    let entries;
    try {
      const parentExists = await client.directoryExists(server, parentPath, directoryCache);
      entries = parentExists ? await client.list(server, parentPath, directoryCache) : new Map();
    } catch (error) {
      throw new Error(`Snapshot GET falhou no diretório allowlisted ${parentPath || '/'}: ${error instanceof Error ? error.message : 'erro não identificado'}`);
    }
    for (const relativePath of group) {
      const entry = entries.get(path.posix.basename(relativePath));
      if (!entry || entry.is_file !== true) {
        saved.set(relativePath, { present: false, contents: null, sha: null });
        continue;
      }
      try {
        const contents = await client.readExisting(server, relativePath);
        saved.set(relativePath, { present: contents !== null, contents, sha: contents ? sha256(contents) : null });
      } catch (error) {
        throw new Error(`Snapshot GET falhou no caminho allowlisted ${relativePath}: ${error instanceof Error ? error.message : 'erro não identificado'}`);
      }
    }
  }
  return saved;
}

async function restore(client, server, saved) {
  for (const [relativePath, before] of [...saved.entries()].reverse()) {
    if (before.present) await client.write(server, relativePath, before.contents);
    else await client.remove(server, relativePath);
  }
}

async function applyManifest(client, server, manifest, saved) {
  let writes = 0;
  let deletes = 0;
  for (const relativePath of manifest.files) {
    const local = fs.readFileSync(path.join(ROOT, relativePath));
    if (saved.get(relativePath)?.sha === sha256(local)) continue;
    await client.write(server, relativePath, local);
    writes += 1;
    console.log(`WRITE verificado ${relativePath} ${sha256(local).slice(0, 12)}`);
  }
  for (const relativePath of manifest.delete) {
    if (!saved.get(relativePath)?.present) continue;
    await client.remove(server, relativePath);
    deletes += 1;
    console.log(`DELETE verificado ${relativePath}`);
  }
  return { writes, deletes };
}

function parseEnv(contents) {
  const output = {};
  for (const rawLine of contents.toString('utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    output[match[1]] = value;
  }
  return output;
}

function parseConsumerAccess(contents) {
  const env = parseEnv(contents);
  const token = String(env.BUNNYFY_API_TOKEN || '').trim();
  let baseUrl;
  try {
    baseUrl = new URL(String(env.BUNNYFY_BASE_URL || '').trim());
  } catch {
    throw new Error('Configuração BunnyFy do consumidor é inválida.');
  }
  if (
    token.length < 16 ||
    /COLOQUE|PLACEHOLDER|SUA?_CHAVE|SEU_TOKEN/i.test(token) ||
    !['http:', 'https:'].includes(baseUrl.protocol) ||
    baseUrl.username ||
    baseUrl.password ||
    baseUrl.search ||
    baseUrl.hash
  ) {
    throw new Error('Configuração BunnyFy do consumidor é inválida.');
  }
  baseUrl.pathname = baseUrl.pathname.replace(/\/+$/, '');
  return { token, baseUrl: baseUrl.toString().replace(/\/$/, '') };
}

async function consumerAccess(client) {
  const contents = await client.read(SERVERS.gyomei, GYOMEI_ENV_PATH);
  if (!contents) throw new Error('O arquivo privado de ambiente esperado do Gyomei não está disponível para o smoke.');
  return parseConsumerAccess(contents);
}

async function externalRequest(baseUrl, endpoint, options = {}, timeoutMs = 45_000) {
  try {
    return await globalThis.fetch(`${baseUrl}${endpoint}`, { ...options, redirect: 'error', signal: globalThis.AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new Error('A API pública não respondeu ao gate de produção.');
  }
}

async function bunnyReadyOnce(access, timeoutMs = 15_000) {
  try {
    const [health, ready] = await Promise.all([
      externalRequest(access.baseUrl, '/health', {}, timeoutMs),
      externalRequest(access.baseUrl, '/ready', {}, timeoutMs)
    ]);
    const healthBody = health.ok ? await health.json() : null;
    const readyBody = ready.ok ? await ready.json() : null;
    return healthBody?.data?.status === 'ok' && readyBody?.data?.status === 'ready';
  } catch {
    return false;
  }
}

async function waitBunnyReady(access) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    if (await bunnyReadyOnce(access)) {
      console.log('BunnyFy confirmou health/ready.');
      return;
    }
    if (attempt === 0 || (attempt + 1) % 5 === 0) {
      console.log(`BunnyFy ainda não confirmou health/ready (tentativa ${attempt + 1}/35).`);
    }
    await sleep(3000);
  }
  throw new Error('BunnyFy não confirmou health/ready.');
}

function pngDimensions(buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) throw new Error('Smoke não retornou PNG real.');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

async function renderSmoke(access, endpoint, view, expected) {
  const response = await externalRequest(access.baseUrl, endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ view })
  });
  if (!response.ok) throw new Error(`Smoke Render View recusado (HTTP ${response.status}).`);
  const payload = await response.json();
  const mediaUrl = payload?.data?.media?.mediaUrl;
  if (typeof mediaUrl !== 'string') throw new Error('Smoke Render View não retornou mídia.');
  const resolved = new URL(mediaUrl, `${access.baseUrl}/`);
  if (resolved.origin !== new URL(access.baseUrl).origin) throw new Error('Smoke retornou origem de mídia inesperada.');
  const media = await globalThis.fetch(resolved, { redirect: 'error', signal: globalThis.AbortSignal.timeout(45_000) });
  if (!media.ok) throw new Error('Não foi possível reler a mídia do smoke.');
  const bytes = Buffer.from(await media.arrayBuffer());
  if (bytes.length > 20 * 1024 * 1024) throw new Error('Mídia do smoke excedeu o limite de segurança.');
  const dimensions = pngDimensions(bytes);
  if (dimensions.width !== expected.width || dimensions.height !== expected.height) throw new Error('Dimensões do smoke divergentes.');
}

async function smokeTavern(access) {
  const player = (slot, name) => ({ slot, displayName: name, classId: 'guardiao', hero: { hp: 30, armor: 0 }, mana: { current: 3, max: 3 }, handCount: 3, deckCount: 24, board: [{ cardId: 'GY-001', name: 'Sentinela de Pedra', rarity: 'COMMON', attack: 2, health: 4, keywords: ['guarda'], canAttack: true, attacksThisTurn: 0 }] });
  await renderSmoke(access, '/v1/games/tavern/board', { schemaVersion: 1, kind: 'board', status: 'ACTIVE', phase: 'MAIN', turn: { number: 2, activeSlot: 'bottom', deadlineAt: null }, terrain: null, players: [player('bottom', 'Aventureiro'), player('top', 'Rival')] }, { width: 1200, height: 940 });
  console.log('Smoke Tavern board passou.');
  const cards = Array.from({ length: 6 }, (_, index) => ({ cardId: `GY-${String(index + 1).padStart(3, '0')}`, name: `Carta ${index + 1}`, type: index === 5 ? 'SPELL' : 'MINION', rarity: 'COMMON', cost: index % 4, ...(index === 5 ? {} : { attack: 2, health: 3 }), keywords: [] }));
  await renderSmoke(access, '/v1/games/tavern/hand?page=2', { schemaVersion: 1, kind: 'hand', status: 'ACTIVE', phase: 'MAIN', isActive: true, viewer: { classId: 'guardiao', mana: { current: 3, max: 3 }, nextSpellDiscount: 0, boardCount: 1 }, cards }, { width: 720, height: 960 });
  console.log('Smoke Tavern hand passou.');
  const legacy = await externalRequest(access.baseUrl, '/v1/games/tavern/board', { method: 'POST', headers: { Authorization: `Bearer ${access.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ state: {} }) });
  if (legacy.status !== 400) throw new Error('O body legado não foi recusado pelo contrato estrito.');
  console.log('Smoke Tavern contrato legado passou.');
}

async function writeLock(client, data) {
  await client.write(SERVERS.gyomei, LOCK_PATH, Buffer.from(`${JSON.stringify(data, null, 2)}\n`));
}

async function readLock(client) {
  const contents = await client.read(SERVERS.gyomei, LOCK_PATH);
  if (!contents) return null;
  try { return JSON.parse(contents.toString('utf8')); } catch { throw new Error('Lock de release remoto inválido.'); }
}

async function validateGyomeiRuntime(client) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const runtime = await client.read(SERVERS.gyomei, GYOMEI_RUNTIME_IA_PATH);
    if (runtime) {
      const text = runtime.toString('utf8');
      if (!text.includes('createBunnyFyAiClient') || /integrate\.api\.nvidia\.com|requestNvidiaChat|nvapi-/i.test(text)) {
        throw new Error('Runtime de IA não está exclusivo pela BunnyFy.');
      }
      return;
    }
    await sleep(3000);
  }
  throw new Error('Runtime de IA não foi gerado no boot.');
}

async function confirmGyomeiAfterRuntime(client, startEvidence) {
  const observations = startEvidence?.compatibilityStarting === true ? [startEvidence] : [];
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if (attempt > 0) await sleep(START_SAMPLE_INTERVAL_MS);
    const current = await client.state(SERVERS.gyomei);
    if (current.state === 'running' && current.uptime >= 15_000) return current;
    observations.push(current);
    if (hasStartingCompatibilityEvidence(observations)) {
      return { ...current, compatibilityStarting: true };
    }
    if (attempt === 0 || (attempt + 1) % 5 === 0) {
      console.log(`PÓS-RUNTIME amostra Gyomei #${attempt + 1}: ${stateEvidence(current)}.`);
    }
  }
  throw new Error(`Gyomei não sustentou processo após regenerar o runtime de IA; última evidência: ${stateEvidence(observations.at(-1))}.`);
}

async function validateInternalContracts() {
  const sanitized = safeErrorMessage(new Error(
    'Bearer segredo https://painel.exemplo.invalid/api/client ptlc_exemplo cfut_exemplo nvapi-exemplo'
  ));
  if (
    /segredo|https?:\/\/|ptlc_|cfut_|nvapi-/i.test(sanitized) ||
    !sanitized.includes('Bearer [redacted]') ||
    !sanitized.includes('[url-redacted]')
  ) {
    throw new Error('Autovalidação da sanitização de erros falhou.');
  }
  const access = parseConsumerAccess(Buffer.from(
    'BUNNYFY_BASE_URL=https://bunnyfy.invalid\nBUNNYFY_API_TOKEN=token-fixture-seguro-123456\n'
  ));
  if (access.baseUrl !== 'https://bunnyfy.invalid' || access.token.length < 16) {
    throw new Error('Autovalidação do ambiente privado falhou.');
  }
  const observations = [0, 10_000, 20_000, 31_000].map((observedAt, index) => ({
    state: 'starting',
    uptime: 15_000 + (index * 10_000),
    memoryBytes: 1024,
    observedAt
  }));
  if (!hasStartingCompatibilityEvidence(observations)) {
    throw new Error('Autovalidação do classificador starting falhou.');
  }
  const coarse = observations.map((item, index) => ({ ...item, uptime: index < 3 ? 15_000 : 25_000 }));
  if (!hasStartingCompatibilityEvidence(coarse)) {
    throw new Error('Classificador starting recusou contador coarse com crescimento real.');
  }
  const stagnant = observations.map(item => ({ ...item, uptime: 15_000 }));
  if (hasStartingCompatibilityEvidence(stagnant)) {
    throw new Error('Classificador starting aceitou uptime estagnado.');
  }
  const regressing = observations.map(item => ({ ...item }));
  regressing[2].uptime = regressing[1].uptime - 1;
  if (hasStartingCompatibilityEvidence(regressing)) {
    throw new Error('Classificador starting aceitou regressão de uptime.');
  }
  if (
    !supportsStartingCompatibility(SERVERS.bunnyfy) ||
    !supportsStartingCompatibility(SERVERS.gyomei) ||
    supportsStartingCompatibility({ identifier: 'servidor-nao-autorizado' })
  ) {
    throw new Error('Autovalidação das identidades compatíveis com starting falhou.');
  }
  const snapshotCalls = [];
  const fakeClient = {
    async directoryExists(_server, relativeDir) {
      snapshotCalls.push(`exists:${relativeDir || '/'}`);
      return relativeDir !== '.deploy';
    },
    async list(_server, relativeDir) {
      snapshotCalls.push(`list:${relativeDir || '/'}`);
      return new Map([
        ['one.js', { is_file: true }],
        ['two.js', { is_file: true }]
      ]);
    },
    async readExisting(_server, relativePath) {
      snapshotCalls.push(`read:${relativePath}`);
      return Buffer.from(relativePath);
    }
  };
  const planned = await snapshot(fakeClient, SERVERS.gyomei, [LOCK_PATH, 'src/one.js', 'src/two.js']);
  if (
    planned.get(LOCK_PATH)?.present !== false ||
    snapshotCalls.includes('list:.deploy') ||
    snapshotCalls.filter(item => item === 'list:src').length !== 1 ||
    snapshotCalls.some(item => item === `read:${LOCK_PATH}`)
  ) {
    throw new Error('Autovalidação do snapshot agrupado falhou.');
  }
}

async function deployBunny(client, manifest, input) {
  const access = await consumerAccess(client);
  const lockBefore = await snapshot(client, SERVERS.gyomei, [LOCK_PATH]);
  const currentLock = await readLock(client);
  const lockMatchesRequestedRelease = currentLock && (
    currentLock.schemaVersion === 1 &&
    currentLock.releaseId === input.releaseId &&
    currentLock.bunnyfySha === input.expectedSha &&
    currentLock.gyomeiSha === input.pairedSha
  );
  if (currentLock && !lockMatchesRequestedRelease) {
    if (!isReplaceableFailedLock(currentLock)) {
      throw new Error('Já existe uma release pareada diferente ou com SHAs incompatíveis.');
    }
    console.log('Lock terminal de falha validado; iniciando recuperação versionada.');
  }
  const codeBefore = await snapshot(client, SERVERS.bunnyfy, [...manifest.files, ...manifest.delete]);
  const gyomeiBefore = await client.state(SERVERS.gyomei);
  const bunnyBefore = await client.state(SERVERS.bunnyfy);
  const release = { schemaVersion: 1, releaseId: input.releaseId, bunnyfySha: input.expectedSha, gyomeiSha: input.pairedSha, stage: 'preparing_bunnyfy', createdAt: new Date().toISOString() };
  let stage = 'write_lock';
  try {
    console.log('STAGE BunnyFy: gravar lock pareado.');
    await writeLock(client, release);
    stage = 'stop_gyomei';
    console.log('STAGE BunnyFy: confirmar Gyomei offline.');
    await client.stop(SERVERS.gyomei);
    stage = 'stop_bunnyfy';
    console.log('STAGE BunnyFy: confirmar BunnyFy offline.');
    await client.stop(SERVERS.bunnyfy);
    stage = 'apply_manifest';
    console.log('STAGE BunnyFy: aplicar manifesto fechado.');
    const changed = await applyManifest(client, SERVERS.bunnyfy, manifest, codeBefore);
    stage = 'start_and_application_probe';
    console.log('STAGE BunnyFy: iniciar processo e observar aplicação.');
    await client.startAndWait(SERVERS.bunnyfy, () => bunnyReadyOnce(access));
    stage = 'health_ready';
    console.log('STAGE BunnyFy: confirmar health/ready.');
    await waitBunnyReady(access);
    stage = 'smoke_tavern';
    console.log('STAGE BunnyFy: executar smokes Tavern.');
    await smokeTavern(access);
    stage = 'write_ready_lock';
    console.log('STAGE BunnyFy: gravar lock ready.');
    await writeLock(client, { ...release, stage: 'bunnyfy_ready', readyAt: new Date().toISOString() });
    console.log(`BunnyFy validada; Gyomei permanece offline aguardando a mesma release. Escritas: ${changed.writes}; remoções: ${changed.deletes}.`);
  } catch (error) {
    const originalMessage = safeErrorMessage(error);
    console.error(`Falha no estágio BunnyFy (${stage}): ${originalMessage}. Executando rollback existence-aware.`);
    let rollbackStage = 'stop_bunnyfy';
    try {
      await client.stop(SERVERS.bunnyfy);
      rollbackStage = 'restore_bunnyfy';
      await restore(client, SERVERS.bunnyfy, codeBefore);
      rollbackStage = 'restore_lock';
      await restore(client, SERVERS.gyomei, lockBefore);
      if (bunnyBefore.state !== 'offline') {
        rollbackStage = 'restart_bunnyfy';
        await client.startAndWait(SERVERS.bunnyfy, () => bunnyReadyOnce(access));
        rollbackStage = 'confirm_bunnyfy_ready';
        await waitBunnyReady(access);
      }
      if (gyomeiBefore.state !== 'offline') {
        rollbackStage = 'restart_gyomei';
        await client.startAndWait(SERVERS.gyomei);
      }
    } catch (rollbackError) {
      throw new Error(`Falha original BunnyFy em ${stage}: ${originalMessage}; rollback falhou em ${rollbackStage}: ${safeErrorMessage(rollbackError)}.`);
    }
    throw error;
  }
}

async function deployGyomei(client, manifest, input) {
  const lock = await readLock(client);
  if (!lock || lock.stage !== 'bunnyfy_ready' || lock.releaseId !== input.releaseId || lock.bunnyfySha !== input.pairedSha || lock.gyomeiSha !== input.expectedSha) {
    throw new Error('Lock pareado ausente ou incompatível; Gyomei não será promovido.');
  }
  const access = await consumerAccess(client);
  await waitBunnyReady(access);
  const codeBefore = await snapshot(client, SERVERS.gyomei, [...manifest.files, ...manifest.delete, GYOMEI_RUNTIME_IA_PATH]);
  let stage = 'stop_gyomei';
  try {
    console.log('STAGE Gyomei: confirmar consumidor offline.');
    await client.stop(SERVERS.gyomei);
    stage = 'apply_manifest';
    console.log('STAGE Gyomei: aplicar manifesto fechado.');
    const changed = await applyManifest(client, SERVERS.gyomei, manifest, codeBefore);
    stage = 'remove_runtime';
    console.log('STAGE Gyomei: remover runtime derivada.');
    await client.remove(SERVERS.gyomei, GYOMEI_RUNTIME_IA_PATH);
    stage = 'start';
    console.log('STAGE Gyomei: iniciar e observar processo.');
    const state = await client.startAndWait(SERVERS.gyomei);
    stage = 'validate_runtime';
    console.log('STAGE Gyomei: validar runtime regenerada.');
    await validateGyomeiRuntime(client);
    stage = 'confirm_runtime_process';
    const confirmed = await confirmGyomeiAfterRuntime(client, state);
    stage = 'remove_lock';
    await client.remove(SERVERS.gyomei, LOCK_PATH);
    console.log(`Gyomei validado em ${confirmed.state}; release pareada concluída. Escritas: ${changed.writes}; remoções: ${changed.deletes}.`);
  } catch (error) {
    const originalMessage = safeErrorMessage(error);
    console.error(`Falha no estágio Gyomei (${stage}): ${originalMessage}. Restaurando arquivos e mantendo o consumidor offline.`);
    let rollbackStage = 'stop_gyomei';
    try {
      await client.stop(SERVERS.gyomei);
      rollbackStage = 'restore_gyomei';
      await restore(client, SERVERS.gyomei, codeBefore);
      rollbackStage = 'write_failed_lock';
      await writeLock(client, { ...lock, stage: 'gyomei_failed_rolled_back', failedAt: new Date().toISOString() });
    } catch (rollbackError) {
      throw new Error(`Falha original Gyomei em ${stage}: ${originalMessage}; rollback falhou em ${rollbackStage}: ${safeErrorMessage(rollbackError)}.`);
    }
    throw error;
  }
}

async function main() {
  const manifestPath = path.resolve(ROOT, argument('manifest') || '.github/deploy/production-runtime-manifest.json');
  const manifest = loadManifest(manifestPath);
  if (process.argv.includes('--validate')) {
    await validateInternalContracts();
    console.log(`Manifesto ${manifest.role} válido: ${manifest.files.length} writes allowlisted; ${manifest.delete.length} deletes explícitos.`);
    return;
  }
  if (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch') {
    throw new Error('Deploy bloqueado: execução permitida somente por workflow_dispatch do GitHub Actions.');
  }
  const expectedSha = validSha(requiredEnv('DEPLOY_EXPECTED_SHA'), 'expected_sha');
  const pairedSha = validSha(requiredEnv('DEPLOY_PAIRED_EXPECTED_SHA'), 'paired_expected_sha');
  const releaseId = validReleaseId(requiredEnv('DEPLOY_RELEASE_ID'));
  if (requiredEnv('DEPLOY_CONFIRMATION') !== CONFIRMATIONS[manifest.role]) throw new Error('Confirmação manual incorreta.');
  validateCheckout(manifest, expectedSha);
  const client = new PanelClient(requiredEnv('PTERODACTYL_PANEL'), requiredEnv('PTERODACTYL_API_KEY'));
  const serverIdentities = new Map();
  for (const server of [SERVERS.bunnyfy, SERVERS.gyomei]) {
    serverIdentities.set(server.identifier, await client.assertIdentity(server));
  }
  for (const server of [SERVERS.bunnyfy, SERVERS.gyomei]) {
    await client.ensureLockedBackup(server, releaseId, serverIdentities.get(server.identifier));
  }
  console.log('Identidades e backups locked confirmados; Mendes permaneceu fora de qualquer consulta.');
  const input = { expectedSha, pairedSha, releaseId };
  if (manifest.role === 'bunnyfy') await deployBunny(client, manifest, input);
  else await deployGyomei(client, manifest, input);
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  main().catch(error => {
    console.error(`Deploy encerrado com segurança: ${safeErrorMessage(error)}`);
    process.exitCode = 1;
  });
}
