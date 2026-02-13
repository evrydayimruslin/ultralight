// Ultralight Shared Types
// Used across API, Web, and Runtime

// ============================================
// USER & AUTH
// ============================================

// Supported BYOK providers
export type BYOKProvider = 'openrouter' | 'openai' | 'anthropic' | 'deepseek' | 'moonshot';

// BYOK configuration for a single provider
export interface BYOKConfig {
  provider: BYOKProvider;
  has_key: boolean; // Never expose actual key to frontend
  model?: string; // Default model for this provider
  added_at: string;
}

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: Tier;
  tier_expires_at: string | null;
  ai_credit_balance: number; // cents
  ai_credit_resets_at: string | null;
  byok_enabled: boolean;
  byok_provider: BYOKProvider | null; // Primary provider
  byok_configs: BYOKConfig[]; // All configured providers (keys stored encrypted separately)
  root_memory: RootMemory;
  preferences: UserPreferences;
  created_at: string;
  updated_at: string;
}

export interface RootMemory {
  profile: {
    name?: string;
    email?: string;
    timezone?: string;
    [key: string]: unknown;
  };
  preferences: {
    ai_model: string;
    memory_mode: 'unified' | 'siloed';
    timezone: string;
    [key: string]: unknown;
  };
  auth: Record<string, { access_token: string; expires: number }>;
  contacts: Array<{ name: string; email?: string; phone?: string }>;
}

export interface UserPreferences {
  email_notifications: boolean;
  public_profile: boolean;
  [key: string]: unknown;
}

// ============================================
// APPS
// ============================================

export interface VersionMetadata {
  version: string;
  size_bytes: number;
  created_at: string;
}

export interface App {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  visibility: 'private' | 'unlisted' | 'public';
  download_access: 'owner' | 'public';
  current_version: string;
  versions: string[];
  version_metadata: VersionMetadata[];
  storage_key: string;
  storage_bytes: number;
  skills_md: string | null;
  skills_parsed: ParsedSkills | null;
  exports: string[];
  declared_permissions: PermissionDeclaration[];
  last_build_at: string | null;
  last_build_success: boolean | null;
  last_build_logs: BuildLogEntry[];
  last_build_error: string | null;
  total_runs: number;
  total_unique_users: number;
  runs_7d: number;
  runs_30d: number;
  // Like counters (denormalized, kept in sync by DB trigger)
  likes: number;
  dislikes: number;
  // Weighted counters (paid-tier likes only, used for search ranking)
  weighted_likes: number;
  weighted_dislikes: number;
  category: string | null;
  tags: string[];
  // Environment variables (encrypted, keys only exposed to owner)
  env_vars: Record<string, string>;
  // Per-user env var schema: declares which keys are per_user with descriptions
  // Format: { "KEY_NAME": { scope: "per_user", description: "...", required: true } }
  env_schema: Record<string, EnvSchemaEntry>;
  // HTTP endpoint settings
  http_rate_limit: number;
  http_enabled: boolean;
  // Supabase integration (BYOS - Bring Your Own Supabase)
  supabase_url: string | null;
  supabase_anon_key_encrypted: string | null;
  supabase_service_key_encrypted: string | null;
  supabase_enabled: boolean;
  // Manifest-based configuration (v2 architecture)
  manifest: string | null;  // JSON stringified AppManifest
  app_type: 'mcp' | null;  // null means legacy auto-detect; ui/hybrid removed
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface ParsedSkills {
  functions: SkillFunction[];
  permissions: PermissionDeclaration[];
  description?: string;
}

export interface SkillFunction {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns: unknown;
  examples?: string[];
}

export interface PermissionDeclaration {
  permission: string; // "memory:read", "ai:call", "net:api.openai.com"
  required: boolean;
  description?: string;
}

export interface BuildLogEntry {
  time: string;
  level: 'info' | 'warn' | 'error' | 'success';
  message: string;
}

// ============================================
// ENVIRONMENT VARIABLES
// ============================================

export interface EnvVarLimits {
  max_vars_per_app: number;
  max_key_length: number;
  max_value_length: number;
  reserved_prefixes: string[];
}

// Per-user env var schema entry (declared by app owner)
export interface EnvSchemaEntry {
  scope: 'universal' | 'per_user';
  description?: string;
  required?: boolean;
}

export const ENV_VAR_LIMITS: EnvVarLimits = {
  max_vars_per_app: 50,
  max_key_length: 64,
  max_value_length: 4096,
  reserved_prefixes: ['ULTRALIGHT'],
};

/**
 * Validate an environment variable key
 */
export function validateEnvVarKey(key: string): { valid: boolean; error?: string } {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'Key is required' };
  }

  if (key.length > ENV_VAR_LIMITS.max_key_length) {
    return { valid: false, error: `Key must be ${ENV_VAR_LIMITS.max_key_length} characters or less` };
  }

  // Check reserved prefixes
  for (const prefix of ENV_VAR_LIMITS.reserved_prefixes) {
    if (key.toUpperCase().startsWith(prefix)) {
      return { valid: false, error: `Keys starting with "${prefix}" are reserved` };
    }
  }

  // Must be valid env var format (uppercase, underscores, numbers)
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    return { valid: false, error: 'Key must be uppercase letters, numbers, and underscores, starting with a letter' };
  }

  return { valid: true };
}

