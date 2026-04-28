import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  createEmbeddingService,
  isEmbeddingAvailable,
} from "./embedding.ts";

function withEnv(env: Record<string, unknown>, fn: () => void): void {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    ...env,
  };

  try {
    fn();
  } finally {
    globalWithEnv.__env = previousEnv;
  }
}

Deno.test("embedding service ignores OpenRouter management key fallback", () => {
  withEnv({
    OPENROUTER_API_KEY: "or-management-key",
    OPENROUTER_EMBEDDING_KEY: "",
  }, () => {
    assertEquals(createEmbeddingService(), null);
    assertEquals(isEmbeddingAvailable(), false);
  });
});

Deno.test("embedding service uses dedicated embedding key or user key", () => {
  withEnv({
    OPENROUTER_API_KEY: "or-management-key",
    OPENROUTER_EMBEDDING_KEY: "or-embedding-key",
  }, () => {
    assertEquals(createEmbeddingService() !== null, true);
    assertEquals(isEmbeddingAvailable(), true);
  });

  withEnv({
    OPENROUTER_API_KEY: "",
    OPENROUTER_EMBEDDING_KEY: "",
  }, () => {
    assertEquals(createEmbeddingService("or-user-key") !== null, true);
    assertEquals(isEmbeddingAvailable("or-user-key"), true);
  });
});
