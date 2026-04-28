// esbuild-wasm loader for Cloudflare Workers
//
// Wrangler's bundler needs to see a *static* import of the .wasm file
// (matching the `[[rules]] type = "CompiledWasm"` in wrangler.toml) to
// bundle it into the Worker. A dynamic import with a variable path
// (`const p = '...'; await import(p)`) is not statically analyzable, so
// wrangler skips the wasm and the import fails at runtime with
// `No such module "esbuild-wasm/esbuild.wasm"`.
//
// This file is ONLY imported by bundler.ts inside the CF Workers branch.
// api/deno.check.json maps the wasm import to a TypeScript stub for Deno-only
// checking, while wrangler sees this real static wasm import for Worker builds.

// @ts-ignore — wrangler bundles .wasm files as WebAssembly.Module
import wasmModule from 'esbuild-wasm/esbuild.wasm';

export default wasmModule;
