// Galactic Interfaces sandbox worker entry. All behavior lives in serve.ts
// (structurally typed, Deno-tested); keep this shim logic-free.

import {
  handleInterfaceRequest,
  type InterfaceWorkerEnv,
} from "./serve.ts";

export default {
  async fetch(request: Request, env: InterfaceWorkerEnv): Promise<Response> {
    return await handleInterfaceRequest(request, env);
  },
};
