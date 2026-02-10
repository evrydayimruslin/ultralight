/**
 * Ultralight SDK Type Definitions
 * @package @ultralightpro/types
 *
 * These types provide autocomplete and type checking for apps running on Ultralight.
 * The `ultralight` global is automatically available at runtime - no imports needed.
 *
 * Usage:
 *   /// <reference types="@ultralightpro/types" />
 *
 * Or in tsconfig.json:
 *   { "compilerOptions": { "types": ["@ultralightpro/types"] } }
 */

// ============================================
// GLOBAL DECLARATION
// ============================================

declare global {
  /**
   * The Ultralight SDK - available globally in all Ultralight apps.
   * No import needed - just use `ultralight.store()`, `ultralight.ai()`, etc.
   */
  const ultralight: UltralightSDK;

  /**
   * Lodash-like utility functions available globally.
   * @example _.groupBy(items, 'category')
   * @example _.chunk(array, 10)
   */
  const _: LodashLike;

  /**
   * UUID generation utilities.
   * @example uuid.v4() // "550e8400-e29b-41d4-a716-446655440000"
   */
  const uuid: {
    v4(): string;
  };

  /**
   * Base64 encoding/decoding utilities.
   * @example base64.encode("hello") // "aGVsbG8="
   */
  const base64: {
    encode(str: string): string;
    decode(str: string): string;
    encodeBytes(bytes: Uint8Array): string;
    decodeBytes(str: string): Uint8Array;
  };

  /**
   * Cryptographic hash functions.
   * @example await hash.sha256("hello")
   */
  const hash: {
    sha256(data: string): Promise<string>;
    sha512(data: string): Promise<string>;
    md5(data: string): string;
  };

  /**
   * Date formatting utilities (date-fns style).
   * @example dateFns.format(new Date(), 'yyyy-MM-dd')
   */
  const dateFns: DateFnsLike;

  /**
   * Schema validation utilities (Zod-like API).
   * @example
   * const userSchema = schema.object({
   *   name: schema.string().min(1),
   *   email: schema.string().email(),
   *   age: schema.number().min(0).optional()
   * });
   * const result = userSchema.safeParse(data);
   */
  const schema: SchemaBuilder;

  /**
   * Markdown parsing utilities.
   * @example markdown.toHtml('# Hello') // '<h1>Hello</h1>'
   */
  const markdown: MarkdownUtils;

  /**
   * String manipulation utilities.
   * @example str.slugify('Hello World') // 'hello-world'
   */
  const str: StringUtils;

  /**
   * JWT decoding utilities (read-only, no signing).
   * @example jwt.decode(token) // { header, payload }
   */
  const jwt: JwtUtils;

  /**
   * HTTP response builder utilities.
   * @example http.json({ success: true })
   */
  const http: HttpUtils;
}

// ============================================
// MAIN SDK INTERFACE
// ============================================

interface UltralightSDK {
  // ---- Environment Variables ----

  /**
   * App environment variables (read-only, decrypted).
   * Set these in your app settings on ultralight.dev.
   * @example const apiKey = ultralight.env.STRIPE_KEY
   */
  env: Readonly<Record<string, string>>;

  // ---- User Context ----

  /**
   * Current authenticated user, or null if not authenticated.
   * Contains id, email, displayName, avatarUrl, and tier.
   */
  user: UserContext | null;

  /**
   * Check if a user is currently authenticated.
   * @returns true if user is logged in
   */
  isAuthenticated(): boolean;

  /**
   * Require authentication - throws an error if user is not logged in.
   * Use this at the start of functions that need auth.
   * @throws Error if not authenticated
   * @returns The authenticated user context
   * @example
   * export async function saveProfile(data: ProfileData) {
   *   const user = ultralight.requireAuth(); // Throws if not logged in
   *   await ultralight.store(`profiles/${user.id}`, data);
   * }
   */
  requireAuth(): UserContext;

  // ---- Data Storage (R2-based) ----

  /**
   * Store a value in persistent storage.
   * Data is automatically partitioned per-user for security.
   * @param key Storage key - use "/" for hierarchy (e.g., "notes/123")
   * @param value Any JSON-serializable value
   * @example await ultralight.store('settings', { theme: 'dark' })
   * @example await ultralight.store('notes/abc123', { title: 'Hello', content: '...' })
   */
  store(key: string, value: unknown): Promise<void>;

