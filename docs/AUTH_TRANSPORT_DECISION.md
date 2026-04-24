# Auth Transport Decision

This document defines the canonical auth transport model for Wave 1.

The repo historically mixed four patterns:

- bearer tokens in desktop API headers
- browser session cookies
- `?token=` or `#token=` URL handoff
- legacy browser localStorage token migration

Wave 1 standardized those paths so each surface has one primary model and every
compatibility bridge has a removal path. The browser localStorage bridge was
subsequently removed in Wave 4, and the remaining desktop secure-storage import
is now fenced by a one-time migration marker instead of an unbounded fallback.

## Decision Summary

| Surface | Canonical transport | Allowed compatibility bridge | Explicitly disallowed |
| --- | --- | --- | --- |
| Browser web shell | HttpOnly cookies | None | Long-lived auth in query params, long-lived auth in localStorage |
| Desktop API calls | `Authorization: Bearer ...` from secure storage | None | Query-string bearer auth |
| Desktop embedded web panels | Short-lived signed bridge token exchanged into a first-party session context | None | Long-lived user/API tokens in iframe URLs |
| MCP and HTTP app endpoints | `Authorization: Bearer ...` | Temporary generic-dashboard tab/session bridge while browser UX converges | Query-string bearer auth |
| Shared/public content links | Fragment bootstrap to a page-scoped HttpOnly share session | Existing shared-page token rotation / recipient-share rules | User bearer tokens or personal API tokens in public URLs |

## Surface Decisions

### Browser Web Shell

- Primary auth is a server-managed session expressed as HttpOnly cookies.
- Browser JavaScript may keep a sentinel like `__cookie_session__` to decide how
  to call same-origin APIs, but that sentinel is not a credential.
- The temporary JWT/localStorage browser migration has now been removed. New web
  code should not read browser auth state from long-lived localStorage keys.

### Desktop API Client

- The desktop app keeps its sign-in token in secure OS storage and sends it in
  the `Authorization` header on direct API calls.
- This remains the only canonical transport for desktop-originated JSON/API
  traffic.
- A one-time localStorage-to-secure-storage migration marker now fences the last
  legacy desktop import path until the minimum supported desktop version lets us
  delete it entirely.

### Desktop Embedded Web Panels

- Embedded pages must not receive long-lived credentials in the URL.
- The target model is:
  1. desktop makes an authenticated API call
  2. server returns a short-lived signed bridge token from `POST /auth/embed/bridge`
  3. the iframe loads the target page with the token in the fragment, not the
     query string
  4. the embedded page exchanges the bridge token through `POST /auth/embed/exchange`
     for a first-party session context and then strips the fragment from the URL
- If iframe cookie behavior proves unreliable in Tauri WebViews, the fallback is
  still a short-lived scoped bridge token, not the current user bearer token.

### MCP And HTTP App Endpoints

- Programmatic clients authenticate with the `Authorization` header.
- Copied endpoint URLs must be bare URLs without embedded bearer credentials.
- If a no-config handoff is still required for a product flow, it must use a
  scoped short-lived bridge token with TTL and explicit audience, not a user
  bearer token.

### Shared Public Content Links

- Page-share links are a separate sharing model, not a bearer-auth transport.
- The current model is:
  1. generate `/share/p/:userId/:slug#share_token=...`
  2. exchange that fragment secret through `POST /auth/page-share/exchange`
  3. mint a page-scoped HttpOnly cookie
  4. redirect to `/p/:userId/:slug` without leaving the share secret in the
     request URL
- Shared-page links should never reuse the user’s personal API token or
  desktop/browser bearer token.
- Future tightening can improve recipient binding, expiry, and rotation
  semantics without reintroducing request-URL token transport.

## Migration Rules

- No new product path may introduce `?token=` bearer auth.
- No copied URL may contain a personal API token or browser session token.
- Compatibility bridges must emit telemetry before removal.
- Removal order:
  1. instrument current bridges
  2. ship bridge replacement
  3. migrate desktop/web clients
  4. remove server fallback acceptance

## First Wave 1 Implementation Sequence

1. Add transport telemetry and record every legacy query/body bootstrap path.
2. Ship the desktop embed bridge primitive.
3. Move desktop `WebPanel` and web embed flows onto the bridge.
4. Remove tokenized MCP/HTTP copy URLs and query-token fallback handling.
5. Remove browser localStorage/hash/query migration paths once usage drops.
   This is now complete for the browser shells.
