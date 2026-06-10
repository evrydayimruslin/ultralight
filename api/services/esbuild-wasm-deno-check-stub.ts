// Deno check only: api/deno.check.json maps esbuild-wasm/esbuild.wasm here
// so Deno's analyzer does not try to parse the binary wasm asset as source.
const wasmModule = {} as WebAssembly.Module;

export default wasmModule;
