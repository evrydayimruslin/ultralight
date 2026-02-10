// Storage Quota Service
// Storage quotas have been removed. All functions are no-ops for backward compatibility.

export interface StorageQuotaResult {
  allowed: boolean;
  used_bytes: number;
  limit_bytes: number;
  remaining_bytes: number;
}

/** @deprecated Storage quotas removed. Always returns allowed. */
export async function checkStorageQuota(
  _userId: string,
  _uploadSizeBytes: number
): Promise<StorageQuotaResult> {
  return { allowed: true, used_bytes: 0, limit_bytes: 0, remaining_bytes: 0 };
}

/** @deprecated Storage tracking removed. No-op. */
export async function recordUploadStorage(
  _userId: string,
  _appId: string,
  _version: string,
  _sizeBytes: number
): Promise<void> {}

/** @deprecated Storage tracking removed. No-op. */
export async function reclaimAppStorage(
  _userId: string,
  _appId: string
): Promise<number> {
  return 0;
}

/** @deprecated Storage tracking removed. No-op. */
export async function reclaimVersionStorage(
  _userId: string,
  _appId: string,
  _version: string
): Promise<number> {
  return 0;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}
