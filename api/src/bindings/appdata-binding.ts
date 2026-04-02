// RPC App Data Binding for Dynamic Workers
// Wraps R2 app data operations behind a WorkerEntrypoint.
// The Dynamic Worker sees env.DATA.store() etc. but never has direct R2 access.

import { WorkerEntrypoint } from 'cloudflare:workers';

// ============================================
// TYPES
// ============================================

interface AppDataBindingProps {
  appId: string;
  userId: string;
}

// ============================================
// RPC BINDING
// ============================================

export class AppDataBinding extends WorkerEntrypoint<unknown, AppDataBindingProps> {

  private getR2Bucket(): R2Bucket {
    return globalThis.__env.R2_BUCKET;
  }

  private dataKey(key: string): string {
    const { appId, userId } = this.ctx.props;
    const sanitized = key.replace(/[^a-zA-Z0-9\-_\/]/g, '_');
    return userId
      ? `apps/${appId}/users/${userId}/data/${sanitized}.json`
      : `apps/${appId}/data/${sanitized}.json`;
  }

  async store(key: string, value: unknown): Promise<void> {
    const bucket = this.getR2Bucket();
    const data = JSON.stringify({
      key,
      value,
      updated_at: new Date().toISOString(),
    });
    await bucket.put(this.dataKey(key), data, {
      httpMetadata: { contentType: 'application/json' },
    });
  }

  async load(key: string): Promise<unknown> {
    const bucket = this.getR2Bucket();
    const obj = await bucket.get(this.dataKey(key));
    if (!obj) return null;
    const text = await obj.text();
    try {
      const parsed = JSON.parse(text);
      return parsed.value ?? parsed;
    } catch {
      return text;
    }
  }

  async remove(key: string): Promise<void> {
    const bucket = this.getR2Bucket();
    await bucket.delete(this.dataKey(key));
  }

  async list(prefix?: string): Promise<string[]> {
    const bucket = this.getR2Bucket();
    const { appId, userId } = this.ctx.props;
    const r2Prefix = userId
      ? `apps/${appId}/users/${userId}/data/${prefix || ''}`
      : `apps/${appId}/data/${prefix || ''}`;
    const listed = await bucket.list({ prefix: r2Prefix });
    return listed.objects.map(o => {
      // Extract the user-facing key from the R2 path
      const fullKey = o.key;
      const dataIdx = fullKey.indexOf('/data/');
      if (dataIdx >= 0) {
        return fullKey.slice(dataIdx + 6).replace(/\.json$/, '');
      }
      return fullKey;
    });
  }
}
