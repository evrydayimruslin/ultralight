export type CommandDescriptorCacheNamespace =
  | "interface_reply"
  | "suggestion_preview";

export interface CommandDescriptorCacheEntry<T> {
  value: T;
  source: string;
  hits: number;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

const DESCRIPTOR_CACHE_MAX_ENTRIES = 128;
const descriptorCache = new Map<
  string,
  CommandDescriptorCacheEntry<unknown>
>();

function cacheKey(
  namespace: CommandDescriptorCacheNamespace,
  key: string,
): string {
  return `${namespace}::${key}`;
}

function evictDescriptorCacheIfNeeded(): void {
  if (descriptorCache.size <= DESCRIPTOR_CACHE_MAX_ENTRIES) return;
  const evictable = [...descriptorCache.entries()]
    .filter(([, entry]) => !entry.pinned)
    .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  while (
    descriptorCache.size > DESCRIPTOR_CACHE_MAX_ENTRIES &&
    evictable.length > 0
  ) {
    const [key] = evictable.shift()!;
    descriptorCache.delete(key);
  }
}

export function readCommandDescriptorCache<T>(
  namespace: CommandDescriptorCacheNamespace,
  key: string,
  validate?: (value: T) => T | null,
): T | null {
  const fullKey = cacheKey(namespace, key);
  const entry = descriptorCache.get(fullKey);
  if (!entry) return null;

  const value = entry.value as T;
  const validated = validate ? validate(value) : value;
  if (!validated) {
    descriptorCache.delete(fullKey);
    return null;
  }

  entry.value = validated;
  entry.hits += 1;
  entry.updatedAt = Date.now();
  if (entry.hits >= 3) entry.pinned = true;
  return validated;
}

export function writeCommandDescriptorCache<T>(
  namespace: CommandDescriptorCacheNamespace,
  key: string,
  value: T,
  source: string,
): void {
  const fullKey = cacheKey(namespace, key);
  const existing = descriptorCache.get(fullKey);
  descriptorCache.set(fullKey, {
    value,
    source,
    hits: existing?.hits ?? 0,
    pinned: existing?.pinned ?? false,
    createdAt: existing?.createdAt ?? Date.now(),
    updatedAt: Date.now(),
  });
  evictDescriptorCacheIfNeeded();
}

export function clearCommandDescriptorCacheForTests(
  namespace?: CommandDescriptorCacheNamespace,
): void {
  if (!namespace) {
    descriptorCache.clear();
    return;
  }
  const prefix = `${namespace}::`;
  for (const key of descriptorCache.keys()) {
    if (key.startsWith(prefix)) descriptorCache.delete(key);
  }
}

export function getCommandDescriptorCacheStatsForTests(
  namespace?: CommandDescriptorCacheNamespace,
): { size: number; pinned: number; hits: number } {
  const entries = [...descriptorCache.entries()]
    .filter(([key]) => !namespace || key.startsWith(`${namespace}::`))
    .map(([, entry]) => entry);
  return {
    size: entries.length,
    pinned: entries.filter((entry) => entry.pinned).length,
    hits: entries.reduce((sum, entry) => sum + entry.hits, 0),
  };
}
