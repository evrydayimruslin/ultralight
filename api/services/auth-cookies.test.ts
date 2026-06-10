import { assert } from "https://deno.land/std@0.210.0/assert/assert.ts";
import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import {
  appendAuthSessionCookies,
  clearAuthSessionCookies,
  getAuthAccessTokenFromRequest,
  getAuthRefreshTokenFromRequest,
} from "./auth-cookies.ts";

Deno.test("Auth cookies: appendAuthSessionCookies writes secure HttpOnly session cookies", () => {
  const headers = new Headers();
  appendAuthSessionCookies(headers, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenTtlSeconds: 3600,
  });

  const cookieHeader = headers.get("Set-Cookie") || "";
  const allCookies = headers.getSetCookie ? headers.getSetCookie() : cookieHeader.split("\n");
  assertEquals(allCookies.length, 2);
  assert(allCookies[0].includes("__Host-ul_session=access-token"));
  assert(allCookies[0].includes("HttpOnly"));
  assert(allCookies[0].includes("Secure"));
  assert(allCookies[0].includes("SameSite=Lax"));
  assert(allCookies[0].includes("Max-Age=3600"));
  assert(allCookies[1].includes("__Host-ul_refresh=refresh-token"));
});

Deno.test("Auth cookies: clearAuthSessionCookies expires both browser session cookies", () => {
  const headers = new Headers();
  clearAuthSessionCookies(headers);

  const allCookies = headers.getSetCookie ? headers.getSetCookie() : (headers.get("Set-Cookie") || "").split("\n");
  assertEquals(allCookies.length, 2);
  assert(allCookies[0].includes("Max-Age=0"));
  assert(allCookies[1].includes("Max-Age=0"));
});

Deno.test("Auth cookies: request helpers parse access and refresh cookies", () => {
  const request = new Request("https://ultralight.test/auth/user", {
    headers: {
      cookie: "__Host-ul_session=access-token; __Host-ul_refresh=refresh-token",
    },
  });

  assertEquals(getAuthAccessTokenFromRequest(request), "access-token");
  assertEquals(getAuthRefreshTokenFromRequest(request), "refresh-token");
});