  /**
   * Load a value from storage by key.
   * @param key Storage key to retrieve
   * @returns The stored value, or null if not found
   * @example const settings = await ultralight.load('settings')
   */
  load<T = unknown>(key: string): Promise<T | null>;

  /**
   * Remove a value from storage.
   * @param key Storage key to delete
   * @example await ultralight.remove('notes/abc123')
   */
  remove(key: string): Promise<void>;

  /**
   * List all keys matching a prefix.
   * @param prefix Optional prefix to filter keys
   * @returns Array of matching key names
   * @example const noteKeys = await ultralight.list('notes/')
   */
  list(prefix?: string): Promise<string[]>;

  /**
   * Query items with filtering, sorting, and pagination.
   * @param prefix Key prefix to query
   * @param options Query options (filter, sort, limit, offset)
   * @example
   * const recentNotes = await ultralight.query('notes/', {
   *   sort: { field: 'createdAt', order: 'desc' },
   *   limit: 10
   * });
   */
  query(prefix: string, options?: QueryOptions): Promise<QueryResult[]>;

  /**
   * Store multiple items at once.
   * @param items Array of { key, value } pairs
   * @example await ultralight.batchStore([
   *   { key: 'notes/1', value: { title: 'Note 1' } },
   *   { key: 'notes/2', value: { title: 'Note 2' } }
   * ])
   */
  batchStore(items: Array<{ key: string; value: unknown }>): Promise<void>;

  /**
   * Load multiple items at once.
   * @param keys Array of keys to load
   * @returns Array of { key, value } pairs
   */
  batchLoad(keys: string[]): Promise<Array<{ key: string; value: unknown }>>;

  /**
   * Remove multiple items at once.
   * @param keys Array of keys to remove
   */
  batchRemove(keys: string[]): Promise<void>;

  // ---- Cross-App Memory ----

  /**
   * Store a value in cross-app user memory.
   * Unlike store(), this data persists across different apps.
   * Requires 'memory:write' permission.
   * @param key Memory key
   * @param value Value to remember
   */
  remember(key: string, value: unknown): Promise<void>;

  /**
   * Recall a value from cross-app user memory.
   * Requires 'memory:read' permission.
   * @param key Memory key
   * @returns The remembered value, or null if not found
   */
  recall<T = unknown>(key: string): Promise<T | null>;

  // ---- AI ----

  /**
   * Make an AI call using the user's configured API key (BYOK).
   * The user must have set up their API key in Settings.
   * Requires 'ai:call' permission.
   * @param request AI request with messages, model, etc.
   * @returns AI response with content and usage stats
   * @example
   * const response = await ultralight.ai({
   *   messages: [
   *     { role: 'system', content: 'You are a helpful assistant.' },
   *     { role: 'user', content: 'What is 2+2?' }
   *   ],
   *   temperature: 0.7,
   *   max_tokens: 1000
   * });
   * console.log(response.content); // "4"
   */
  ai(request: AIRequest): Promise<AIResponse>;

  // ---- Cron/Scheduling ----

  /**
   * Cron job management for background scheduled tasks.
   */
  cron: CronSDK;
}

// ============================================
// USER CONTEXT
// ============================================

interface UserContext {
  /** User's unique ID */
  id: string;
  /** User's email address */
  email: string;
  /** User's display name (may be null) */
  displayName: string | null;
  /** URL to user's avatar image (may be null) */
  avatarUrl: string | null;
  /** User's subscription tier */
  tier: 'free' | 'fun' | 'pro' | 'scale' | 'enterprise';
}

// ============================================
// AI TYPES
// ============================================

interface AIRequest {
  /**
   * Array of messages for the conversation.
   * At minimum, include one user message.
   */
  messages: AIMessage[];

  /**
   * Model to use (optional).
   * If not specified, uses the default model for the user's provider.
   * @example "gpt-4o" (OpenAI)
   * @example "claude-3-5-sonnet-20241022" (Anthropic)
   * @example "anthropic/claude-3.5-sonnet" (OpenRouter)
   */
  model?: string;

  /**
   * Sampling temperature (0-2).
   * Lower = more deterministic, higher = more creative.
   * @default 0.7
   */
  temperature?: number;

  /**
   * Maximum tokens to generate.
   */
  max_tokens?: number;

  /**
   * Tools/functions the AI can call (for function calling).
   */
  tools?: AITool[];
}

interface AIMessage {
  /** Role of the message sender */
  role: 'system' | 'user' | 'assistant';
  /** Content of the message */
  content: string;
}

