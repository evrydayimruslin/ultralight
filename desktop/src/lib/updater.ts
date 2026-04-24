import { DESKTOP_ENVIRONMENT } from './environment';

export const ULTRALIGHT_RELEASES_REPO = 'evrydayimruslin/ultralight';
export const ULTRALIGHT_UPDATER_ENDPOINT =
  `https://github.com/${ULTRALIGHT_RELEASES_REPO}/releases/latest/download/latest.json`;

export const DESKTOP_UPDATER_ENABLED = DESKTOP_ENVIRONMENT === 'production';

export function summarizeUpdateNotes(notes: string | null | undefined, maxLength = 220): string | null {
  const normalized = notes?.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

export function formatUpdateDate(rawDate: string | null | undefined): string | null {
  if (!rawDate) return null;

  const parsed = new Date(rawDate);
  if (Number.isNaN(parsed.getTime())) return null;

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(parsed);
}
