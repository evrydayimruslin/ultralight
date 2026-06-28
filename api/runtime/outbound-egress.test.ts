// Egress policy regression tests for the Dynamic Worker sandbox SSRF guard.
// Locks the destination allow/deny logic that OutboundBinding enforces as the
// loaded isolate's globalOutbound. The binding's fetch() forwarding (sockets to
// the real internet) needs a staging smoke; the POLICY is fully unit-tested here.

import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { evaluateOutbound, guardedFetch } from "../src/bindings/outbound-policy.ts";

function allowed(url: string): boolean {
  return evaluateOutbound(url).allowed;
}

Deno.test("egress: public https + http destinations are allowed", () => {
  for (
    const url of [
      "https://example.com",
      "https://api.github.com/repos/x/y?token=abc",
      "http://example.com/webhook",
      "https://1.1.1.1",
      "https://8.8.8.8/resolve",
      "https://172.32.0.1", // just outside the 172.16/12 private block
      "https://172.15.0.1", // just below it
      "https://[2606:4700:4700::1111]", // public IPv6 (Cloudflare DNS)
    ]
  ) {
    assert(allowed(url), `expected allowed: ${url}`);
  }
});

Deno.test("egress: non-http(s) schemes are blocked", () => {
  for (
    const url of [
      "file:///etc/passwd",
      "data:text/plain;base64,aGk=",
      "ftp://ftp.example.com/x",
      "ws://example.com/socket",
      "blob:https://example.com/uuid",
      "gopher://example.com",
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked scheme: ${url}`);
  }
});

Deno.test("egress: loopback / localhost / internal are blocked", () => {
  for (
    const url of [
      "https://localhost",
      "https://app.localhost/x",
      "https://internal",
      "https://data.internal/admin",
      "https://127.0.0.1",
      "https://127.5.9.3",
      "http://[::1]",
      // trailing-dot rooted FQDNs (WHATWG preserves the dot for DNS names)
      "https://localhost.",
      "https://internal./admin",
      "https://app.localhost.",
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked: ${url}`);
  }
});

Deno.test("egress: RFC1918 / CGNAT / link-local / metadata are blocked", () => {
  for (
    const url of [
      "https://10.0.0.1",
      "https://10.255.255.255",
      "https://192.168.1.1",
      "https://172.16.0.1",
      "https://172.31.255.255",
      "https://100.64.0.1", // CGNAT
      "https://169.254.169.254", // cloud metadata
      "https://169.254.1.1", // link-local
      "https://0.0.0.0",
      "https://0.0.0.1",
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked: ${url}`);
  }
});

Deno.test("egress: integer + hex IPv4 encodings of private addresses are blocked", () => {
  for (
    const url of [
      "https://2130706433", // 127.0.0.1 as a decimal integer
      "https://0x7f000001", // 127.0.0.1 as hex
      "https://0x7f.0.0.1", // mixed hex octet
      "https://017700000001", // octal-ish dotteds normalize via URL parser
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked encoding: ${url}`);
  }
});