/**
 * Validate an environment variable value
 */
export function validateEnvVarValue(value: string): { valid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Value must be a string' };
  }

  if (value.length > ENV_VAR_LIMITS.max_value_length) {
    return { valid: false, error: `Value must be ${ENV_VAR_LIMITS.max_value_length} characters or less` };
  }

  return { valid: true };
}

// ============================================
// MEMORY
// ============================================

export interface MemoryEntry {
  id: string;
  user_id: string;
  scope: string; // "user" or "app:{app_id}"
  key: string;
  value: unknown;
  value_type: string;
  created_by_app: string | null;
  updated_by_app: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// EXECUTION
// ============================================

export interface Execution {
  id: string;
  app_id: string;
  user_id: string;
  function_name: string;
  arguments: unknown;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  ai_provider: 'platform' | 'byok' | null;
  ai_model: string | null;
  ai_tokens_input: number | null;
  ai_tokens_output: number | null;
  ai_cost_cents: number | null;
  success: boolean;
  result: unknown;
  error_type: string | null;
  error_message: string | null;
  error_stack: string | null;
  logs: LogEntry[];
  permissions_checked: string[];
}

export interface LogEntry {
  time: string;
  level: 'log' | 'error' | 'warn' | 'info';
  message: string;
}

// ============================================
// SDK
// ============================================

export interface SDKContext {
  userId: string;
  appId: string;
  executionId: string;
  permissions: string[];
  aiBudgetRemaining: number | null; // cents, null if unlimited (BYOK)
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

// ============================================
// API REQUESTS/RESPONSES
// ============================================

export interface UploadRequest {
  files: Array<{
    name: string;
    content: string;
    size: number;
  }>;
}

export interface UploadResponse {
  app_id: string;
  slug: string;
  version: string;
  url: string;
  exports: string[];
  build_success: boolean;
  build_logs: BuildLogEntry[];
}

export interface RunRequest {
  function: string;
  args?: unknown[];
}

export interface RunResponse {
  success: boolean;
  result: unknown;
  logs: LogEntry[];
  duration_ms: number;
  ai_usage?: {
    model: string;
    input_tokens: number;
    output_tokens: number;
  };
  error?: {
    type: string;
    message: string;
    stack?: string;
  };
}

// ============================================
// PERMISSIONS
// ============================================

export interface AppPermission {
  id: string;
  user_id: string;
  app_id: string;
  permission: string;
  granted_at: string;
  expires_at: string | null;
  duration: 'perpetual' | 'session' | '1h' | '24h' | '7d';
  budget_limit: number | null;
  budget_used: number;
  last_used_at: string | null;
}

// ============================================
// TIER LIMITS
// ============================================
// Two tiers: Free (generous silent limits) and Pro ($48/mo, unlimited publishing).
// Legacy tiers (fun/scale/enterprise) alias to free/pro for backward compatibility.

export type Tier = 'free' | 'fun' | 'pro' | 'scale' | 'enterprise';

const FREE_LIMITS = {
  max_apps: 50,
  weekly_call_limit: 500_000,
  overage_cost_per_100k_cents: 0,       // Hard cap — silent
  can_publish: false,
  price_cents_monthly: 0,
  daily_ai_credit_cents: 20,
  monthly_ai_credit_cents: 600,
  max_file_size_mb: 10,
  max_files_per_app: 50,
  max_storage_bytes: 1_073_741_824,     // 1 GB
  execution_timeout_ms: 30_000,         // 30s
  log_retention_days: 30,
  allowed_visibility: ['private', 'unlisted'] as const,
} as const;

const PRO_LIMITS = {
  max_apps: Infinity,
  weekly_call_limit: 10_000_000,
  overage_cost_per_100k_cents: 150,     // $1.50/100k
  can_publish: true,
  price_cents_monthly: 4_800,           // $48/mo
  daily_ai_credit_cents: 200,
  monthly_ai_credit_cents: 6_000,
  max_file_size_mb: 10,
  max_files_per_app: 50,
  max_storage_bytes: 107_374_182_400,   // 100 GB
  execution_timeout_ms: 120_000,        // 2min
  log_retention_days: 90,
  allowed_visibility: ['private', 'unlisted', 'public'] as const,
} as const;

export const TIER_LIMITS = {
  free: FREE_LIMITS,
  fun: FREE_LIMITS,                     // Legacy alias → free
  pro: PRO_LIMITS,
  scale: PRO_LIMITS,                    // Legacy alias → pro
  enterprise: PRO_LIMITS,              // Legacy alias → pro
} as const;

/** Returns true if the tier has Pro-level access (pro, scale, enterprise). */
export function isProTier(tier: Tier | string): boolean {
  return tier === 'pro' || tier === 'scale' || tier === 'enterprise';
}

// ============================================
// ALLOWED FILE TYPES
// ============================================

export const ALLOWED_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.jsonc',
  '.css', '.scss', '.less',
  '.html', '.htm', '.xml', '.svg',
  '.md', '.mdx', '.txt', '.csv',
  '.sql',
  '.yaml', '.yml', '.toml', '.ini', '.conf',
  '.env', '.env.example', '.env.local',
  '.sh', '.bash',
  '.py', '.rb', '.go', '.rs', '.java', '.kt',
  '.c', '.cpp', '.h', '.hpp',
  '.wasm',
  '.graphql', '.gql',
  '.prisma',
  '.lock', '.gitignore', '.dockerignore',
  '.dockerfile', '.editorconfig',
] as const;
export const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
export const MAX_FILES_PER_UPLOAD = 50;

// ============================================
// CRON JOBS
// ============================================

export interface CronJob {
  id: string;
  appId: string;
  name: string;
  schedule: string;
  handler: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunResult: 'success' | 'error' | null;
  lastRunError: string | null;
  lastRunDurationMs: number | null;
  runCount: number;
  errorCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CronRunLog {
  jobId: string;
  appId: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  success: boolean;
  error: string | null;
  result: unknown;
}

// Common cron expression presets
export const CRON_PRESETS = {
  EVERY_MINUTE: '* * * * *',
  EVERY_5_MINUTES: '*/5 * * * *',
  EVERY_15_MINUTES: '*/15 * * * *',
  EVERY_30_MINUTES: '*/30 * * * *',
  EVERY_HOUR: '0 * * * *',
  EVERY_6_HOURS: '0 */6 * * *',
  EVERY_12_HOURS: '0 */12 * * *',
  DAILY_MIDNIGHT: '0 0 * * *',
  DAILY_9AM: '0 9 * * *',
  DAILY_6PM: '0 18 * * *',
  WEEKLY_SUNDAY: '0 0 * * 0',
  WEEKLY_MONDAY: '0 0 * * 1',
  MONTHLY_FIRST: '0 0 1 * *',
} as const;

// ============================================
// USER CONTEXT (exposed to apps)
// ============================================

export interface UserContext {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  tier: Tier;
}

// ============================================
// QUERY HELPERS
// ============================================

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

// ============================================
// SDK INTERFACE (for TypeScript apps)
// ============================================

export interface UltralightSDK {
  // User context
  user: UserContext | null;
  isAuthenticated(): boolean;
  requireAuth(): UserContext;

