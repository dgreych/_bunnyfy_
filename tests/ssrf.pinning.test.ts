import assert from 'node:assert/strict';
import type { LookupAddress } from 'node:dns';
import { test } from 'node:test';

import {
  createPinnedLookup,
  safeFetch,
  SsrfBlockedError,
  type DnsLookup,
  type SafeRequestImpl,
} from '../src/security/ssrf.ts';

test('lookup fixado respeita formatos unitário e all usados pelo Node 24', async () => {
  const lookup = createPinnedLookup('93.184.216.34');
  const single = await new Promise<{ address: string | LookupAddress[]; family?: number }>((resolve, reject) => {
    lookup('public.example', { all: false }, (error, address, family) => {
      if (error) reject(error);
      else resolve({ address, family });
    });
  });
  assert.equal(single.address, '93.184.216.34');
  assert.equal(single.family, 4);

  const all = await new Promise<string | LookupAddress[]>((resolve, reject) => {
    lookup('public.example', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
  assert.deepEqual(all, [{ address: '93.184.216.34', family: 4 }]);
});

test('safeFetch entrega ao transporte exatamente o IP público validado', async () => {
  let receivedAddress: string | undefined;
  const dnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  const requestImpl: SafeRequestImpl = async (url, validatedAddress) => {
    assert.equal(url.hostname, 'public.example');
    receivedAddress = validatedAddress;
    return new Response('ok', { status: 200 });
  };

  const response = await safeFetch('https://public.example/recurso', {
    timeoutMs: 1000,
    dnsLookup,
    requestImpl,
  });

  assert.equal(response.status, 200);
  assert.equal(receivedAddress, '93.184.216.34');
});

test('safeFetch repete resolução e pinning após redirecionamento', async () => {
  const pinned: Array<{ host: string; address: string }> = [];
  const dnsLookup: DnsLookup = async (hostname) => {
    if (hostname === 'one.example') return [{ address: '93.184.216.34', family: 4 }];
    if (hostname === 'two.example') return [{ address: '1.1.1.1', family: 4 }];
    throw new Error('host inesperado');
  };
  const requestImpl: SafeRequestImpl = async (url, validatedAddress) => {
    pinned.push({ host: url.hostname, address: validatedAddress });
    if (url.hostname === 'one.example') {
      return new Response(null, { status: 302, headers: { location: 'https://two.example/final' } });
    }
    return new Response('ok', { status: 200 });
  };

  const response = await safeFetch('https://one.example/start', {
    timeoutMs: 1000,
    dnsLookup,
    requestImpl,
  });

  assert.equal(response.status, 200);
  assert.deepEqual(pinned, [
    { host: 'one.example', address: '93.184.216.34' },
    { host: 'two.example', address: '1.1.1.1' },
  ]);
});

test('safeFetch nunca permite sobrescrever Host ou Connection', async () => {
  const dnsLookup: DnsLookup = async () => [{ address: '93.184.216.34', family: 4 }];

  await assert.rejects(
    safeFetch('https://public.example/', {
      timeoutMs: 1000,
      dnsLookup,
      headers: { Host: '127.0.0.1' },
      requestImpl: async () => new Response('não deve ser chamado'),
    }),
    SsrfBlockedError,
  );

  await assert.rejects(
    safeFetch('https://public.example/', {
      timeoutMs: 1000,
      dnsLookup,
      headers: { connection: 'keep-alive' },
      requestImpl: async () => new Response('não deve ser chamado'),
    }),
    SsrfBlockedError,
  );
});

test('safeFetch bloqueia antes do transporte se DNS misturar IP público e privado', async () => {
  let called = false;
  const dnsLookup: DnsLookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];

  await assert.rejects(
    safeFetch('https://rebind.example/', {
      timeoutMs: 1000,
      dnsLookup,
      requestImpl: async () => {
        called = true;
        return new Response('não deve ser chamado');
      },
    }),
    SsrfBlockedError,
  );
  assert.equal(called, false);
});
