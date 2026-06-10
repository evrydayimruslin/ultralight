import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  decryptEnvVar,
  decryptLegacyEnvVarForMigration,
  encryptEnvVar,
} from "./envvars.ts";

const TEST_ENV = {
  BYOK_ENCRYPTION_KEY: "1234567890abcdef1234567890abcdef",
  ENV_VARS_ENCRYPTION_KEY: "abcdef1234567890abcdef1234567890",
};

const LEGACY_SALT = "ultralight-env-vars-salt";
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

async function deriveLegacyEnvKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(TEST_ENV.ENV_VARS_ENCRYPTION_KEY),
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

async function encryptLegacyEnvVarForTest(value: string): Promise<string> {
  const key = await deriveLegacyEnvKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    new TextEncoder().encode(value) as BufferSource,
  );

  const combined = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), IV_LENGTH);
  return btoa(String.fromCharCode(...combined));
}

Deno.test("envvars: round-trips canonical encrypted values", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const encrypted = await encryptEnvVar("service-role-secret");
      const decrypted = await decryptEnvVar(encrypted);
      assertEquals(decrypted, "service-role-secret");
    });
  });
});

Deno.test("envvars: canonical decrypt rejects legacy v1 blobs", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const legacyBlob = await encryptLegacyEnvVarForTest("legacy-secret");
      await assertRejects(() => decryptEnvVar(legacyBlob));
    });
  });
});

Deno.test("envvars: migration helper decrypts legacy v1 blobs", async () => {
  await runSerial(async () => {
    await withMockedEnv(async () => {
      const legacyBlob = await encryptLegacyEnvVarForTest("legacy-secret");
      const decrypted = await decryptLegacyEnvVarForMigration(legacyBlob);
      assertEquals(decrypted, "legacy-secret");
    });
  });
});
