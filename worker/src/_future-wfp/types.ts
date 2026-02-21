// Worker Types
// Shared types for the Cloudflare Worker sandbox

export interface UnsafeEval {
  eval(script: string, name?: string): unknown;
  newFunction(script: string, name?: string, ...args: string[]): Function;
  newAsyncFunction(script: string, name?: string, ...args: string[]): Function;
}

export interface Env {
  R2_BUCKET: R2Bucket;
  CODE_CACHE: KVNamespace;
  UNSAFE_EVAL: UnsafeEval;
  WORKER_SECRET: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_KEY: string;
  SUPABASE_ANON_KEY: string;
  ENVIRONMENT: string;
}

export interface ExecuteRequest {
  appId: string;
  userId: string;
  functionName: string;
  args: unknown[];
  code: string;
  storageKey: string;
  permissions: string[];
  userApiKey: string | null;
  user: UserContext | null;
  envVars: Record<string, string>;
  supabase?: {
    url: string;
    anonKey: string;
    serviceKey?: string;
  };
  baseUrl?: string;
  authToken?: string;
}

export interface UserContext {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: string;
}

export interface ExecutionResult {
  success: boolean;
  result: unknown;
  logs: LogEntry[];
  durationMs: number;
  aiCostCents: number;
  error?: {
    type: string;
    message: string;
  };
}

export interface LogEntry {
  time: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
}

export interface QueryOptions {
  filter?: (value: unknown) => boolean;
  sort?: { field: string; order: 'asc' | 'desc' };
  limit?: number;
  offset?: number;
}

export interface QueryResult {
  key: string;
  value: unknown;
  updatedAt?: string;
}

export interface AppDataService {
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
  query(prefix: string, options?: QueryOptions): Promise<QueryResult[]>;
  batchStore(items: Array<{ key: string; value: unknown }>): Promise<void>;
  batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>>;
  batchRemove(keys: string[]): Promise<void>;
}

export interface AIRequest {
  model?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  temperature?: number;
  max_tokens?: number;
  tools?: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }>;
}

export interface AIResponse {
  content: string;
  model: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_cents: number;
  };
}
