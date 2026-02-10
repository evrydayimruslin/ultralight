// MCP Call Logger Service
// Records MCP tool calls for monitoring and dashboard display

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

export interface McpCallLogEntry {
  userId: string;
  appId?: string;
  appName?: string;
  functionName: string;
  method: string;
  success: boolean;
  durationMs?: number;
  errorMessage?: string;
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
      }),
    }
  );

  if (!response.ok) {
    console.error('MCP call log insert failed:', await response.text());
  }
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
