import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Assinatura HMAC pra URL de leitura de mídia de curta duração — permite um
 * consumidor (ex.: WhatsApp buscando a mídia) acessar sem precisar anexar
 * `Authorization`, mas só até `expiresAt` e só pra aquele id específico.
 */
export function signMediaAccess(id: string, expiresAtEpochSeconds: number, secret: string): string {
  return createHmac('sha256', secret).update(`${id}.${expiresAtEpochSeconds}`).digest('hex');
}

export function verifyMediaAccess(
  id: string,
  expiresAtEpochSeconds: number,
  signature: string,
  secret: string,
  now: number = Date.now(),
): boolean {
  if (expiresAtEpochSeconds * 1000 <= now) return false;

  const expected = signMediaAccess(id, expiresAtEpochSeconds, secret);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(signature, 'hex');

  if (expectedBuffer.length !== providedBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, providedBuffer);
}