interface AITool {
  /** Tool name (function name) */
  name: string;
  /** Description of what the tool does */
  description: string;
  /** JSON Schema for the tool's parameters */
  parameters: Record<string, unknown>;
}

interface AIResponse {
  /** The AI's response text */
  content: string;
  /** The model that was used */
  model: string;
  /** Token usage statistics */
  usage: {
    input_tokens: number;
    output_tokens: number;
    cost_cents: number;
  };
}

// ============================================
// QUERY TYPES
// ============================================

interface QueryOptions {
  /**
   * Filter function to apply to results.
   * @example { filter: (item) => item.status === 'active' }
   */
  filter?: (value: unknown) => boolean;

  /**
   * Sort configuration.
   * @example { sort: { field: 'createdAt', order: 'desc' } }
   */
  sort?: {
    field: string;
    order: 'asc' | 'desc';
  };

  /**
   * Maximum number of results to return.
   */
  limit?: number;

  /**
   * Number of results to skip (for pagination).
   */
  offset?: number;
}

interface QueryResult {
  /** The storage key */
  key: string;
  /** The stored value */
  value: unknown;
  /** When the value was last updated */
  updatedAt?: string;
}

// ============================================
// CRON TYPES
// ============================================

interface CronSDK {
  /**
   * Register a new cron job.
   * @param name Unique name for this job within your app
   * @param schedule Cron expression (e.g., "0 9 * * *" for daily at 9am)
   * @param handler Name of the exported function to call
   * @example await ultralight.cron.register('daily-report', '0 9 * * *', 'generateReport')
   */
  register(name: string, schedule: string, handler: string): Promise<CronJob>;

  /**
   * Unregister (delete) a cron job.
   * @param name Name of the job to remove
   */
  unregister(name: string): Promise<void>;

  /**
   * Update an existing cron job.
   * @param name Name of the job to update
   * @param updates Fields to update (schedule, handler, enabled)
   */
  update(name: string, updates: Partial<{
    schedule: string;
    handler: string;
    enabled: boolean;
  }>): Promise<CronJob>;

  /**
   * List all cron jobs for this app.
   */
  list(): Promise<CronJob[]>;

  /**
   * Validate a cron expression.
   * @param expression Cron expression to validate
   * @returns true if valid
   */
  validate(expression: string): boolean;

  /**
   * Get a human-readable description of a cron expression.
   * @param expression Cron expression
   * @returns Description like "Every day at 9:00 AM"
   */
  describe(expression: string): string;

  /**
   * Common cron expression presets.
   */
  presets: CronPresets;
}

interface CronJob {
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

interface CronPresets {
  EVERY_MINUTE: '* * * * *';
  EVERY_5_MINUTES: '*/5 * * * *';
  EVERY_15_MINUTES: '*/15 * * * *';
  EVERY_30_MINUTES: '*/30 * * * *';
  EVERY_HOUR: '0 * * * *';
  EVERY_6_HOURS: '0 */6 * * *';
  EVERY_12_HOURS: '0 */12 * * *';
  DAILY_MIDNIGHT: '0 0 * * *';
  DAILY_9AM: '0 9 * * *';
  DAILY_6PM: '0 18 * * *';
  WEEKLY_SUNDAY: '0 0 * * 0';
  WEEKLY_MONDAY: '0 0 * * 1';
  MONTHLY_FIRST: '0 0 1 * *';
}

// ============================================
// UTILITY TYPES (Lodash-like)
// ============================================

interface LodashLike {
  // Arrays
  chunk<T>(arr: T[], size: number): T[][];
  compact<T>(arr: (T | null | undefined | false | 0 | '')[]): T[];
  uniq<T>(arr: T[]): T[];
  flatten<T>(arr: (T | T[])[]): T[];
  flattenDeep(arr: unknown[]): unknown[];
  first<T>(arr: T[]): T | undefined;
  last<T>(arr: T[]): T | undefined;
  take<T>(arr: T[], n: number): T[];
  drop<T>(arr: T[], n: number): T[];
  shuffle<T>(arr: T[]): T[];
  sample<T>(arr: T[]): T | undefined;
  sampleSize<T>(arr: T[], n: number): T[];
  sortBy<T>(arr: T[], key: keyof T | ((item: T) => unknown)): T[];
  groupBy<T>(arr: T[], key: keyof T | ((item: T) => string)): Record<string, T[]>;
  keyBy<T>(arr: T[], key: keyof T | ((item: T) => string)): Record<string, T>;
  partition<T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]];

  // Objects
  pick<T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K>;
  omit<T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K>;
  get(obj: unknown, path: string, defaultValue?: unknown): unknown;
  set<T extends object>(obj: T, path: string, value: unknown): T;
  merge<T extends object>(...objects: Partial<T>[]): T;
  cloneDeep<T>(obj: T): T;
  isEmpty(value: unknown): boolean;

  // Strings
  camelCase(str: string): string;
  snakeCase(str: string): string;
  kebabCase(str: string): string;
  capitalize(str: string): string;
  truncate(str: string, length: number, end?: string): string;

  // Functions
  debounce<T extends (...args: unknown[]) => unknown>(fn: T, wait: number): T;
  throttle<T extends (...args: unknown[]) => unknown>(fn: T, wait: number): T;

  // Numbers
  random(min: number, max: number): number;
  clamp(num: number, min: number, max: number): number;
  sum(arr: number[]): number;
  mean(arr: number[]): number;
  min(arr: number[]): number;
  max(arr: number[]): number;

  // Predicates
  isString(value: unknown): value is string;
  isNumber(value: unknown): value is number;
  isBoolean(value: unknown): value is boolean;
  isArray(value: unknown): value is unknown[];
  isObject(value: unknown): value is object;
  isFunction(value: unknown): value is Function;
  isNil(value: unknown): value is null | undefined;
}

