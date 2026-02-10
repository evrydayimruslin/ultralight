// Environment Variables Service
// Handles encryption/decryption of app environment variables

// @ts-ignore - Deno is available in Deno Deploy
const Deno = globalThis.Deno;

const ENCRYPTION_KEY_ENV = 'ENV_VARS_ENCRYPTION_KEY';

/**
 * Get the encryption key from environment
 * Falls back to BYOK_ENCRYPTION_KEY if ENV_VARS_ENCRYPTION_KEY is not set
 */
function getEncryptionKey(): string {
  const key = Deno?.env?.get(ENCRYPTION_KEY_ENV) || Deno?.env?.get('BYOK_ENCRYPTION_KEY');
  if (!key) {
    throw new Error('ENV_VARS_ENCRYPTION_KEY or BYOK_ENCRYPTION_KEY environment variable is required');
  }
  return key;
}

/**
 * Derive a crypto key from the master key
 */
async function deriveKey(masterKey: string): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode('ultralight-env-vars-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a single environment variable value
 */
export async function encryptEnvVar(value: string): Promise<string> {
  const masterKey = getEncryptionKey();
  const key = await deriveKey(masterKey);

  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value)
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  // Return as base64
  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a single environment variable value
 */
export async function decryptEnvVar(encryptedValue: string): Promise<string> {
  const masterKey = getEncryptionKey();
  const key = await deriveKey(masterKey);

  // Decode from base64
  const combined = new Uint8Array(
    atob(encryptedValue).split('').map(c => c.charCodeAt(0))
  );

  // Extract IV and encrypted data
  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    encrypted
  );

  return new TextDecoder().decode(decrypted);
}

/**
 * Encrypt all environment variables for storage
 */
export async function encryptEnvVars(
  envVars: Record<string, string>
): Promise<Record<string, string>> {
  const encrypted: Record<string, string> = {};

  for (const [key, value] of Object.entries(envVars)) {
    encrypted[key] = await encryptEnvVar(value);
  }

  return encrypted;
}

/**
 * Decrypt all environment variables for use
 */
export async function decryptEnvVars(
  encryptedEnvVars: Record<string, string>
): Promise<Record<string, string>> {
  const decrypted: Record<string, string> = {};

  for (const [key, encryptedValue] of Object.entries(encryptedEnvVars)) {
    try {
      decrypted[key] = await decryptEnvVar(encryptedValue);
    } catch (err) {
      console.error(`Failed to decrypt env var ${key}:`, err);
      // Skip vars that fail to decrypt
    }
  }

  return decrypted;
}

/**
 * Mask a value for display (show only last 4 chars)
 */
export function maskEnvVarValue(value: string): string {
  if (value.length <= 4) {
    return '••••';
  }
  return '••••' + value.slice(-4);
}

/**
 * Get env var keys with masked values (for API responses to owner)
 */
export function getEnvVarsSummary(
  envVars: Record<string, string>
): Array<{ key: string; masked: string; length: number }> {
  return Object.entries(envVars).map(([key, value]) => ({
    key,
    masked: maskEnvVarValue(value),
    length: value.length,
  }));
}
