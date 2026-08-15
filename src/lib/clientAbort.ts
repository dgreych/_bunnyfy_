import type { IncomingMessage, ServerResponse } from 'node:http';

export interface ClientAbortBinding {
  readonly signal: AbortSignal;
  detach(): void;
}

/**
 * Propaga encerramento do cliente ao trabalho externo. Os listeners sao
 * registrados antes da leitura do estado para fechar a janela de corrida em
 * que a conexao termina entre essas duas operacoes.
 */
export function bindClientAbort(request: IncomingMessage, response: ServerResponse): ClientAbortBinding {
  const controller = new AbortController();
  const abort = () => controller.abort();

  request.once('aborted', abort);
  response.once('close', abort);

  // IncomingMessage.destroyed pode ficar true depois que o Fastify consome o
  // corpo por completo, mesmo com a resposta ainda aberta. Nesse estado a
  // chamada externa continua válida; o sinal confiável de abandono do cliente
  // é request.aborted ou o fechamento da resposta.
  if (request.aborted || response.destroyed || response.writableEnded) {
    abort();
  }

  return {
    signal: controller.signal,
    detach() {
      request.off('aborted', abort);
      response.off('close', abort);
    },
  };
}