Deno.test("egress: IPv6 ULA / link-local / site-local / multicast / mapped-private are blocked", () => {
  for (
    const url of [
      "https://[fc00::1]", // ULA
      "https://[fd12:3456:789a::1]", // ULA
      "https://[fe80::1]", // link-local
      "https://[fec0::1]", // deprecated site-local
      "https://[ff02::1]", // multicast
      "https://[::ffff:127.0.0.1]", // IPv4-mapped loopback (URL normalizes to hex)
      "https://[::ffff:10.0.0.1]", // IPv4-mapped private
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked IPv6: ${url}`);
  }
});

Deno.test("egress: IPv6 transition forms embedding a private IPv4 are blocked", () => {
  for (
    const url of [
      "https://[64:ff9b::7f00:1]", // NAT64 of 127.0.0.1
      "https://[64:ff9b::a00:1]", // NAT64 of 10.0.0.1
      "https://[64:ff9b::a9fe:a9fe]", // NAT64 of 169.254.169.254 (metadata)
      "https://[2002:7f00:1::]", // 6to4 of 127.0.0.1
      "https://[2002:a9fe:a9fe::]", // 6to4 of 169.254.169.254
      "https://[::7f00:1]", // IPv4-compatible 127.0.0.1
      "https://[::a00:1]", // IPv4-compatible 10.0.0.1
      "https://[::ffff:0:7f00:1]", // SIIT/translatable 127.0.0.1
    ]
  ) {
    assertEquals(allowed(url), false, `expected blocked IPv6 transition: ${url}`);
  }
});

Deno.test("egress: global IPv6 is still allowed", () => {
  for (
    const url of [
      "https://[2606:4700:4700::1111]", // Cloudflare DNS
      "https://[2001:4860:4860::8888]", // Google DNS
    ]
  ) {
    assert(allowed(url), `expected allowed IPv6: ${url}`);
  }
});

Deno.test("egress: malformed URLs are blocked", () => {
  for (const url of ["not a url", "", "https://", "://nohost"]) {
    assertEquals(allowed(url), false, `expected blocked malformed: ${url}`);
  }
});

// ── guardedFetch: per-hop redirect policy enforcement ──

function redirectTo(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

Deno.test("guardedFetch: allowed direct request is forwarded", async () => {
  let calls = 0;
  const resp = await guardedFetch(
    new Request("https://api.example.com/data"),
    () => {
      calls++;
      return Promise.resolve(new Response("ok", { status: 200 }));
    },
  );
  assertEquals(resp.status, 200);
  assertEquals(await resp.text(), "ok");
  assertEquals(calls, 1);
});

Deno.test("guardedFetch: a redirect to a private/metadata target is blocked at the next hop", async () => {
  let calls = 0;
  const resp = await guardedFetch(
    new Request("https://api.example.com/start"),
    (req) => {
      calls++;
      // First (allowed) hop 302s to the cloud metadata endpoint.
      if (req.url === "https://api.example.com/start") {
        return Promise.resolve(redirectTo("http://169.254.169.254/latest/meta-data/"));
      }
      return Promise.resolve(new Response("SHOULD NOT REACH", { status: 200 }));
    },
  );
  assertEquals(resp.status, 403);
  assertEquals((await resp.json()).error, "egress_blocked");
  assertEquals(calls, 1, "the blocked redirect target must never be fetched");
});

Deno.test("guardedFetch: an allowed redirect chain is followed transparently", async () => {
  const seen: string[] = [];
  const resp = await guardedFetch(
    new Request("https://a.example.com/1"),
    (req) => {
      seen.push(req.url);
      if (req.url === "https://a.example.com/1") {
        return Promise.resolve(redirectTo("https://b.example.com/2"));
      }
      if (req.url === "https://b.example.com/2") {
        return Promise.resolve(new Response("final", { status: 200 }));
      }
      return Promise.resolve(new Response("unexpected", { status: 500 }));
    },
  );
  assertEquals(resp.status, 200);
  assertEquals(await resp.text(), "final");
  assertEquals(seen, ["https://a.example.com/1", "https://b.example.com/2"]);
});

Deno.test("guardedFetch: 307 redirect to a private host is blocked", async () => {
  const resp = await guardedFetch(
    new Request("https://api.example.com/start"),
    (req) =>
      req.url === "https://api.example.com/start"
        ? Promise.resolve(redirectTo("https://10.0.0.5/internal", 307))
        : Promise.resolve(new Response("SHOULD NOT REACH", { status: 200 })),
  );
  assertEquals(resp.status, 403);
});

Deno.test("guardedFetch: redirect loops terminate at the hop cap", async () => {
  let calls = 0;
  const resp = await guardedFetch(
    new Request("https://loop.example.com/x"),
    () => {
      calls++;
      return Promise.resolve(redirectTo("https://loop.example.com/x"));
    },
    { maxRedirects: 3 },
  );
  // Stops following at the cap and returns the last 3xx rather than looping.
  assert(resp.status >= 300 && resp.status < 400);
  assertEquals(calls, 4, "should fetch initial + maxRedirects hops then stop");
});
