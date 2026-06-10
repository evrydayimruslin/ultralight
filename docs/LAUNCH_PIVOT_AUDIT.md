# Launch Pivot Audit — 2026-06-10

Deep audit of the launch surface plus gap analysis and roadmap for five proposed
changes:

- **P1** — Reintroduce BYOK + credit-denominated inference ("Light" name deprecated)
- **P2** — Remove Widgets from launch scope entirely (FE + BE)
- **P3** — Fold first-class Skills into Functions (skills-index + skill-reader convention)
- **P4** — Rename Tools → Agents
- **P5** — Manifest-declared cross-agent function permissions + per-function spend caps

---

## 1. Current Launch Surface (what actually exists)

**Frontend** — `apps/launch-web` (React SPA, Cloudflare Pages project
`ultralight-launch-web`; staging deploys on `main` push, production on `v*` tags via
`.github/workflows/launch-web-deploy.yml`). Nine routes in `src/lib/routes.ts`:
`/`, `/install`, `/library`, `/store` (with `/discover` alias), `/tools/:slug`,
`/wallet`, `/settings`, `/admin/tools/:id`, `/auth/callback`. All pages in one file
(`src/pages/foundation-pages.tsx`, 4,744 lines) with hard-coded fixture fallbacks.

**API** — `api/` is a single Cloudflare Worker (`ultralight-api`, entry
`api/src/worker-entry.ts`). The launch facade `api/handlers/launch.ts` (5,243 lines)
exposes ~28 endpoints under `/api/launch/*`, typed against
`shared/contracts/launch.ts` (the scope-enforcement artifact:
`LAUNCH_INCLUDED_CAPABILITIES` / `LAUNCH_DEFERRED_CAPABILITIES` / route lists).
The facade is read-mostly: