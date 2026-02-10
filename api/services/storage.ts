// R2 Storage Service
// Handles file uploads and retrieval from Cloudflare R2

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

export interface FileUpload {
  name: string;
  content: Uint8Array;
  contentType: string;
}

// Simple HMAC-SHA256 implementation
async function hmacSha256(key: ArrayBuffer | string, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const keyData = typeof key === 'string' ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

export class R2Service {
  private config: R2Config;
  private endpoint: string;

  constructor(config: R2Config) {
    this.config = config;
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  }

  /**
   * Generate AWS Signature V4 headers
   */
  private async signRequest(
    method: string,
    path: string,
    headers: Record<string, string> = {},
    body?: Uint8Array,
    queryString: string = '',
  ): Promise<Record<string, string>> {
    const now = new Date();
    const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
    const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '');
    const region = 'auto';
    const service = 's3';

    // Create canonical request
    const host = `${this.config.accountId}.r2.cloudflarestorage.com`;
    const payloadHash = body ? await sha256(new TextDecoder().decode(body)) : await sha256('');

    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
    const canonicalHeaders = [
      `host:${host}`,
      `x-amz-content-sha256:${payloadHash}`,
      `x-amz-date:${amzDate}`,
    ].join('\n') + '\n';

    // For AWS Sig V4, query parameters must be sorted and included in canonical request
    const canonicalQueryString = queryString
      ? queryString.split('&').sort().join('&')
      : '';

    const canonicalRequest = [
      method,
      `/${this.config.bucketName}${path}`,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    // Create string to sign
    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const canonicalRequestHash = await sha256(canonicalRequest);
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      canonicalRequestHash,
    ].join('\n');

    // Calculate signature
    const kSecret = this.config.secretAccessKey;
    const kDate = await hmacSha256(`AWS4${kSecret}`, dateStamp);
    const kRegion = await hmacSha256(kDate, region);
    const kService = await hmacSha256(kRegion, service);
    const kSigning = await hmacSha256(kService, 'aws4_request');
    const signature = toHex(await hmacSha256(kSigning, stringToSign));

    // Build authorization header
    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Host': host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-SHA256': payloadHash,
      'Authorization': authHeader,
    };
  }

  /**
   * Upload a file to R2
   */
  async uploadFile(key: string, file: FileUpload): Promise<void> {
    const headers = await this.signRequest(
      'PUT',
      `/${key}`,
      {
        'Content-Type': file.contentType,
        'Content-Length': String(file.content.length),
      },
      file.content
    );

    const url = `${this.endpoint}/${this.config.bucketName}/${key}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers,
      body: file.content,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`R2 upload failed: ${response.status} - ${error}`);
    }
  }

  /**
   * Upload multiple files
   */
  async uploadFiles(prefix: string, files: FileUpload[]): Promise<void> {
    const uploads = files.map((file) => this.uploadFile(`${prefix}${file.name}`, file));
    await Promise.all(uploads);
  }

  /**
   * Fetch file content from R2
   */
  async fetchFile(key: string): Promise<Uint8Array> {
    const headers = await this.signRequest('GET', `/${key}`);
    const url = `${this.endpoint}/${this.config.bucketName}/${key}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`File not found: ${key}`);
      }
      const error = await response.text();
      throw new Error(`R2 fetch failed: ${response.status} - ${error}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }

  /**
   * Fetch text file from R2
   */
  async fetchTextFile(key: string): Promise<string> {
    const data = await this.fetchFile(key);
    return new TextDecoder().decode(data);
  }

  /**
   * Delete a file from R2
   */
  async deleteFile(key: string): Promise<void> {
    const headers = await this.signRequest('DELETE', `/${key}`);
    const url = `${this.endpoint}/${this.config.bucketName}/${key}`;

    const response = await fetch(url, {
      method: 'DELETE',
      headers,
    });

    if (!response.ok && response.status !== 404) {
      const error = await response.text();
      throw new Error(`R2 delete failed: ${response.status} - ${error}`);
    }
  }

  /**
   * List files with prefix
   */
  async listFiles(prefix: string): Promise<string[]> {
    const queryParams = `list-type=2&prefix=${encodeURIComponent(prefix)}`;
    // Note: S3 ListObjectsV2 uses the bucket root path (empty string, not '/')
    const headers = await this.signRequest('GET', '', {}, undefined, queryParams);
    const url = `${this.endpoint}/${this.config.bucketName}?${queryParams}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`R2 list failed: ${response.status} - ${error}`);
    }

    // Parse XML response
    const xml = await response.text();
    const keys: string[] = [];
    const keyMatches = xml.matchAll(/<Key>([^<]+)<\/Key>/g);
    for (const match of keyMatches) {
      keys.push(match[1]);
    }

    return keys;
  }

  /**
   * Generate storage key for app
   */
  static getAppStorageKey(appId: string, version: string): string {
    return `apps/${appId}/${version}/`;
  }
}

// Factory function
export function createR2Service(): R2Service {
  // @ts-ignore
  const accountId = typeof Deno !== 'undefined' ? Deno.env.get('R2_ACCOUNT_ID') : '';
  // @ts-ignore
  const accessKeyId = typeof Deno !== 'undefined' ? Deno.env.get('R2_ACCESS_KEY_ID') : '';
  // @ts-ignore
  const secretAccessKey = typeof Deno !== 'undefined' ? Deno.env.get('R2_SECRET_ACCESS_KEY') : '';
  // @ts-ignore
  const bucketName = typeof Deno !== 'undefined' ? Deno.env.get('R2_BUCKET_NAME') : '';

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error('R2 credentials not fully configured');
  }

  return new R2Service({
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
  });
}
