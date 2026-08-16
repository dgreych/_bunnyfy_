import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildConfig } from '../src/config.ts';

const BASE_ENV: NodeJS.ProcessEnv = {
  BUNNYFY_API_TOKENS: 'token-um-bem-longo-123456,token-dois-bem-longo-654321',
  MEDIA_SIGNING_SECRET: 'segredo-de-teste-com-32-caracteres-ok',
};

test('buildConfig falha rápido quando faltam segredos obrigatórios', () => {
  assert.throws(() => buildConfig({}), /Configuração inválida/);
});

test('buildConfig falha quando o token é curto demais', () => {
  assert.throws(() => buildConfig({ ...BASE_ENV, BUNNYFY_API_TOKENS: 'curto' }));
});

test('buildConfig faz parse de múltiplos tokens separados por vírgula, sem espaço sobrando', () => {
  const config = buildConfig({ ...BASE_ENV, BUNNYFY_API_TOKENS: ' token-a-bem-longo-123 , token-b-bem-longo-456 ' });
  assert.equal(config.apiKeys.size, 2);
  assert.equal(config.apiKeys.authenticate('token-a-bem-longo-123', 'ai:chat')?.legacy, true);
  assert.equal(config.apiKeys.authenticate('token-b-bem-longo-456', 'media:write')?.legacy, true);
});

test('buildConfig aplica valores padrão sensatos sem exigir tudo', () => {
  const config = buildConfig(BASE_ENV);
  assert.equal(config.port, 8080);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.mediaTtlSeconds, 600);
  assert.equal(config.nodeEnv, 'development');
  assert.equal(config.isProduction, false);
  assert.equal(config.aiChatEnabled, false);
  assert.equal(config.nvidiaApiKey, undefined);
  assert.equal(config.nvidiaModel, undefined);
  assert.equal(config.aiChatMaxMessages, 24);
  assert.equal(config.aiChatMaxMessageChars, 16_000);
  assert.equal(config.aiChatMaxTotalChars, 48_000);
  assert.equal(config.aiChatMaxOutputTokens, 2_000);
  assert.equal(config.aiChatMaxConcurrencyPerConsumer, 1);
  assert.equal(config.aiChatMaxRequestsPerMinutePerConsumer, 10);
  assert.equal(config.youtubeDownloadMaxConcurrency, 2);
  assert.equal(config.youtubeEgressEnabled, false);
  assert.equal(config.youtubeEgressUrl, undefined);
  assert.equal(config.youtubeFallbackEnabled, false);
  assert.equal(config.youtubeFallbackBaseUrl, undefined);
  assert.deepEqual(config.youtubeFallbackMediaHosts, []);
  assert.equal(config.movieQuizEnabled, false);
  assert.equal(config.movieQuizRateWindowMs, 5_000);
  assert.equal(config.logoMaxConcurrency, 1);
  assert.equal(config.logoRenderTimeoutMs, 45_000);
  assert.equal(config.logoMaxOutputBytes, 8 * 1024 * 1024);
  assert.equal(config.imageGenMode, 'pollinations');
  assert.equal(config.pollinationsImageEnhance, false);
  assert.equal(config.cloudflareAccountId, undefined);
  assert.equal(config.cloudflareApiToken, undefined);
  assert.equal(config.cloudflareImageModel, '@cf/black-forest-labs/flux-2-klein-4b');
  assert.equal(config.cloudflareImageCanaryPercent, 10);
});

test('buildConfig ativa canário Cloudflare somente com conta e token privados válidos', () => {
  assert.throws(
    () => buildConfig({ ...BASE_ENV, IMAGE_GEN_MODE: 'cloudflare-canary' }),
    /geração de imagem/,
  );
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    IMAGE_GEN_MODE: 'cloudflare-canary',
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_API_TOKEN: 'cloudflare-test-token-0123456789',
    CLOUDFLARE_IMAGE_CANARY_PERCENT: '0',
  }), /canário/);

  const config = buildConfig({
    ...BASE_ENV,
    IMAGE_GEN_MODE: 'cloudflare-canary',
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_API_TOKEN: ' cloudflare-test-token-0123456789 ',
    CLOUDFLARE_IMAGE_CANARY_PERCENT: '25',
  });
  assert.equal(config.imageGenMode, 'cloudflare-canary');
  assert.equal(config.cloudflareAccountId, '0123456789abcdef0123456789abcdef');
  assert.equal(config.cloudflareApiToken, 'cloudflare-test-token-0123456789');
  assert.equal(config.cloudflareImageCanaryPercent, 25);
});