// ============================================
// DATE UTILITIES (date-fns style)
// ============================================

interface DateFnsLike {
  /**
   * Format a date using format tokens.
   * @param date Date to format
   * @param formatStr Format string (e.g., 'yyyy-MM-dd HH:mm:ss')
   * @example dateFns.format(new Date(), 'yyyy-MM-dd') // "2024-01-15"
   */
  format(date: Date | string | number, formatStr: string): string;

  /**
   * Get human-readable relative time.
   * @example dateFns.formatDistance(pastDate) // "3 days ago"
   */
  formatDistance(date: Date | string | number, baseDate?: Date | string | number): string;

  /** Add days to a date */
  addDays(date: Date | string | number, days: number): Date;

  /** Add hours to a date */
  addHours(date: Date | string | number, hours: number): Date;

  /** Add minutes to a date */
  addMinutes(date: Date | string | number, minutes: number): Date;

  /** Get start of day (00:00:00) */
  startOfDay(date: Date | string | number): Date;

  /** Get end of day (23:59:59) */
  endOfDay(date: Date | string | number): Date;

  /** Check if date is after another date */
  isAfter(date: Date | string | number, dateToCompare: Date | string | number): boolean;

  /** Check if date is before another date */
  isBefore(date: Date | string | number, dateToCompare: Date | string | number): boolean;

  /** Check if date is today */
  isToday(date: Date | string | number): boolean;

  /** Parse ISO date string */
  parseISO(dateString: string): Date;
}

// ============================================
// SCHEMA VALIDATION (Zod-like)
// ============================================

interface SchemaBuilder {
  string(): StringSchema;
  number(): NumberSchema;
  boolean(): BooleanSchema;
  array<T>(itemSchema: Schema<T>): ArraySchema<T>;
  object<T extends Record<string, Schema<unknown>>>(shape: T): ObjectSchema<T>;
  optional<T>(innerSchema: Schema<T>): Schema<T | undefined>;
  union<T extends Schema<unknown>[]>(...schemas: T): Schema<T[number] extends Schema<infer U> ? U : never>;
  literal<T extends string | number | boolean>(value: T): Schema<T>;
  enum<T extends string[]>(...values: T): Schema<T[number]>;
  any(): Schema<unknown>;
}

interface Schema<T> {
  parse(value: unknown): T;
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: string };
  optional(): Schema<T | undefined>;
  default(defaultValue: T): Schema<T>;
}

interface StringSchema extends Schema<string> {
  min(length: number): StringSchema;
  max(length: number): StringSchema;
  length(length: number): StringSchema;
  regex(pattern: RegExp): StringSchema;
  email(): StringSchema;
  url(): StringSchema;
}

interface NumberSchema extends Schema<number> {
  min(value: number): NumberSchema;
  max(value: number): NumberSchema;
  int(): NumberSchema;
  positive(): NumberSchema;
  negative(): NumberSchema;
}

interface BooleanSchema extends Schema<boolean> {}