  // Data storage (basic)
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;

  // Data storage (query helpers)
  query(prefix: string, options?: QueryOptions): Promise<QueryResult[]>;
  batchStore(items: Array<{ key: string; value: unknown }>): Promise<void>;
  batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>>;
  batchRemove(keys: string[]): Promise<void>;

  // User memory (cross-app)
  remember(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<unknown>;

  // AI
  ai(request: AIRequest): Promise<AIResponse>;

  // Cron
  cron: {
    register(name: string, schedule: string, handler: string): Promise<CronJob>;
    unregister(name: string): Promise<void>;
    update(name: string, updates: Partial<{ schedule: string; handler: string; enabled: boolean }>): Promise<CronJob>;
    list(): Promise<CronJob[]>;
    validate(expression: string): boolean;
    describe(expression: string): string;
    presets: typeof CRON_PRESETS;
  };
}

// ============================================
// DOCUMENTATION GENERATION
// ============================================

export interface GenerationConfig {
  ai_enhance: boolean;
}

export interface GenerationResult {
  success: boolean;
  partial: boolean;
  skills_md: string | null;
  skills_parsed: ParsedSkills | null;
  embedding_text: string | null;
  embedding_generated?: boolean;
  errors: GenerationError[];
  warnings: string[];
}

export interface GenerationError {
  phase: 'parse' | 'generate_skills' | 'validate' | 'embed';
  message: string;
  line?: number;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  skills_parsed: ParsedSkills | null;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  line?: number;
  message: string;
  suggestion?: string;
}

// ============================================
// DRAFT/PUBLISH SYSTEM
// ============================================

export interface AppDraft {
  storage_key: string;
  version: string;
  uploaded_at: string;
  exports: string[];
}

// Extended App interface with draft fields
export interface AppWithDraft extends App {
  draft_storage_key: string | null;
  draft_version: string | null;
  draft_uploaded_at: string | null;
  draft_exports: string[] | null;
  docs_generated_at: string | null;
  generation_in_progress: boolean;
  generation_config: GenerationConfig;
  // pgvector embedding stored as array (for reference, actual storage is vector type)
  skills_embedding?: number[] | null;
}

// ============================================
// MCP (Model Context Protocol)
// ============================================

export interface MCPTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: MCPJsonSchema;
  outputSchema?: MCPJsonSchema;
}

export interface MCPJsonSchema {
  type?: string;
  properties?: Record<string, MCPJsonSchema>;
  items?: MCPJsonSchema;
  required?: string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  additionalProperties?: boolean | MCPJsonSchema;
  $ref?: string;
  oneOf?: MCPJsonSchema[];
  allOf?: MCPJsonSchema[];
  nullable?: boolean;
  format?: string;
  [key: string]: unknown;
}

export interface MCPToolsListResponse {
  tools: MCPTool[];
  nextCursor?: string;
}

export interface MCPToolCallRequest {
  name: string;
  arguments: Record<string, unknown>;
}

export interface MCPToolCallResponse {
  content: MCPContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

export interface MCPContent {
  type: 'text' | 'image' | 'audio' | 'resource' | 'resource_link';
  text?: string;
  data?: string;
  mimeType?: string;
  uri?: string;
  resource?: MCPResource;
}

export interface MCPResource {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
}

export interface MCPServerInfo {
  name: string;
  version: string;
  description?: string;
  capabilities: {
    tools?: { listChanged?: boolean };
  };
  endpoints?: {
    mcp: string;
  };
}

// ============================================
// DISCOVERY
// ============================================

export interface DiscoverRequest {
  query: string;
  limit?: number;
  threshold?: number;
}

export interface DiscoverResult {
  apps: DiscoveredApp[];
  total: number;
  query: string;
  model?: string;
}

export interface DiscoveredApp {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isPublic: boolean;
  isOwner: boolean;
  similarity: number;
  mcpEndpoint: string;
}

// ============================================
// BYOK (Bring Your Own Key) PROVIDERS
// ============================================

export interface BYOKProviderInfo {
  id: BYOKProvider;
  name: string;
  description: string;
  baseUrl: string;
  defaultModel: string;
  models: BYOKModel[];
  docsUrl: string;
  apiKeyUrl: string; // Where users get their API key
}

export interface BYOKModel {
  id: string;
  name: string;
  contextWindow: number;
  inputPrice: number; // per 1M tokens in USD
  outputPrice: number; // per 1M tokens in USD
}

// Provider configurations - used by both frontend and backend
export const BYOK_PROVIDERS: Record<BYOKProvider, BYOKProviderInfo> = {
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    description: 'Access 100+ models from one API',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    models: [
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000, inputPrice: 3, outputPrice: 15 },
      { id: 'anthropic/claude-3-opus', name: 'Claude 3 Opus', contextWindow: 200000, inputPrice: 15, outputPrice: 75 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000, inputPrice: 5, outputPrice: 15 },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'google/gemini-pro-1.5', name: 'Gemini 1.5 Pro', contextWindow: 1000000, inputPrice: 2.5, outputPrice: 7.5 },
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek Chat', contextWindow: 64000, inputPrice: 0.14, outputPrice: 0.28 },
    ],
    docsUrl: 'https://openrouter.ai/docs',
    apiKeyUrl: 'https://openrouter.ai/keys',
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    description: 'GPT-4o, GPT-4, and more',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000, inputPrice: 5, outputPrice: 15 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', contextWindow: 128000, inputPrice: 0.15, outputPrice: 0.6 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000, inputPrice: 10, outputPrice: 30 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', contextWindow: 16385, inputPrice: 0.5, outputPrice: 1.5 },
    ],
    docsUrl: 'https://platform.openai.com/docs',
    apiKeyUrl: 'https://platform.openai.com/api-keys',
  },
  anthropic: {
    id: 'anthropic',
    name: 'Anthropic',
    description: 'Claude 3.5 Sonnet, Opus, and Haiku',
    baseUrl: 'https://api.anthropic.com/v1',
    defaultModel: 'claude-3-5-sonnet-20241022',
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000, inputPrice: 3, outputPrice: 15 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200000, inputPrice: 15, outputPrice: 75 },
      { id: 'claude-3-haiku-20240307', name: 'Claude 3 Haiku', contextWindow: 200000, inputPrice: 0.25, outputPrice: 1.25 },
    ],
    docsUrl: 'https://docs.anthropic.com',
    apiKeyUrl: 'https://console.anthropic.com/settings/keys',
  },
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    description: 'High-performance models at low cost',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek Chat', contextWindow: 64000, inputPrice: 0.14, outputPrice: 0.28 },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', contextWindow: 64000, inputPrice: 0.14, outputPrice: 0.28 },
    ],
    docsUrl: 'https://platform.deepseek.com/docs',
    apiKeyUrl: 'https://platform.deepseek.com/api_keys',
  },
  moonshot: {
    id: 'moonshot',
    name: 'Moonshot',
    description: 'Kimi models from Moonshot AI',
    baseUrl: 'https://api.moonshot.cn/v1',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 8K', contextWindow: 8000, inputPrice: 0.12, outputPrice: 0.12 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 32K', contextWindow: 32000, inputPrice: 0.24, outputPrice: 0.24 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 128K', contextWindow: 128000, inputPrice: 0.60, outputPrice: 0.60 },
    ],
    docsUrl: 'https://platform.moonshot.cn/docs',
    apiKeyUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
} as const;

