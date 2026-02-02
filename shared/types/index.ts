// Ultralight Shared Types
// Used across API, Web, and Runtime

// ============================================
// USER & AUTH
// ============================================

export interface User {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
  tier: 'free' | 'pro';
  tier_expires_at: string | null;
  ai_credit_balance: number; // cents
  ai_credit_resets_at: string | null;
  byok_enabled: boolean;
  byok_provider: 'openrouter' | 'anthropic' | 'openai' | null;
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
  storage_key: string;
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
  category: string | null;
  tags: string[];
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

export const TIER_LIMITS = {
  free: {
    max_apps: 5,
    daily_ai_credit_cents: 5, // $0.05
    monthly_ai_credit_cents: 150, // ~$1.50
    max_file_size_mb: 10,
    max_files_per_app: 50,
    execution_timeout_ms: 30000, // 30s
    log_retention_days: 7,
  },
  pro: {
    max_apps: Infinity,
    daily_ai_credit_cents: 50, // $0.50
    monthly_ai_credit_cents: 1500, // $15
    max_file_size_mb: 10,
    max_files_per_app: 50,
    execution_timeout_ms: 60000, // 60s
    log_retention_days: 30,
  },
} as const;

// ============================================
// ALLOWED FILE TYPES
// ============================================

export const ALLOWED_EXTENSIONS = ['.ts', '.js', '.json', '.md'] as const;
export const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
export const MAX_FILES_PER_UPLOAD = 50;
