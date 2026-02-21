# Workers for Platforms (Future)

These files were built for full sandbox code execution inside Cloudflare Workers.
They are **not used** in the current Option C architecture (data-layer only).

When upgrading to Workers for Platforms ($25/month), these files provide:
- `sandbox.ts` — V8 isolate execution engine with SDK injection
- `stdlib.ts` — Pre-bundled standard library (uuid, lodash, dateFns, etc.)
- `appdata.ts` — Native R2 AppDataService (used inside sandbox)
- `supabase-client.ts` — Lightweight Supabase client for sandbox
- `types.ts` — Type definitions including UnsafeEval binding

The key blocker was that Cloudflare Workers blocks `new Function()` / `eval()` in
production. Workers for Platforms provides `UnsafeEval` binding for dynamic code
execution in user worker isolates.