// ============================================
// APP MANIFEST (v2 Architecture)
// ============================================

/**
 * App manifest schema for explicit app configuration.
 * Replaces auto-detection with explicit declarations.
 *
 * Example manifest.json:
 * {
 *   "name": "Todo App",
 *   "version": "1.0.0",
 *   "description": "A simple todo list manager",
 *   "type": "mcp",
 *   "entry": {
 *     "functions": "functions.ts"
 *   },
 *   "functions": {
 *     "addTodo": {
 *       "description": "Add a new todo item",
 *       "parameters": {
 *         "text": { "type": "string", "description": "The todo text" },
 *         "priority": { "type": "string", "enum": ["low", "medium", "high"], "default": "medium" }
 *       },
 *       "returns": { "type": "object", "description": "The created todo" }
 *     }
 *   }
 * }
 */
export interface AppManifest {
  // Required
  name: string;
  version: string;

  // Optional metadata
  description?: string;
  author?: string;
  icon?: string;

  // App type - MCP only
  type: 'mcp';

  // Entry points
  entry: {
    // File containing MCP-callable functions
    functions?: string;
  };

  // Function declarations for MCP tools
  // Key is function name, value is function metadata
  functions?: Record<string, ManifestFunction>;

  // Permissions this app requires
  permissions?: string[];

