// MCP Call Logger Service
// Records MCP tool calls with full I/O telemetry for monitoring,
// dashboard display, and structured training data export.

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

/** Maximum size for input_args and output_result JSONB (bytes). */
const MAX_IO_SIZE = 10_000;

export interface McpCallLogEntry {
  userId: string;
  appId?: string;
  appName?: string;
  functionName: string;
  method: string;
  success: boolean;
  durationMs?: number;
  errorMessage?: string;
  source?: 'direct' | 'appstore' | 'library' | 'desk';
  // Rich telemetry fields
  inputArgs?: Record<string, unknown>;
  outputResult?: unknown;
  userTier?: string;
  appVersion?: string;
  aiCostCents?: number;
  sessionId?: string;
  sequenceNumber?: number;
  userQuery?: string;
}

/**
 * Truncate a value to fit within MAX_IO_SIZE when JSON-stringified.
 * Returns the value as-is if small enough, or a truncated placeholder.
 */
function truncateForStorage(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  try {
    const json = JSON.stringify(value);
    if (json.length <= MAX_IO_SIZE) return value;
    // Too large — store a summary
    return {
      _truncated: true,
      _original_size: json.length,
      _preview: json.slice(0, 500),
    };
  } catch {
    return { _error: 'Could not serialize value' };
  }
}

/**
 * Log an MCP call. Fire-and-forget — errors are silently caught.
 */
export function logMcpCall(entry: McpCallLogEntry): void {
  // Fire and forget — don't await
  _insertLog(entry).catch((err) => {
    console.error('Failed to log MCP call:', err);
  });
}

async function _insertLog(entry: McpCallLogEntry): Promise<void> {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/mcp_call_logs`,
    {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_id: entry.userId,
        app_id: entry.appId || null,
        app_name: entry.appName || null,
        function_name: entry.functionName,
        method: entry.method,
        success: entry.success,
        duration_ms: entry.durationMs || null,
        error_message: entry.errorMessage || null,
        source: entry.source || 'direct',
        // Rich telemetry
        input_args: truncateForStorage(entry.inputArgs),
        output_result: truncateForStorage(entry.outputResult),
        user_tier: entry.userTier || null,
        app_version: entry.appVersion || null,
        ai_cost_cents: entry.aiCostCents || 0,
        session_id: entry.sessionId || null,
        sequence_number: entry.sequenceNumber ?? null,
        user_query: entry.userQuery || null,
      }),
    }
  );

  if (!response.ok) {
    console.error('MCP call log insert failed:', await response.text());
  }
}

/**
 * Extract _user_query and _session_id from tool call arguments.
 * Returns the clean args (without meta fields) and the extracted meta.
 * Agents pass these as extra fields alongside real tool arguments.
 */
export function extractCallMeta(args: Record<string, unknown>): {
  cleanArgs: Record<string, unknown>;
  userQuery?: string;
  sessionId?: string;
} {
  const { _user_query, _session_id, ...cleanArgs } = args;
  return {
    cleanArgs,
    userQuery: typeof _user_query === 'string' ? _user_query : undefined,
    sessionId: typeof _session_id === 'string' ? _session_id : undefined,
  };
}

/**
 * Get recent MCP call logs for a user.
 */
export async function getRecentCalls(
  userId: string,
  options: { limit?: number; since?: string; appId?: string } = {}
): Promise<Array<{
  id: string;
  app_id: string | null;
  app_name: string | null;
  function_name: string;
  method: string;
  success: boolean;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}>> {
  const limit = options.limit || 50;
  let url = `${SUPABASE_URL}/rest/v1/mcp_call_logs?user_id=eq.${userId}&order=created_at.desc&limit=${limit}&select=id,app_id,app_name,function_name,method,success,duration_ms,error_message,created_at`;

  if (options.since) {
    url += `&created_at=gt.${options.since}`;
  }

  if (options.appId) {
    url += `&app_id=eq.${options.appId}`;
  }

  const response = await fetch(url, {
    headers: {
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get call logs: ${await response.text()}`);
  }

  return response.json();
}
