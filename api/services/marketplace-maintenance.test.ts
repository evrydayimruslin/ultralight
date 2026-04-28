import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertRejects } from "https://deno.land/std@0.210.0/assert/assert_rejects.ts";

import { expireMarketplaceBids } from "./marketplace-maintenance.ts";

Deno.test("marketplace maintenance: expires old bids through the RPC", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const result = await expireMarketplaceBids({
    supabaseUrl: "https://supabase.test",
    serviceRoleKey: "service-role",
    logger: { info: () => {}, error: () => {} },
    fetchFn: ((url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return Promise.resolve(new Response(JSON.stringify(3), { status: 200 }));
    }) as typeof fetch,
  });

  assertEquals(result.expired_count, 3);
  assertEquals(calls[0].url, "https://supabase.test/rest/v1/rpc/expire_old_bids");
  assertEquals(calls[0].init?.method, "POST");
});

Deno.test("marketplace maintenance: surfaces RPC failures", async () => {
  await assertRejects(
    () =>
      expireMarketplaceBids({
        supabaseUrl: "https://supabase.test",
        serviceRoleKey: "service-role",
        logger: { info: () => {}, error: () => {} },
        fetchFn: (() =>
          Promise.resolve(new Response("boom", { status: 500 }))) as typeof fetch,
      }),
    Error,
    "Failed to expire marketplace bids",
  );
});
