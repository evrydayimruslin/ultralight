// R2 Storage Service
// Native Cloudflare R2 bindings — replaces AWS SigV4 HTTP signing.
// All consumer files use createR2Service() and call the same methods as before.

export interface FileUpload {
  name: string;
  content: Uint8Array;
  contentType: string;
}

export class R2Service {
  private bucket: R2Bucket;

  constructor() {
    this.bucket = globalThis.__env.R2_BUCKET;
  }

  async uploadFile(key: string, file: FileUpload): Promise<void> {
    await this.bucket.put(key, file.content, {
      httpMetadata: { contentType: file.contentType },
    });
  }

  async uploadFiles(prefix: string, files: FileUpload[]): Promise<void> {
    await Promise.all(files.map(f => this.uploadFile(`${prefix}${f.name}`, f)));
  }

  async fetchFile(key: string): Promise<Uint8Array> {
    const obj = await this.bucket.get(key);
    if (!obj) throw new Error(`File not found: ${key}`);
    return new Uint8Array(await obj.arrayBuffer());
  }

  async fetchTextFile(key: string): Promise<string> {
    const obj = await this.bucket.get(key);
    if (!obj) throw new Error(`File not found: ${key}`);
    return await obj.text();
  }

  async deleteFile(key: string): Promise<void> {
    await this.bucket.delete(key);
  }

  async listFiles(prefix: string): Promise<string[]> {
    const listed = await this.bucket.list({ prefix });
    return listed.objects.map(o => o.key);
  }

  static getAppStorageKey(appId: string, version: string): string {
    return `apps/${appId}/${version}/`;
  }
}

export function createR2Service(): R2Service {
  return new R2Service();
}
