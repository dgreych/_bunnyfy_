import { AppError } from '../envelope.ts';
import { sniffImageFormat, type SniffedImage } from './imageSniff.ts';

type StreamReadResult = {
  done: boolean;
  value?: Uint8Array;
};

export async function readResponseBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel('response-too-large').catch(() => undefined);
    throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
  }
  if (!response.body) throw AppError.unavailable('Resposta da geração de imagem sem corpo.');

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const result = (await reader.read()) as StreamReadResult;
      if (result.done) break;
      if (!result.value) continue;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel('response-too-large').catch(() => undefined);
        throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function decodeBase64Image(value: string, maxBytes: number): Buffer {
  const trimmed = value.trim();
  const dataUri = /^data:image\/(?:png|jpe?g|webp);base64,(.*)$/i.exec(trimmed);
  const encoded = dataUri?.[1] ?? trimmed;
  const maxEncodedChars = Math.ceil(maxBytes / 3) * 4 + 4;

  if (encoded.length === 0) throw AppError.unavailable('Geração de imagem devolveu corpo vazio.');
  if (encoded.length > maxEncodedChars) {
    throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
    throw AppError.unavailable('Resposta inválida da geração de imagem.');
  }

  const padded = encoded.padEnd(encoded.length + ((4 - (encoded.length % 4)) % 4), '=');
  const bytes = Buffer.from(padded, 'base64');
  const canonical = bytes.toString('base64').replace(/=+$/, '');
  if (canonical !== encoded.replace(/=+$/, '')) {
    throw AppError.unavailable('Resposta inválida da geração de imagem.');
  }
  if (bytes.length === 0) throw AppError.unavailable('Geração de imagem devolveu corpo vazio.');
  if (bytes.length > maxBytes) throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');
  return bytes;
}

export function validateGeneratedImage(bytes: Buffer, maxBytes: number): SniffedImage {
  if (bytes.length === 0) throw AppError.unavailable('Geração de imagem devolveu corpo vazio.');
  if (bytes.length > maxBytes) throw AppError.payloadTooLarge('Imagem gerada excede o limite permitido.');

  const sniffed = sniffImageFormat(bytes.subarray(0, 16));
  if (!sniffed) throw AppError.unavailable('Geração de imagem devolveu mídia inválida.');
  return sniffed;
}
