import { getEnv } from "../lib/env.ts";

const LEGACY_SALT = "ultralight-salt";
const PER_RECORD_SALT_LENGTH = 16;
const IV_LENGTH = 12;

async function deriveEncryptionKey(salt: Uint8Array): Promise<CryptoKey> {
  const encryptionKey = getEnv("BYOK_ENCRYPTION_KEY");
  if (!encryptionKey) {
    throw new Error("BYOK_ENCRYPTION_KEY is not configured");
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(encryptionKey),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptApiKey(apiKey: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(PER_RECORD_SALT_LENGTH));
  const key = await deriveEncryptionKey(salt);
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    encoder.encode(apiKey) as BufferSource,
  );

  const combined = new Uint8Array(
    PER_RECORD_SALT_LENGTH + IV_LENGTH + encrypted.byteLength,
  );
  combined.set(salt);
  combined.set(iv, PER_RECORD_SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), PER_RECORD_SALT_LENGTH + IV_LENGTH);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptApiKey(encryptedKey: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedKey), (c) => c.charCodeAt(0));

  let decrypted: ArrayBuffer;
  try {
    const salt = combined.slice(0, PER_RECORD_SALT_LENGTH);
    const iv = combined.slice(
      PER_RECORD_SALT_LENGTH,
      PER_RECORD_SALT_LENGTH + IV_LENGTH,
    );
    const data = combined.slice(PER_RECORD_SALT_LENGTH + IV_LENGTH);
    const key = await deriveEncryptionKey(salt);
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource,
    );
  } catch {
    const legacySalt = new TextEncoder().encode(LEGACY_SALT);
    const iv = combined.slice(0, IV_LENGTH);
    const data = combined.slice(IV_LENGTH);
    const key = await deriveEncryptionKey(legacySalt);
    decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as BufferSource },
      key,
      data as BufferSource,
    );
  }

  return new TextDecoder().decode(decrypted);
}