interface ArraySchema<T> extends Schema<T[]> {
  min(length: number): ArraySchema<T>;
  max(length: number): ArraySchema<T>;
  nonempty(): ArraySchema<T>;
}

interface ObjectSchema<T extends Record<string, Schema<unknown>>> extends Schema<{
  [K in keyof T]: T[K] extends Schema<infer U> ? U : never;
}> {}

// ============================================
// MARKDOWN UTILITIES
// ============================================

interface MarkdownUtils {
  /** Parse markdown to HTML */
  toHtml(md: string): string;
  /** Strip markdown to plain text */
  toText(md: string): string;
}

// ============================================
// STRING UTILITIES
// ============================================

interface StringUtils {
  /** Convert string to URL-friendly slug */
  slugify(text: string): string;
  /** Pluralize a word based on count */
  pluralize(word: string, count: number, plural?: string): string;
  /** Convert to title case */
  titleCase(text: string): string;
  /** Escape HTML special characters */
  escapeHtml(text: string): string;
  /** Unescape HTML entities */
  unescapeHtml(text: string): string;
  /** Count words in text */
  wordCount(text: string): number;
  /** Truncate to word boundary */
  truncateWords(text: string, count: number, suffix?: string): string;
  /** Generate a random string */
  random(length: number, charset?: 'alphanumeric' | 'alpha' | 'numeric' | 'hex' | string): string;
}

// ============================================
// JWT UTILITIES
// ============================================

interface JwtUtils {
  /** Decode a JWT without verification (read-only) */
  decode(token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null;
  /** Check if a JWT is expired */
  isExpired(token: string): boolean;
  /** Get expiration date from JWT */
  getExpiration(token: string): Date | null;
}

// ============================================
// HTTP UTILITIES
// ============================================

interface HttpUtils {
  /** Create a JSON response */
  json(data: unknown, status?: number, headers?: Record<string, string>): Response;
  /** Create a text response */
  text(data: string, status?: number, headers?: Record<string, string>): Response;
  /** Create an HTML response */
  html(data: string, status?: number, headers?: Record<string, string>): Response;
  /** Create a redirect response */
  redirect(url: string, status?: number): Response;
  /** Create an error response */
  error(message: string, status?: number, details?: unknown): Response;
}

// ============================================
// HTTP REQUEST (for HTTP endpoints)
// ============================================

/**
 * Request object passed to HTTP endpoint functions.
 * Simplified Request-like object with useful properties.
 */
interface UltralightRequest {
  /** HTTP method (GET, POST, etc.) */
  method: string;
  /** Full URL path with query string */
  url: string;
  /** Path portion after the function name */
  path: string;
  /** Parsed query parameters */
  query: Record<string, string>;
  /** Request headers */
  headers: Record<string, string>;
  /** Parse body as JSON */
  json(): Promise<unknown>;
  /** Get body as text */
  text(): Promise<string>;
  /** Parse body as form data */
  formData(): Promise<Record<string, unknown>>;
}

// ============================================
// REACT APP TYPES
// ============================================

/**
 * Type for the default export of a React/UI app.
 * The function receives the container element and the SDK.
 * @example
 * const App: UltralightApp = (container, ultralight) => {
 *   const root = ReactDOM.createRoot(container);
 *   root.render(<MyApp sdk={ultralight} />);
 * };
 * export default App;
 */
type UltralightApp = (
  container: HTMLElement,
  sdk: UltralightSDK
) => void | Promise<void> | (() => void);

/**
 * Props type for React components that receive the SDK.
 * @example
 * function MyComponent({ sdk }: UltralightProps) {
 *   const [data, setData] = useState(null);
 *   useEffect(() => {
 *     sdk.load('myKey').then(setData);
 *   }, []);
 * }
 */
interface UltralightProps {
  sdk: UltralightSDK;
}

// Export types for use in apps
export {
  UltralightSDK,
  UserContext,
  AIRequest,
  AIMessage,
  AITool,
  AIResponse,
  QueryOptions,
  QueryResult,
  CronSDK,
  CronJob,
  CronPresets,
  LodashLike,
  DateFnsLike,
  SchemaBuilder,
  Schema,
  StringSchema,
  NumberSchema,
  BooleanSchema,
  ArraySchema,
  ObjectSchema,
  MarkdownUtils,
  StringUtils,
  JwtUtils,
  HttpUtils,
  UltralightRequest,
  UltralightApp,
  UltralightProps,
};

export {};
