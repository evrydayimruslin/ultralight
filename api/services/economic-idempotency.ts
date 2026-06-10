export function buildEconomicIdempotencyKey(
  scope: string,
  parts: Array<string | number | boolean | null | undefined>,
): string | null {
  const cleanScope = encodePart(scope);
  if (!cleanScope) return null;

  const cleanParts = parts.map(encodePart).filter((part) => part.length > 0);
  if (cleanParts.length === 0) return null;

  return `${cleanScope}:${cleanParts.join(":")}`;
}

function encodePart(
  value: string | number | boolean | null | undefined,
): string {
  if (value === null || value === undefined) return "";
  const raw = String(value).trim();
  if (!raw) return "";
  return encodeURIComponent(raw);
}
