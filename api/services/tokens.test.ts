import { assert, assertEquals } from "https://deno.land/std@0.210.0/assert/mod.ts";
import {
  classifyApiTokenCompatibility,
  verifyApiTokenRecord,
} from "./tokens.ts";

Deno.test("tokens: classifies canonical salted rows", () => {
  assertEquals(
    classifyApiTokenCompatibility({
      token_salt: "salt-123",
      plaintext_token: "ul_abcdef0123456789abcdef0123456789",
    }),
    "canonical",
  );
});

Deno.test("tokens: classifies canonical rows that no longer retain plaintext", () => {
  assertEquals(
    classifyApiTokenCompatibility({
      token_salt: "salt-123",
      plaintext_token: null,
    }),
    "canonical_missing_plaintext",
  );
});

Deno.test("tokens: classifies legacy rows that can be backfilled from plaintext", () => {
  assertEquals(
    classifyApiTokenCompatibility({
      token_salt: null,
      plaintext_token: "ul_abcdef0123456789abcdef0123456789",
    }),
    "legacy_backfillable_from_plaintext",
  );
});

Deno.test("tokens: classifies unrecoverable legacy rows", () => {
  assertEquals(
    classifyApiTokenCompatibility({
      token_salt: null,
      plaintext_token: null,
    }),
    "legacy_unrecoverable",
  );
});

Deno.test("tokens: verifies canonical salted rows without migration", async () => {
  const token = "ul_abcdef0123456789abcdef0123456789";
  const canonical = await verifyApiTokenRecord(token, {
    token_hash: "ignored",
    token_salt: "salt-123",
    plaintext_token: token,
  });

  assertEquals(canonical.state, "canonical");
  assertEquals(canonical.valid, false);
  assertEquals(canonical.reason, "hash_mismatch");
});

Deno.test("tokens: verifies canonical salted rows when the stored hash matches", async () => {
  const token = "ul_abcdef0123456789abcdef0123456789";
  const salted = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("salt-123"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", salted, new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(sig)).map((byte) => byte.toString(16).padStart(2, "0")).join("");

  const canonical = await verifyApiTokenRecord(token, {
    token_hash: tokenHash,
    token_salt: "salt-123",
    plaintext_token: null,
  });

  assertEquals(canonical.state, "canonical_missing_plaintext");
  assertEquals(canonical.valid, true);
  assertEquals(canonical.canonical_update, undefined);
});

Deno.test("tokens: verifies legacy plaintext rows and returns a canonical backfill payload", async () => {
  const token = "ul_abcdef0123456789abcdef0123456789";
  const verification = await verifyApiTokenRecord(token, {
    token_hash: "legacy-hash-no-longer-used",
    token_salt: null,
    plaintext_token: token,
  });

  assertEquals(verification.state, "legacy_backfillable_from_plaintext");
  assertEquals(verification.valid, true);
  assert(!!verification.canonical_update);
  assertEquals(typeof verification.canonical_update?.token_salt, "string");
  assertEquals(typeof verification.canonical_update?.token_hash, "string");
  assertEquals(verification.canonical_update?.token_salt.length, 32);
  assertEquals(verification.canonical_update?.token_hash.length, 64);
});

Deno.test("tokens: rejects legacy rows when plaintext does not match", async () => {
  const verification = await verifyApiTokenRecord("ul_abcdef0123456789abcdef0123456789", {
    token_hash: "legacy-hash-no-longer-used",
    token_salt: null,
    plaintext_token: "ul_deadbeefdeadbeefdeadbeefdeadbeef",
  });

  assertEquals(verification.state, "legacy_backfillable_from_plaintext");
  assertEquals(verification.valid, false);
  assertEquals(verification.reason, "plaintext_mismatch");
});

Deno.test("tokens: rejects unrecoverable legacy rows without token material", async () => {
  const verification = await verifyApiTokenRecord("ul_abcdef0123456789abcdef0123456789", {
    token_hash: "legacy-hash-no-longer-used",
    token_salt: null,
    plaintext_token: null,
  });

  assertEquals(verification.state, "legacy_unrecoverable");
  assertEquals(verification.valid, false);
  assertEquals(verification.reason, "missing_token_material");
});
