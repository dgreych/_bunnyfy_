import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  assertSafeUrlSyntax,
  readBodyWithLimit,
  resolveAndAssertSafeHost,
  safeFetch,
  SsrfBlockedError,
  type DnsLookup,
} from '../src/security/ssrf.ts';

test('assertSafeUrlSyntax aceita http/https simples', () => {
  const url = assertSafeUrlSyntax('https://example.com/video');
  assert.equal(url.hostname, 'example.com');
});

test('assertSafeUrlSyntax bloqueia protocolo fora da lista', () => {
  assert.throws(() => assertSafeUrlSyntax('file:///etc/passwd'), SsrfBlockedError);
  assert.throws(() => assertSafeUrlSyntax('ftp://example.com/x'), SsrfBlockedError);
  assert.throws(() => assertSafeUrlSyntax('gopher://example.com'), SsrfBlockedError);
});

test('assertSafeUrlSyntax bloqueia credencial embutida na URL', () => {
  assert.throws(() => assertSafeUrlSyntax('https://user:pass@example.com/x'), SsrfBlockedError);
});

test('assertSafeUrlSyntax bloqueia URL malformada', () => {
  assert.throws(() => assertSafeUrlSyntax('não é uma url'), SsrfBlockedError);
});

test('assertSafeUrlSyntax respeita allowlist de host (exato e subdomínio)', () => {
  const policy = { allowedHosts: ['youtube.com'] };
  assert.doesNotThrow(() => assertSafeUrlSyntax('https://youtube.com/watch?v=1', policy));
  assert.doesNotThrow(() => assertSafeUrlSyntax('https://www.youtube.com/watch?v=1', policy));
  assert.throws(() => assertSafeUrlSyntax('https://evil-youtube.com.attacker.net/', policy), SsrfBlockedError);
  assert.throws(() => assertSafeUrlSyntax('https://notyoutube.com/', policy), SsrfBlockedError);
});

function fakeLookup(addresses: string[]): DnsLookup {
  return async () => addresses.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
}

test('resolveAndAssertSafeHost bloqueia loopback IPv4', async () => {
  await assert.rejects(resolveAndAssertSafeHost('localhost', fakeLookup(['127.0.0.1'])), SsrfBlockedError);
});

test('resolveAndAssertSafeHost bloqueia rede privada RFC1918', async () => {
  await assert.rejects(resolveAndAssertSafeHost('internal.example', fakeLookup(['10.0.0.5'])), SsrfBlockedError);
  await assert.rejects(resolveAndAssertSafeHost('internal.example', fakeLookup(['192.168.1.1'])), SsrfBlockedError);
  await assert.rejects(resolveAndAssertSafeHost('internal.example', fakeLookup(['172.16.0.1'])), SsrfBlockedError);
});

test('resolveAndAssertSafeHost bloqueia link-local (metadados de nuvem)', async () => {
  await assert.rejects(resolveAndAssertSafeHost('metadata.example', fakeLookup(['169.254.169.254'])), SsrfBlockedError);
});

test('resolveAndAssertSafeHost bloqueia loopback IPv6 e unique-local', async () => {
  await assert.rejects(resolveAndAssertSafeHost('v6.example', fakeLookup(['::1'])), SsrfBlockedError);
  await assert.rejects(resolveAndAssertSafeHost('v6.example', fakeLookup(['fd00::1'])), SsrfBlockedError);
});

test('resolveAndAssertSafeHost bloqueia IPv4-mapeado-em-IPv6 disfarçando loopback', async () => {
  await assert.rejects(resolveAndAssertSafeHost('sneaky.example', fakeLookup(['::ffff:127.0.0.1'])), SsrfBlockedError);
});

test('resolveAndAssertSafeHost bloqueia se qualquer resposta de DNS for privada (multi-resposta)', async () => {
  await assert.rejects(
    resolveAndAssertSafeHost('rebind.example', fakeLookup(['93.184.216.34', '127.0.0.1'])),
    SsrfBlockedError,
  );
});

test('resolveAndAssertSafeHost aceita endereço público comum', async () => {
  const addresses = await resolveAndAssertSafeHost('example.com', fakeLookup(['93.184.216.34']));
  assert.deepEqual(addresses, ['93.184.216.34']);
});

test('resolveAndAssertSafeHost embrulha falha de DNS em SsrfBlockedError', async () => {
  const failingLookup: DnsLookup = async () => {
    throw new Error('ENOTFOUND');
  };
  await assert.rejects(resolveAndAssertSafeHost('nao-existe.example', failingLookup), SsrfBlockedError);
});

test('readBodyWithLimit lê corpo dentro do limite', async () => {
  const response = new Response('conteudo pequeno');
  const buffer = await readBodyWithLimit(response, 1024);
  assert.equal(buffer.toString('utf8'), 'conteudo pequeno');
});

test('readBodyWithLimit aborta quando o corpo excede o limite', async () => {
  const response = new Response('x'.repeat(1000));
  await assert.rejects(readBodyWithLimit(response, 100), SsrfBlockedError);
});

test('safeFetch revalida DNS a cada redirecionamento e bloqueia salto pra rede privada', async () => {
  const fetchImpl = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://public.example/start') {
      return new Response(null, { status: 302, headers: { location: 'https://internal.example/next' } });
    }
    throw new Error(`chamada inesperada em teste: ${url}`);
  }) as typeof fetch;

  const dnsLookup: DnsLookup = async (hostname) => {
    if (hostname === 'public.example') return [{ address: '93.184.216.34', family: 4 }];
    if (hostname === 'internal.example') return [{ address: '10.1.2.3', family: 4 }];
    throw new Error(`host inesperado em teste: ${hostname}`);
  };

  await assert.rejects(
    safeFetch('https://public.example/start', { timeoutMs: 1000, dnsLookup, fetchImpl }),
    SsrfBlockedError,
  );
});

test('safeFetch segue redirecionamento seguro e retorna a resposta final', async () => {
  const fetchImpl = (async (input: string | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === 'https://public.example/start') {
      return new Response(null, { status: 302, headers: { location: 'https://public.example/final' } });
    }
    if (url === 'https://public.example/final') {
      return new Response('ok', { status: 200 });
    }
    throw new Error(`chamada inesperada em teste: ${url}`);
  }) as typeof fetch;

  const dnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  const response = await safeFetch('https://public.example/start', { timeoutMs: 1000, dnsLookup, fetchImpl });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'ok');
});

test('safeFetch bloqueia depois de exceder o máximo de redirecionamentos', async () => {
  let hop = 0;
  const fetchImpl = (async () => {
    hop += 1;
    return new Response(null, { status: 302, headers: { location: `https://public.example/hop-${hop}` } });
  }) as typeof fetch;

  const dnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  await assert.rejects(
    safeFetch('https://public.example/start', { timeoutMs: 1000, dnsLookup, fetchImpl, maxRedirects: 2 }),
    SsrfBlockedError,
  );
});