test('buildConfig recusa ids, modelos, percentuais e booleanos frouxos na geração de imagem', () => {
  const cloudflareEnv = {
    ...BASE_ENV,
    IMAGE_GEN_MODE: 'cloudflare-primary',
    CLOUDFLARE_ACCOUNT_ID: '0123456789abcdef0123456789abcdef',
    CLOUDFLARE_API_TOKEN: 'cloudflare-test-token-0123456789',
  };
  assert.throws(() => buildConfig({ ...cloudflareEnv, CLOUDFLARE_ACCOUNT_ID: 'conta-inválida' }));
  assert.throws(() => buildConfig({ ...cloudflareEnv, CLOUDFLARE_IMAGE_MODEL: 'https://modelo.example' }));
  assert.throws(() => buildConfig({ ...cloudflareEnv, CLOUDFLARE_IMAGE_CANARY_PERCENT: '101' }));
  assert.throws(() => buildConfig({ ...BASE_ENV, POLLINATIONS_IMAGE_ENHANCE: 'yes' }));

  const compatibility = buildConfig({ ...BASE_ENV, POLLINATIONS_IMAGE_ENHANCE: 'true' });
  assert.equal(compatibility.pollinationsImageEnhance, true);
});

test('buildConfig nunca cai num segredo padrão inseguro', () => {
  assert.throws(() => buildConfig({ BUNNYFY_API_TOKENS: BASE_ENV.BUNNYFY_API_TOKENS }));
  assert.throws(() => buildConfig({ MEDIA_SIGNING_SECRET: BASE_ENV.MEDIA_SIGNING_SECRET }));
});

test('buildConfig aceita chaves modernas com escopo sem exigir token legado', () => {
  const key = `bf_live_${'x'.repeat(43)}`;
  const config = buildConfig({
    MEDIA_SIGNING_SECRET: BASE_ENV.MEDIA_SIGNING_SECRET,
    BUNNYFY_API_KEYS: JSON.stringify([{ id: 'gyomei', key, scopes: ['ai:chat'] }]),
  });

  assert.equal(config.apiKeys.size, 1);
  assert.equal(config.apiKeys.authenticate(key, 'ai:chat')?.id, 'gyomei');
  assert.equal(config.apiKeys.authenticate(key, 'media:write'), undefined);
});

test('buildConfig sanitiza erro de chave moderna inválida', () => {
  const privateValue = 'segredo-privado-nao-pode-vazar';
  assert.throws(
    () =>
      buildConfig({
        MEDIA_SIGNING_SECRET: BASE_ENV.MEDIA_SIGNING_SECRET,
        BUNNYFY_API_KEYS: JSON.stringify([{ id: 'gyomei', key: privateValue, scopes: ['ai:chat'] }]),
      }),
    (error: unknown) => error instanceof Error && !error.message.includes(privateValue),
  );
});

test('buildConfig aceita gateway de IA opcional sem imprimir ou inventar credencial', () => {
  const config = buildConfig({
    ...BASE_ENV,
    AI_CHAT_ENABLED: 'true',
    NVIDIA_API_KEY: ' provider-test-key-0123456789abcdef ',
    NVIDIA_MODEL: ' example/model ',
    NVIDIA_ALLOWED_MODELS: ' example/model , example/fast ',
  });
  assert.equal(config.aiChatEnabled, true);
  assert.equal(config.nvidiaApiKey, 'provider-test-key-0123456789abcdef');
  assert.equal(config.nvidiaModel, 'example/model');
  assert.deepEqual(config.nvidiaAllowedModels, ['example/model', 'example/fast']);
});

test('buildConfig recusa ativar o gateway de IA sem credencial e modelo internos', () => {
  assert.throws(() => buildConfig({ ...BASE_ENV, AI_CHAT_ENABLED: 'true' }), /gateway de IA/);
  assert.throws(
    () =>
      buildConfig({
        ...BASE_ENV,
        AI_CHAT_ENABLED: 'true',
        NVIDIA_API_KEY: 'provider-test-key-0123456789abcdef',
      }),
    /gateway de IA/,
  );
});

test('buildConfig rejeita limites incoerentes e identificador de modelo inseguro', () => {
  assert.throws(() =>
    buildConfig({
      ...BASE_ENV,
      AI_CHAT_MAX_MESSAGE_CHARS: '100',
      AI_CHAT_MAX_TOTAL_CHARS: '99',
    }),
  );
  assert.throws(() => buildConfig({ ...BASE_ENV, NVIDIA_MODEL: 'https://endpoint.example/modelo' }));
  assert.throws(() =>
    buildConfig({
      ...BASE_ENV,
      AI_CHAT_ENABLED: 'true',
      NVIDIA_API_KEY: 'provider-test-key-0123456789abcdef',
      NVIDIA_MODEL: 'example/default',
      NVIDIA_ALLOWED_MODELS: 'example/other',
    }),
  );
  assert.throws(() =>
    buildConfig({ ...BASE_ENV, NVIDIA_MODEL: 'example/default', NVIDIA_ALLOWED_MODELS: 'example/default,example/default' }),
  );
  assert.throws(() => buildConfig({ ...BASE_ENV, AI_CHAT_MAX_CONCURRENCY_PER_CONSUMER: '0' }));
  assert.throws(() => buildConfig({ ...BASE_ENV, AI_CHAT_MAX_REQUESTS_PER_MINUTE_PER_CONSUMER: '0' }));
  assert.throws(() => buildConfig({ ...BASE_ENV, YOUTUBE_DOWNLOAD_MAX_CONCURRENCY: '0' }));
  assert.throws(() => buildConfig({ ...BASE_ENV, YOUTUBE_DOWNLOAD_MAX_CONCURRENCY: '17' }));
  assert.throws(() => buildConfig({ ...BASE_ENV, MOVIE_QUIZ_RATE_WINDOW_MS: '4999' }));
});

