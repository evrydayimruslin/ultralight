# Legacy Runtime Archive

Last reviewed: `2026-04-21`

This folder contains the retired DigitalOcean + Deno runtime artifacts that
used to live in the active repo root and `api/` tree.

These files are preserved here only as historical reference:

- [api-main.ts](api-main.ts)
- [Dockerfile](Dockerfile)
- [do-app.yaml](do-app.yaml)

They are not part of the canonical launch runtime. The supported production
path is the Cloudflare Worker entrypoint in
[api/src/worker-entry.ts](../../api/src/worker-entry.ts)
plus Wrangler/GitHub Actions deploys.

If you need the exact historical context around how these artifacts were used,
prefer git history and the architecture docs over restoring them into the
active runtime tree.
