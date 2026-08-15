import fs from 'node:fs/promises';

/**
 * Identifica o formato de uma imagem pelos bytes reais (assinatura do
 * arquivo), nunca pelo MIME ou extensão declarados pelo cliente — os dois
 * são fáceis de falsificar num upload multipart.
 */
export type ImageFormat = 'png' | 'jpeg' | 'gif' | 'webp';

const FORMAT_MIME: Record<ImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface SniffedImage {
  format: ImageFormat;
  mime: string;
}

export function sniffImageFormat(header: Buffer): SniffedImage | null {
  if (header.length >= 8 && header.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return { format: 'png', mime: FORMAT_MIME.png };
  }

  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return { format: 'jpeg', mime: FORMAT_MIME.jpeg };
  }

  if (header.length >= 6) {
    const signature = header.subarray(0, 6).toString('ascii');
    if (signature === 'GIF87a' || signature === 'GIF89a') {
      return { format: 'gif', mime: FORMAT_MIME.gif };
    }
  }

  if (
    header.length >= 12 &&
    header.subarray(0, 4).toString('ascii') === 'RIFF' &&
    header.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { format: 'webp', mime: FORMAT_MIME.webp };
  }

  return null;
}

/** Lê só os primeiros bytes do arquivo — não carrega o arquivo inteiro na memória. */
export async function sniffImageFile(filePath: string): Promise<SniffedImage | null> {
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(16);
    const { bytesRead } = await handle.read(buffer, 0, 16, 0);
    return sniffImageFormat(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}
