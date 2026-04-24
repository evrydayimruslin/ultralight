# Workers for Platforms (Archived Research)

These files were built for full sandbox code execution inside Cloudflare
Workers and were moved out of the live `worker/` tree during Wave 4 launch
hardening.

They are **not used** in the current launch architecture.

When upgrading to Workers for Platforms ($25/month), these files provide:
- `sandbox.ts` — V8 isolate execution engine with SDK injection
- `stdlib.ts` — Pre-bundled standard library (uuid, lodash, dateFns, etc.)
- `appdata.ts` — Native R2 AppDataService (used inside sandbox)
- `supabase-client.ts` — Lightweight Supabase client for sandbox
- `types.ts` — Type definitions including UnsafeEval binding

The key blocker was that Cloudflare Workers blocks `new Function()` / `eval()` in
production. Workers for Platforms provides `UnsafeEval` binding for dynamic code
execution in user worker isolates.

If this work becomes active again, promote it back into an explicit supported
package/runtime area instead of treating this archive folder as live code.
