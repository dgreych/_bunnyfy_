// eslint-disable-next-line no-control-regex -- caracteres de controle não podem chegar ao SVG.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function normalizeCanvasText(value: string): string {
  return value.normalize('NFKC').replace(CONTROL_CHARACTERS, '').replace(/\s+/g, ' ').trim();
}

export function escapeXml(value: string): string {
  return normalizeCanvasText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export function truncateCanvasText(value: string, maxCharacters: number): string {
  const normalized = normalizeCanvasText(value);
  const characters = [...normalized];
  if (characters.length <= maxCharacters) return normalized;
  return `${characters.slice(0, Math.max(1, maxCharacters - 1)).join('')}…`;
}

export function initials(value: string): string {
  const words = normalizeCanvasText(value).split(' ').filter(Boolean);
  if (words.length === 0) return '?';
  const selected = words.length === 1 ? words[0]!.slice(0, 2) : `${words[0]![0]}${words.at(-1)![0]}`;
  return selected.toUpperCase();
}

export function displayNumber(value: string | number): string {
  if (typeof value === 'number') return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 }).format(value);
  return truncateCanvasText(value, 24);
}
