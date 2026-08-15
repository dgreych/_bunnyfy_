import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  checkToolAvailable,
  readToolVersion,
  resetToolAvailabilityCache,
  runSubprocess,
  SubprocessExitError,
  ToolNotFoundError,
} from '../src/lib/subprocess.ts';

test('runSubprocess lança ToolNotFoundError quando o binário não existe (ENOENT)', async () => {
  await assert.rejects(
    runSubprocess('bunnyfy-binario-que-nao-existe-de-verdade', [], { timeoutMs: 2000 }),
    ToolNotFoundError,
  );
});

test('runSubprocess retorna stdout de um binário real', async () => {
  const result = await runSubprocess('node', ['-e', 'process.stdout.write("ok")'], { timeoutMs: 5000 });
  assert.equal(result.stdout, 'ok');
});

test('runSubprocess propaga erro de saída diferente de zero sem derrubar o processo de teste', async () => {
  await assert.rejects(runSubprocess('node', ['-e', 'process.exit(3)'], { timeoutMs: 5000 }));
});

test('checkToolAvailable retorna false pra binário ausente e true pra binário real, com cache', async () => {
  resetToolAvailabilityCache();
  assert.equal(await checkToolAvailable('bunnyfy-binario-que-nao-existe-de-verdade'), false);
  assert.equal(await checkToolAvailable('node', ['--version']), true);
});

test('readToolVersion cacheia sucesso mas permite recuperação após falha transitória', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'bunnyfy-version-probe-'));
  const marker = path.join(dir, 'first-run');
  const script = [
    "const fs = require('node:fs');",
    `const marker = ${JSON.stringify(marker)};`,
    "if (!fs.existsSync(marker)) { fs.writeFileSync(marker, '1'); process.exit(1); }",
    "process.stdout.write('2026.07.04\\nsegunda-linha-ignorada\\n');",
  ].join('');

  resetToolAvailabilityCache();

  try {
    // A primeira chamada falha; esse null não pode ficar cacheado.
    assert.equal(await readToolVersion('node', ['-e', script]), null);

    // Mesma chave de cache: precisa executar de novo e se recuperar.
    assert.equal(await readToolVersion('node', ['-e', script]), '2026.07.04');

    // Agora o sucesso pode ser cacheado normalmente.
    assert.equal(await readToolVersion('node', ['-e', script]), '2026.07.04');

    // Binário ausente continua resultando em null, sem derrubar o processo.
    assert.equal(await readToolVersion('bunnyfy-binario-que-nao-existe-de-verdade'), null);
  } finally {
    resetToolAvailabilityCache();
    await rm(dir, { recursive: true, force: true });
  }
});


test('runSubprocess classifica stderr sem preservar conteúdo bruto no erro', async () => {
  const marker = 'TOKEN_SHOULD_NOT_LEAK';
  const script =
    `process.stderr.write("ERROR: [youtube] Sign in to confirm you're not a bot ${marker}");` +
    'process.exit(3);';

  await assert.rejects(
    runSubprocess('node', ['-e', script], { timeoutMs: 5000 }),
    (error: unknown) => {
      assert.ok(error instanceof SubprocessExitError);
      assert.equal(error.failureKind, 'youtube_antibot');
      assert.equal(error.exitCode, 3);
      assert.equal(error.message.includes(marker), false);
      assert.equal(JSON.stringify(error).includes(marker), false);
      return true;
    },
  );
});


// CLASSIFIER_V2_TABLE_TEST
test('classificador sanitizado cobre variantes atuais sem carregar stderr bruto', async () => {
  const cases = [
    ["Sign in to confirm you’re not a bot.", "youtube_antibot"],
    ["n challenge solving failed: Some formats may be missing.", "js_challenge"],
    ["Signature solving failed: challenge solver script distribution missing.", "js_challenge"],
    ["Only images are available for download.", "youtube_delivery"],
    ["YouTube is forcing SABR streaming for this client.", "youtube_delivery"],
    ["This video is age-restricted; authentication is required.", "youtube_auth"],
    ["This video is unavailable.", "media_unavailable"],
    ["HTTP Error 429: Too Many Requests", "http_429"],
    ["HTTP Error 403: Forbidden", "http_403"],
    ["Requested format is not available.", "format"],
    ["Unable to download video data: connection reset", "network"],
  ] as const;

  for (const [stderrText, expectedKind] of cases) {
    const marker = 'PRIVATE_MARKER_MUST_NOT_SURVIVE';

    const script =
      `process.stderr.write(${JSON.stringify(stderrText + " " + marker)});` +
      'process.exit(1);';

    await assert.rejects(
      runSubprocess('node', ['-e', script], { timeoutMs: 5000 }),
      (error: unknown) => {
        assert.ok(error instanceof SubprocessExitError);
        assert.equal(error.failureKind, expectedKind);
        assert.equal(error.exitCode, 1);

        assert.equal(error.message.includes(marker), false);
        assert.equal(JSON.stringify(error).includes(marker), false);
        assert.equal(JSON.stringify(error).includes(stderrText), false);

        return true;
      },
    );
  }
});
