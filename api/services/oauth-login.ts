export function normalizeOAuthPrompt(rawPrompt: string | null): string | null {
  if (!rawPrompt) return null;
  const normalized = rawPrompt.trim();
  if (normalized === 'select_account') return normalized;
  return null;
}
