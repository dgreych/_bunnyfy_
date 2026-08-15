import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sniffImageFormat } from '../src/lib/imageSniff.ts';

test('reconhece assinatura PNG', () => {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  assert.deepEqual(sniffImageFormat(header), { format: 'png', mime: 'image/png' });
});

test('reconhece assinatura JPEG', () => {
  const header = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]);
  assert.deepEqual(sniffImageFormat(header), { format: 'jpeg', mime: 'image/jpeg' });
});

test('reconhece assinatura GIF87a e GIF89a', () => {
  assert.equal(sniffImageFormat(Buffer.from('GIF87a' + '\0\0'))?.format, 'gif');
  assert.equal(sniffImageFormat(Buffer.from('GIF89a' + '\0\0'))?.format, 'gif');
});

test('reconhece contêiner RIFF/WEBP', () => {
  const header = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
  assert.deepEqual(sniffImageFormat(header), { format: 'webp', mime: 'image/webp' });
});

test('rejeita RIFF que não é WEBP (ex.: WAV)', () => {
  const header = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WAVE')]);
  assert.equal(sniffImageFormat(header), null);
});

test('rejeita bytes aleatórios', () => {
  assert.equal(sniffImageFormat(Buffer.from('isso não é imagem nenhuma')), null);
});

test('rejeita buffer vazio ou curto demais sem lançar', () => {
  assert.equal(sniffImageFormat(Buffer.alloc(0)), null);
  assert.equal(sniffImageFormat(Buffer.from([0x89, 0x50])), null);
});
