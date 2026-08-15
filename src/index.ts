import { loadEnvFile } from 'node:process';

import { buildApp } from './app.ts';
import { buildConfig } from './config.ts';

function loadLocalEnvironment(): void {
  try {
    loadEnvFile();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') throw error;
  }
}

async function main(): Promise<void> {
  loadLocalEnvironment();

  const config = buildConfig();
  const { app } = await buildApp({ config });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'desligando graciosamente');

    const forceExit = setTimeout(() => {
      app.log.error('desligamento gracioso excedeu o prazo, forçando saída');
      process.exit(1);
    }, config.shutdownTimeoutMs);
    forceExit.unref();

    try {
      await app.close();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (error) {
      app.log.error({ err: error }, 'erro ao desligar');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error('Falha ao iniciar a BunnyFy:', error);
  process.exit(1);
});