test('buildConfig exige URL e segredo seguros antes de ativar o egress do YouTube', () => {
  const secret = 'segredo-egress-de-teste-0123456789abcdef';
  assert.throws(() => buildConfig({ ...BASE_ENV, YOUTUBE_EGRESS_ENABLED: 'true' }), /egress do YouTube/);
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_EGRESS_ENABLED: 'true',
    YOUTUBE_EGRESS_URL: 'https://egress.example.test',
  }), /egress do YouTube/);
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_EGRESS_ENABLED: 'true',
    YOUTUBE_EGRESS_URL: 'http://egress.example.test',
    YOUTUBE_EGRESS_SHARED_SECRET: secret,
  }), /URL base segura/);
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_EGRESS_ENABLED: 'true',
    YOUTUBE_EGRESS_URL: 'https://user:pass@egress.example.test/path?private=1',
    YOUTUBE_EGRESS_SHARED_SECRET: secret,
  }), /URL base segura/);

  const config = buildConfig({
    ...BASE_ENV,
    YOUTUBE_EGRESS_ENABLED: 'true',
    YOUTUBE_EGRESS_URL: 'https://egress.example.test/',
    YOUTUBE_EGRESS_SHARED_SECRET: secret,
  });
  assert.equal(config.youtubeEgressEnabled, true);
  assert.equal(config.youtubeEgressUrl, 'https://egress.example.test');
  assert.equal(config.youtubeEgressSharedSecret, secret);
});

test('buildConfig permite HTTP apenas para worker de egress em loopback', () => {
  const config = buildConfig({
    ...BASE_ENV,
    YOUTUBE_EGRESS_ENABLED: 'true',
    YOUTUBE_EGRESS_URL: 'http://127.0.0.1:43119',
    YOUTUBE_EGRESS_SHARED_SECRET: 'segredo-egress-loopback-0123456789abcdef',
  });
  assert.equal(config.youtubeEgressUrl, 'http://127.0.0.1:43119');
});

test('buildConfig valida e normaliza o fallback privado do YouTube', () => {
  const privateKey = 'fallback-private-key-0123456789';
  assert.throws(
    () => buildConfig({ ...BASE_ENV, YOUTUBE_FALLBACK_ENABLED: 'true' }),
    /fallback do YouTube/,
  );
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_FALLBACK_ENABLED: 'true',
    YOUTUBE_FALLBACK_BASE_URL: 'http://fallback.example.test',
    YOUTUBE_FALLBACK_API_KEY: privateKey,
  }), /URL base segura/);
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_FALLBACK_ENABLED: 'true',
    YOUTUBE_FALLBACK_BASE_URL: 'https://fallback.example.test/private?key=secret',
    YOUTUBE_FALLBACK_API_KEY: privateKey,
  }), /URL base segura/);
  assert.throws(() => buildConfig({
    ...BASE_ENV,
    YOUTUBE_FALLBACK_ENABLED: 'true',
    YOUTUBE_FALLBACK_BASE_URL: 'https://fallback.example.test',
    YOUTUBE_FALLBACK_API_KEY: privateKey,
    YOUTUBE_FALLBACK_MEDIA_HOSTS: 'fallback.example.test,fallback.example.test',
  }), /allowlist/);

  const config = buildConfig({
    ...BASE_ENV,
    YOUTUBE_FALLBACK_ENABLED: 'true',
    YOUTUBE_FALLBACK_BASE_URL: 'https://fallback.example.test/',
    YOUTUBE_FALLBACK_API_KEY: privateKey,
    YOUTUBE_FALLBACK_MEDIA_HOSTS: 'fallback.example.test, cdn.example.test',
  });
  assert.equal(config.youtubeFallbackEnabled, true);
  assert.equal(config.youtubeFallbackBaseUrl, 'https://fallback.example.test');
  assert.equal(config.youtubeFallbackApiKey, privateKey);
  assert.deepEqual(config.youtubeFallbackMediaHosts, ['fallback.example.test', 'cdn.example.test']);
});
