import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";

import {
  appendPageShareSessionCookie,
  buildSharedPageEntryUrl,
  hasValidPageShareSession,
  readPageShareSessionFromRequest,
} from "./page-share-session.ts";

const TEST_ENV = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
};

function withMockedEnv(fn: () => Promise<void>): Promise<void> {
  const globalWithEnv = globalThis as typeof globalThis & {
    __env?: Record<string, unknown>;
  };
  const previousEnv = globalWithEnv.__env;
  globalWithEnv.__env = {
    ...(previousEnv || {}),
    ...TEST_ENV,
  };

  return fn().finally(() => {
    globalWithEnv.__env = previousEnv;
  });
}

Deno.test("page share session: buildSharedPageEntryUrl moves the secret into the fragment", () => {
  assertEquals(
    buildSharedPageEntryUrl({
      ownerUserId: "user-123",
      slug: "launch-notes",
      accessToken: "share-secret",
    }),
    "/share/p/user-123/launch-notes#share_token=share-secret",
  );
});

Deno.test("page share session: cookie sessions validate only for the intended page and token", async () => {
  await withMockedEnv(async () => {
    const headers = new Headers();
    await appendPageShareSessionCookie(headers, {
      contentId: "content-123",
      ownerId: "11111111-1111-4111-8111-111111111111",
      slug: "launch-notes",
      accessToken: "share-secret",
      ttlSeconds: 300,
      nowMs: 1_710_000_000_000,
    });

    const cookieHeader = headers.get("Set-Cookie") || "";
    assertEquals(cookieHeader.includes("__Secure-ul_page_share="), true);
    assertEquals(cookieHeader.includes("Path=/p/11111111-1111-4111-8111-111111111111"), true);

    const request = new Request("https://example.com/p/11111111-1111-4111-8111-111111111111/launch-notes", {
      headers: { cookie: cookieHeader },
    });

    const session = await readPageShareSessionFromRequest(request, 1_710_000_000_000);
    assertEquals(session?.content_id, "content-123");
    assertEquals(session?.slug, "launch-notes");

    assertEquals(await hasValidPageShareSession(request, {
      contentId: "content-123",
      ownerId: "11111111-1111-4111-8111-111111111111",
      slug: "launch-notes",
      accessToken: "share-secret",
    }, 1_710_000_000_000), true);

    assertEquals(await hasValidPageShareSession(request, {
      contentId: "content-123",
      ownerId: "11111111-1111-4111-8111-111111111111",
      slug: "launch-notes",
      accessToken: "rotated-secret",
    }, 1_710_000_000_000), false);

    assertEquals(await hasValidPageShareSession(request, {
      contentId: "content-999",
      ownerId: "11111111-1111-4111-8111-111111111111",
      slug: "launch-notes",
      accessToken: "share-secret",
    }, 1_710_000_000_000), false);
  });
});