  // Environment variables this app expects
  env?: Record<string, ManifestEnvVar>;
}

export interface ManifestFunction {
  description: string;
  parameters?: Record<string, ManifestParameter>;
  returns?: ManifestReturn;
  examples?: string[];
}

export interface ManifestParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: ManifestParameter; // For array types
  properties?: Record<string, ManifestParameter>; // For object types
}

export interface ManifestReturn {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'void';
  description?: string;
}

export interface ManifestEnvVar {
  description?: string;
  required?: boolean;
  default?: string;
}

// Validation result for manifest
export interface ManifestValidationResult {
  valid: boolean;
  manifest?: AppManifest;
  errors: ManifestValidationError[];
  warnings: string[];
}

export interface ManifestValidationError {
  path: string;
  message: string;
}

/**
 * Validate an app manifest
 */
export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'Manifest must be an object' }], warnings };
  }

  const manifest = input as Record<string, unknown>;

  // Required fields
  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push({ path: 'name', message: 'name is required and must be a string' });
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push({ path: 'version', message: 'version is required and must be a string' });
  }

  // Type validation - MCP only
  if (!manifest.type || manifest.type !== 'mcp') {
    errors.push({ path: 'type', message: 'type must be "mcp"' });
  }

  // Entry validation
  if (!manifest.entry || typeof manifest.entry !== 'object') {
    errors.push({ path: 'entry', message: 'entry is required and must be an object' });
  } else {
    const entry = manifest.entry as Record<string, unknown>;
    if (!entry.functions) {
      errors.push({ path: 'entry.functions', message: 'entry.functions is required for MCP apps' });
    }
  }

  // Functions validation (optional but must be valid if present)
  if (manifest.functions !== undefined) {
    if (typeof manifest.functions !== 'object' || manifest.functions === null) {
      errors.push({ path: 'functions', message: 'functions must be an object' });
    } else {
      const functions = manifest.functions as Record<string, unknown>;
      for (const [fnName, fnDef] of Object.entries(functions)) {
        if (!fnDef || typeof fnDef !== 'object') {
          errors.push({ path: `functions.${fnName}`, message: 'function definition must be an object' });
          continue;
        }

        const fn = fnDef as Record<string, unknown>;
        if (!fn.description || typeof fn.description !== 'string') {
          errors.push({ path: `functions.${fnName}.description`, message: 'description is required' });
        }

        // Validate parameters if present
        if (fn.parameters !== undefined && typeof fn.parameters !== 'object') {
          errors.push({ path: `functions.${fnName}.parameters`, message: 'parameters must be an object' });
        }
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return {
    valid: true,
    manifest: input as AppManifest,
    errors: [],
    warnings,
  };
}

/**
 * Convert manifest functions to MCP tools format
 */
export function manifestToMCPTools(manifest: AppManifest, appId: string, appSlug: string): MCPTool[] {
  if (!manifest.functions) return [];

  const tools: MCPTool[] = [];

  for (const [fnName, fnDef] of Object.entries(manifest.functions)) {
    const tool: MCPTool = {
      name: `${appSlug}_${fnName}`,
      title: fnName,
      description: fnDef.description,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };

    // Convert parameters to JSON Schema
    if (fnDef.parameters) {
      const properties: Record<string, MCPJsonSchema> = {};
      const required: string[] = [];

      for (const [paramName, paramDef] of Object.entries(fnDef.parameters)) {
        properties[paramName] = {
          type: paramDef.type,
          description: paramDef.description,
        };

        if (paramDef.enum) {
          properties[paramName].enum = paramDef.enum;
        }

        if (paramDef.default !== undefined) {
          properties[paramName].default = paramDef.default;
        }

        if (paramDef.required !== false) {
          required.push(paramName);
        }
      }

      tool.inputSchema.properties = properties;
      tool.inputSchema.required = required;
    }

    tools.push(tool);
  }

  return tools;
}
