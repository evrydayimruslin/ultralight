// Codemode Executor — runs agent-written JavaScript recipes in a sandboxed
// AsyncFunction with typed tool functions bound as the `codemode` namespace.
//
// Implements the Executor interface pattern from @cloudflare/codemode
// but runs in Deno's runtime instead of CF Dynamic Workers.

export interface ExecuteResult {
  result: unknown;
  error?: string;
  logs: string[];
}

/**
 * Execute a JavaScript recipe with tool functions bound as `codemode.*`.
 *
 * The code is an async function body that can use:
 *   - await codemode.functionName(args) — calls tool functions
 *   - console.log/warn/error — captured in logs
 *   - return value — becomes the result
 *
 * @param code - JavaScript async function body (no wrapper needed)
 * @param fns - Tool functions keyed by sanitized name
 * @param timeoutMs - Execution timeout (default 60s)
 */
export async function executeCodeMode(
  code: string,
  fns: Record<string, (...args: unknown[]) => Promise<unknown>>,
  timeoutMs = 60_000,
): Promise<ExecuteResult> {
  const logs: string[] = [];

  // Captured console
  const sandboxConsole = {
    log: (...args: unknown[]) => {
      logs.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    },
    warn: (...args: unknown[]) => {
      logs.push('[warn] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    },
    error: (...args: unknown[]) => {
      logs.push('[error] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' '));
    },
  };

  // Strip markdown code fences if present
  let cleanCode = code.trim();
  const fenceMatch = cleanCode.match(/^```(?:js|javascript|typescript|ts)?\s*\n?([\s\S]*?)```\s*$/);
  if (fenceMatch) {
    cleanCode = fenceMatch[1].trim();
  }

  // Build the codemode namespace from tool functions
  const codemode = { ...fns };

  try {
    // @ts-ignore: AsyncFunction constructor
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const recipeFn = new AsyncFunction('codemode', 'console', cleanCode);

    // Execute with timeout
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new Error(`Recipe execution timed out after ${timeoutMs / 1000}s`)),
        timeoutMs,
      );
    });

    const result = await Promise.race([
      recipeFn(codemode, sandboxConsole),
      timeoutPromise,
    ]);
    clearTimeout(timeoutId!);

    return { result, logs };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { result: undefined, error: errMsg, logs };
  }
}
