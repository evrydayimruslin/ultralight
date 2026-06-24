# Launch Web — Implementation Handoff

This package hands off the **Launch Web** surface — the public, agent‑facing web
product for Galactic’s MCP‑tool marketplace — to a coding agent (Claude Code)
running in `evrydayimruslin/ultralight`, with one human reviewer.

## What’s in here

| Path | Purpose |
|------|---------|
| `BACKEND-DEFICITS.md` | **Read this first.** Per‑screen FE → BE map against `ultralight@main`, marked 🟢 Wired / 🟡 Exists‑elsewhere / 🔴 Build, plus the short genuine‑deficit list. |
| `mockups/` | The complete design canvas. Open `mockups/Launch Web Mockups.html` — every page × state (desktop + mobile) on a pan/zoom canvas; each section carries a **Spec card** naming the backend contract. Read‑only reference. |

## The headline

Unlike a greenfield build, **most of this surface is already backed.** `ultralight`
ships a curated `/api/launch/*` read facade (`api/handlers/launch.ts`, tested, with a
generated OpenAPI doc), the MCP runtime that powers tool calls, a Light wallet +
ledger, widgets with sandboxed render, trust cards, semantic discover, both
leaderboards, and API keys. **Tools are the `apps` table.** After reading the
mutation handlers (`apps.ts`, `user.ts`), the writes are confirmed too — install
(`/api/apps/:appId/save`), owner edits (`PATCH /api/apps/:appId`, incl.
**per‑function pricing** via `pricing_config.functions`), secrets (`/env`,
`user_app_secrets`), and the full wallet (deposit‑vs‑earned split, Apple/Google
Pay + ACH funding, Connect withdrawal, earnings→balance conversion). So the job
is overwhelmingly **wiring the FE to existing endpoints**, leaving a short list:

1. 🔴 Per‑function **agent permissions** (always / ask / never) + Profile defaults — *the only net‑new model.*
2. 🟡 A **Functions‑tab Run** web endpoint (thin wrapper over the existing MCP call path — confirm).
3. 🟡 **Wallet inline detail** — `?cursor=` ledger pagination + `?tool=` earnings filter.
4. 🟡 **Verify top‑up fee math** (2.9 %+$0.30 / ACH 0.8 % cap $5) in the Stripe funding service.
5. 🟡 **Fee‑credit leaderboard** wiring (exists at `/api/marketplace/fee-waiver-leaderboard`).

## How to use the canvas

1. Open `mockups/Launch Web Mockups.html`.
2. Each `DCSection` is one page (Home, Sign in, Library, Owner admin, Store,
   Public tool page, Wallet, Profile). The first artboard in each is a **Spec
   card** — the intended routes + the data the screen represents.
3. Cross‑reference each section against the matching numbered section in
   `BACKEND-DEFICITS.md` for the wired / reshape / build verdict.

## Hard rules for the porting agent

1. **Two things still need an in‑repo eyeball** (everything else is confirmed):
   the **exact top‑up fee math** in `services/stripe-wallet-funding.ts` /
   `stripe-wire-funding.ts` / `billing-config.ts`, and whether the **Functions‑tab
   Run** web entry point already exists over `run.ts`/`platform-mcp.ts`. See
   `BACKEND-DEFICITS.md` “Caveats.”
2. **Don’t rebuild what exists.** The facade, MCP runtime, wallet (funding +
   withdrawal + earnings→balance conversion), per‑function pricing, install/uninstall,
   owner edits, secrets, widget render, trust card, discover, leaderboards, and API
   keys are all live — consume them.
3. **Tools = `apps`.** Don’t introduce a parallel tool entity.
4. **Treat `mockups/` as read‑only** visual reference, not importable source.
5. **Build order:** wire the 🟢 surfaces first (almost everything), then the one
   🔴 net‑new item — per‑function agent permissions — and the 🟡 thin extends.

---

*Generated against `ultralight@a51eefc` (main), June 6, 2026. Supersedes an earlier
draft that reviewed the wrong repo (`ultralight-mvp`).*
