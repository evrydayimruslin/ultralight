import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  decryptApiKey,
  decryptLegacyApiKeyForMigration,
  encryptApiKey,
} from "./api-key-crypto.ts";

const TEST_ENV = {
  BYOK_ENCRYPTION_KEY: "1234567890abcdef1234567890abcdef",
};

const LEGACY_SALT = "ultralight-salt";
const IV_LENGTH = 12;

let testQueue = Promise.resolve();

async function runSerial(fn: () => Promise<void>): Promise<void> {
  const run = testQueue.then(fn, fn);
  testQueue = run.catch(() => {});
  await run;
}

async function withMockedEnv(fn: () => Promise<void>): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;

  globalWithEnv.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  };

  try {
    await fn();
  } finally {
    globalWithEnv.__env = previousEnv;
  }
}

async function deriveLegacyApiKeyKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TEST_ENV.BYOK_ENCRYPTION_KEY),
    "PBKDF2",
    false,
    ["deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode(LEGACY_SALT),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptLegacyApiKeyForTest(apiKey: string): Promise<string> {
  const key = await deriveLegacyApiKeyKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(apiKey) as BufferSource,
  );

  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);
  return btoa(String.fromCharCode(...combined));
}

Deno.test("api-key-crypto: round-trips canonical API key blobs", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const encrypted = await encryptApiKey("sk-live-canonical");
      const decrypted = await decryptApiKey(encrypted);
      assertEquals(decrypted, "sk-live-canonical");
    });
  });
});

Deno.test("api-key-crypto: canonical decrypt rejects legacy global-salt blobs", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const legacyBlob = await encryptLegacyApiKeyForTest("sk-live-legacy");
      await assertRejects(() => decryptApiKey(legacyBlob));
    });
  });
});

Deno.test("api-key-crypto: migration helper decrypts legacy global-salt blobs", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const legacyBlob = await encryptLegacyApiKeyForTest("sk-live-legacy");
      const decrypted = await decryptLegacyApiKeyForMigration(legacyBlob);
      assertEquals(decrypted, "sk-live-legacy");
    });
  });
});
