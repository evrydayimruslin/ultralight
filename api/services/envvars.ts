// Environment Variables Service
// Handles encryption/decryption of app environment variables

import { getEnv } from '../lib/env.ts';

const ENCRYPTION_KEY_ENV = 'ENV_VARS_ENCRYPTION_KEY';

/**
 * Get the encryption key from environment.
 * Canonical env-var encryption uses ENV_VARS_ENCRYPTION_KEY when present,
 * otherwise it shares BYOK_ENCRYPTION_KEY.
 */
function getEncryptionKey(): string {
  const key = getEnv(ENCRYPTION_KEY_ENV) || getEnv('BYOK_ENCRYPTION_KEY');
  if (!key) {
    throw new Error('ENV_VARS_ENCRYPTION_KEY or BYOK_ENCRYPTION_KEY environment variable is required');
  }
  return key;
}

// Canonical blob format: [salt(16) + IV(12) + ciphertext].
// Legacy v1 blobs used [IV(12) + ciphertext] with a global salt and are now
// only supported by the migration helper below.
const LEGACY_SALT = 'ultralight-env-vars-salt';
const PER_RECORD_SALT_LENGTH = 16;
const IV_LENGTH = 12;

/**
 * Derive a crypto key from the master key with a given salt
 */
async function deriveKey(masterKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const saltBytes = new Uint8Array(salt);
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
      salt: saltBytes,
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
 * Encrypt a single environment variable value (v2 format with per-record salt)
 */
export async function encryptEnvVar(value: string): Promise<string> {
  const masterKey = getEncryptionKey();
  const salt = crypto.getRandomValues(new Uint8Array(PER_RECORD_SALT_LENGTH));
  const key = await deriveKey(masterKey, salt);

  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value)
  );

  // Blob v2: salt + IV + ciphertext
  const combined = new Uint8Array(PER_RECORD_SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, PER_RECORD_SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), PER_RECORD_SALT_LENGTH + IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

/**
 * Decrypt a single environment variable value using the canonical per-record salt format.
 */
export async function decryptEnvVar(encryptedValue: string): Promise<string> {
  const masterKey = getEncryptionKey();
  const combined = new Uint8Array(
    atob(encryptedValue).split('').map(c => c.charCodeAt(0))
  );

  const salt = combined.slice(0, PER_RECORD_SALT_LENGTH);
  const iv = combined.slice(PER_RECORD_SALT_LENGTH, PER_RECORD_SALT_LENGTH + IV_LENGTH);
  const data = combined.slice(PER_RECORD_SALT_LENGTH + IV_LENGTH);
  const key = await deriveKey(masterKey, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

  return new TextDecoder().decode(decrypted);
}

export async function decryptLegacyEnvVarForMigration(encryptedValue: string): Promise<string> {
  const masterKey = getEncryptionKey();
  const combined = new Uint8Array(
    atob(encryptedValue).split('').map(c => c.charCodeAt(0))
  );
  const legacySalt = new TextEncoder().encode(LEGACY_SALT);
  const iv = combined.slice(0, IV_LENGTH);
  const data = combined.slice(IV_LENGTH);
  const key = await deriveKey(masterKey, legacySalt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);

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
