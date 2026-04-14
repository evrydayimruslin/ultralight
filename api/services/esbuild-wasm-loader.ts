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
// The CLI (Deno) never loads this file — it stays outside the CLI's
// transitive import graph, so Deno's static analyzer doesn't try to
// resolve `esbuild-wasm/esbuild.wasm` during `deno task cli`.

// @ts-ignore — wrangler bundles .wasm files as WebAssembly.Module
import wasmModule from 'esbuild-wasm/esbuild.wasm';

export default wasmModule;
