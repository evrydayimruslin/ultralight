// Ultralight Deno Runtime
// Sandboxed execution with pre-bundled stdlib

import type {
  AIRequest,
  AIResponse,
  LogEntry,
} from '../../shared/types/index.ts';

export interface RuntimeConfig {
  appId: string;
  userId: string;
  executionId: string;
  code: string;
  permissions: string[];
  userApiKey: string | null;
  // App data storage (R2-based, zero config)
  appDataService: AppDataService;
  // User memory (for unified Memory.md - optional, can be null)
  memoryService: MemoryService | null;
  aiService: AIService;
}

export interface AppDataService {
  store(key: string, value: unknown): Promise<void>;
  load(key: string): Promise<unknown>;
  remove(key: string): Promise<void>;
  list(prefix?: string): Promise<string[]>;
}

export interface MemoryService {
  remember(key: string, value: unknown): Promise<void>;
  recall(key: string): Promise<unknown>;
}

export interface AIService {
  call(request: AIRequest, apiKey: string): Promise<AIResponse>;
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
    stack?: string;
  };
}

// ============================================
// PRE-BUNDLED STDLIB
// These are available globally in user code
// ============================================

/**
 * UUID v4 generator (simple implementation)
 */
const uuid = {
  v4: (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },
};

/**
 * Base64 encoding/decoding
 */
const base64 = {
  encode: (str: string): string => {
    return btoa(unescape(encodeURIComponent(str)));
  },
  decode: (str: string): string => {
    return decodeURIComponent(escape(atob(str)));
  },
  encodeBytes: (bytes: Uint8Array): string => {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  },
  decodeBytes: (str: string): Uint8Array => {
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  },
};

/**
 * Simple hash functions using Web Crypto API
 */
const hash = {
  sha256: async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },
  sha512: async (data: string): Promise<string> => {
    const encoder = new TextEncoder();
    const dataBuffer = encoder.encode(data);
    const hashBuffer = await crypto.subtle.digest('SHA-512', dataBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },
  md5: (data: string): string => {
    // Simple MD5 for non-cryptographic use (checksums, etc)
    // For security, use sha256/sha512
    return simpleHash(data);
  },
};

// Simple non-crypto hash for MD5-like use cases
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * Lodash-like utilities (subset of most common functions)
 */
const _ = {
  // Arrays
  chunk: <T>(arr: T[], size: number): T[][] => {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  },
  compact: <T>(arr: (T | null | undefined | false | 0 | '')[]): T[] => {
    return arr.filter(Boolean) as T[];
  },
  uniq: <T>(arr: T[]): T[] => [...new Set(arr)],
  flatten: <T>(arr: (T | T[])[]): T[] => arr.flat() as T[],
  flattenDeep: (arr: unknown[]): unknown[] => arr.flat(Infinity),
  first: <T>(arr: T[]): T | undefined => arr[0],
  last: <T>(arr: T[]): T | undefined => arr[arr.length - 1],
  take: <T>(arr: T[], n: number): T[] => arr.slice(0, n),
  drop: <T>(arr: T[], n: number): T[] => arr.slice(n),
  shuffle: <T>(arr: T[]): T[] => {
    const result = [...arr];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  },
  sample: <T>(arr: T[]): T | undefined => arr[Math.floor(Math.random() * arr.length)],
  sampleSize: <T>(arr: T[], n: number): T[] => _.shuffle(arr).slice(0, n),
  sortBy: <T>(arr: T[], key: keyof T | ((item: T) => unknown)): T[] => {
    return [...arr].sort((a, b) => {
      const aVal = typeof key === 'function' ? key(a) : a[key];
      const bVal = typeof key === 'function' ? key(b) : b[key];
      if (aVal < bVal) return -1;
      if (aVal > bVal) return 1;
      return 0;
    });
  },
  groupBy: <T>(arr: T[], key: keyof T | ((item: T) => string)): Record<string, T[]> => {
    return arr.reduce((acc, item) => {
      const groupKey = typeof key === 'function' ? key(item) : String(item[key]);
      (acc[groupKey] = acc[groupKey] || []).push(item);
      return acc;
    }, {} as Record<string, T[]>);
  },
  keyBy: <T>(arr: T[], key: keyof T | ((item: T) => string)): Record<string, T> => {
    return arr.reduce((acc, item) => {
      const k = typeof key === 'function' ? key(item) : String(item[key]);
      acc[k] = item;
      return acc;
    }, {} as Record<string, T>);
  },
  partition: <T>(arr: T[], predicate: (item: T) => boolean): [T[], T[]] => {
    const pass: T[] = [];
    const fail: T[] = [];
    arr.forEach(item => (predicate(item) ? pass : fail).push(item));
    return [pass, fail];
  },

  // Objects
  pick: <T extends object, K extends keyof T>(obj: T, keys: K[]): Pick<T, K> => {
    const result = {} as Pick<T, K>;
    keys.forEach(key => { if (key in obj) result[key] = obj[key]; });
    return result;
  },
  omit: <T extends object, K extends keyof T>(obj: T, keys: K[]): Omit<T, K> => {
    const result = { ...obj };
    keys.forEach(key => delete (result as T)[key]);
    return result as Omit<T, K>;
  },
  get: (obj: unknown, path: string, defaultValue?: unknown): unknown => {
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
      if (result == null) return defaultValue;
      result = (result as Record<string, unknown>)[key];
    }
    return result ?? defaultValue;
  },
  set: <T extends object>(obj: T, path: string, value: unknown): T => {
    const keys = path.split('.');
    let current = obj as Record<string, unknown>;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!(keys[i] in current)) current[keys[i]] = {};
      current = current[keys[i]] as Record<string, unknown>;
    }
    current[keys[keys.length - 1]] = value;
    return obj;
  },
  merge: <T extends object>(...objects: Partial<T>[]): T => {
    return Object.assign({}, ...objects) as T;
  },
  cloneDeep: <T>(obj: T): T => JSON.parse(JSON.stringify(obj)),
  isEmpty: (value: unknown): boolean => {
    if (value == null) return true;
    if (Array.isArray(value) || typeof value === 'string') return value.length === 0;
    if (typeof value === 'object') return Object.keys(value).length === 0;
    return false;
  },

  // Strings
  camelCase: (str: string): string => {
    return str.replace(/[-_\s]+(.)?/g, (_, c) => c ? c.toUpperCase() : '');
  },
  snakeCase: (str: string): string => {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`).replace(/^_/, '');
  },
  kebabCase: (str: string): string => {
    return str.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`).replace(/^-/, '');
  },
  capitalize: (str: string): string => str.charAt(0).toUpperCase() + str.slice(1),
  truncate: (str: string, length: number, end = '...'): string => {
    return str.length <= length ? str : str.slice(0, length - end.length) + end;
  },

  // Functions
  debounce: <T extends (...args: unknown[]) => unknown>(fn: T, wait: number): T => {
    let timeout: number | undefined;
    return ((...args: unknown[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), wait) as unknown as number;
    }) as T;
  },
  throttle: <T extends (...args: unknown[]) => unknown>(fn: T, wait: number): T => {
    let lastCall = 0;
    return ((...args: unknown[]) => {
      const now = Date.now();
      if (now - lastCall >= wait) {
        lastCall = now;
        return fn(...args);
      }
    }) as T;
  },

  // Numbers
  random: (min: number, max: number): number => Math.floor(Math.random() * (max - min + 1)) + min,
  clamp: (num: number, min: number, max: number): number => Math.min(Math.max(num, min), max),
  sum: (arr: number[]): number => arr.reduce((a, b) => a + b, 0),
  mean: (arr: number[]): number => arr.length ? _.sum(arr) / arr.length : 0,
  min: (arr: number[]): number => Math.min(...arr),
  max: (arr: number[]): number => Math.max(...arr),

  // Predicates
  isString: (value: unknown): value is string => typeof value === 'string',
  isNumber: (value: unknown): value is number => typeof value === 'number' && !isNaN(value),
  isBoolean: (value: unknown): value is boolean => typeof value === 'boolean',
  isArray: Array.isArray,
  isObject: (value: unknown): value is object => value !== null && typeof value === 'object' && !Array.isArray(value),
  isFunction: (value: unknown): value is Function => typeof value === 'function',
  isNil: (value: unknown): value is null | undefined => value == null,
};

/**
 * Date formatting utilities (date-fns style)
 */
const dateFns = {
  format: (date: Date | string | number, formatStr: string): string => {
    const d = new Date(date);
    const pad = (n: number) => n.toString().padStart(2, '0');

    const tokens: Record<string, string> = {
      'yyyy': d.getFullYear().toString(),
      'yy': d.getFullYear().toString().slice(-2),
      'MM': pad(d.getMonth() + 1),
      'M': (d.getMonth() + 1).toString(),
      'dd': pad(d.getDate()),
      'd': d.getDate().toString(),
      'HH': pad(d.getHours()),
      'H': d.getHours().toString(),
      'hh': pad(d.getHours() % 12 || 12),
      'h': (d.getHours() % 12 || 12).toString(),
      'mm': pad(d.getMinutes()),
      'm': d.getMinutes().toString(),
      'ss': pad(d.getSeconds()),
      's': d.getSeconds().toString(),
      'a': d.getHours() < 12 ? 'am' : 'pm',
      'A': d.getHours() < 12 ? 'AM' : 'PM',
      'EEEE': ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()],
      'EEE': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
      'MMMM': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][d.getMonth()],
      'MMM': ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()],
    };

    let result = formatStr;
    // Sort by length descending to match longer tokens first
    Object.keys(tokens).sort((a, b) => b.length - a.length).forEach(token => {
      result = result.replace(new RegExp(token, 'g'), tokens[token]);
    });
    return result;
  },

  formatDistance: (date: Date | string | number, baseDate: Date | string | number = new Date()): string => {
    const d = new Date(date);
    const base = new Date(baseDate);
    const diff = Math.abs(d.getTime() - base.getTime());

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    const months = Math.floor(days / 30);
    const years = Math.floor(days / 365);

    if (years > 0) return `${years} year${years > 1 ? 's' : ''} ago`;
    if (months > 0) return `${months} month${months > 1 ? 's' : ''} ago`;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
  },

  addDays: (date: Date | string | number, days: number): Date => {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  },

  addHours: (date: Date | string | number, hours: number): Date => {
    const d = new Date(date);
    d.setHours(d.getHours() + hours);
    return d;
  },

  addMinutes: (date: Date | string | number, minutes: number): Date => {
    const d = new Date(date);
    d.setMinutes(d.getMinutes() + minutes);
    return d;
  },

  startOfDay: (date: Date | string | number): Date => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  },

  endOfDay: (date: Date | string | number): Date => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  },

  isAfter: (date: Date | string | number, dateToCompare: Date | string | number): boolean => {
    return new Date(date) > new Date(dateToCompare);
  },

  isBefore: (date: Date | string | number, dateToCompare: Date | string | number): boolean => {
    return new Date(date) < new Date(dateToCompare);
  },

  isToday: (date: Date | string | number): boolean => {
    const d = new Date(date);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  },

  parseISO: (dateString: string): Date => new Date(dateString),
};

// ============================================
// SANDBOX EXECUTION
// ============================================

/**
 * Executes user code with soft isolation
 */
export async function executeInSandbox(
  config: RuntimeConfig,
  functionName: string,
  args: unknown[],
): Promise<ExecutionResult> {
  const startTime = Date.now();
  const logs: LogEntry[] = [];
  let aiCostCents = 0;

  const capturedConsole = {
    log: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'log', message });
    },
    error: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'error', message });
    },
    warn: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'warn', message });
    },
    info: (...items: unknown[]) => {
      const message = items.map(formatLogItem).join(' ');
      logs.push({ time: new Date().toISOString(), level: 'info', message });
    },
  };

  try {
    // Create SDK with both app data (R2) and user memory (Supabase)
    const sdk = {
      // APP DATA - R2-based, zero config
      store: async (key: string, value: unknown) => {
        await config.appDataService.store(key, value);
        capturedConsole.log(`[SDK] store("${key}")`);
      },
      load: async (key: string) => {
        const value = await config.appDataService.load(key);
        capturedConsole.log(`[SDK] load("${key}")`);
        return value;
      },
      remove: async (key: string) => {
        await config.appDataService.remove(key);
        capturedConsole.log(`[SDK] remove("${key}")`);
      },
      list: async (prefix?: string) => {
        const keys = await config.appDataService.list(prefix);
        capturedConsole.log(`[SDK] list(${prefix ? `"${prefix}"` : ''})`);
        return keys;
      },

      // USER MEMORY - For unified Memory.md
      remember: async (key: string, value: unknown) => {
        if (!config.permissions.includes('memory:write')) {
          throw new Error('memory:write permission required');
        }
        if (!config.memoryService) {
          throw new Error('User memory not available - use store() for app data');
        }
        await config.memoryService.remember(key, value);
        capturedConsole.log(`[SDK] remember("${key}")`);
      },
      recall: async (key: string) => {
        if (!config.permissions.includes('memory:read')) {
          throw new Error('memory:read permission required');
        }
        if (!config.memoryService) {
          throw new Error('User memory not available - use load() for app data');
        }
        const value = await config.memoryService.recall(key);
        capturedConsole.log(`[SDK] recall("${key}")`);
        return value;
      },

      // AI - Requires BYOK or platform credits
      ai: async (request: AIRequest): Promise<AIResponse> => {
        if (!config.permissions.includes('ai:call')) {
          throw new Error('ai:call permission required');
        }
        if (!config.userApiKey) {
          throw new Error('No API key configured - add your OpenRouter key in settings');
        }
        capturedConsole.log(`[SDK] ai()`);
        return await config.aiService.call(request, config.userApiKey);
      },
    };

    // Open fetch - allow all HTTPS
    const openFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const parsedUrl = new URL(url);

      // Only allow HTTPS (and localhost for development)
      if (parsedUrl.protocol !== 'https:' && parsedUrl.hostname !== 'localhost') {
        throw new Error(`Only HTTPS URLs are allowed. Got: ${parsedUrl.protocol}`);
      }

      return await fetch(input, init);
    };

    // Build execution context with pre-bundled stdlib
    const context = {
      // SDK
      ultralight: sdk,

      // Console
      console: capturedConsole,

      // Network (all HTTPS allowed)
      fetch: openFetch,

      // Timers
      setTimeout: (fn: () => void, ms: number) => setTimeout(fn, Math.min(ms, 30000)),
      clearTimeout,
      setInterval: (fn: () => void, ms: number) => setInterval(fn, Math.max(ms, 100)), // Min 100ms
      clearInterval,

      // Built-in globals
      URL,
      URLSearchParams,
      JSON,
      Math,
      Date,
      Array,
      Object,
      String,
      Number,
      Boolean,
      Promise,
      Error,
      RegExp,
      Map,
      Set,
      WeakMap,
      WeakSet,
      Symbol,
      BigInt,
      Uint8Array,
      Int8Array,
      Uint16Array,
      Int16Array,
      Uint32Array,
      Int32Array,
      Float32Array,
      Float64Array,
      ArrayBuffer,
      TextEncoder,
      TextDecoder,
      atob,
      btoa,
      crypto,

      // PRE-BUNDLED STDLIB - Available globally!
      _,           // Lodash-like utilities
      uuid,        // UUID generation
      base64,      // Base64 encoding/decoding
      hash,        // SHA-256, SHA-512, MD5
      dateFns,     // Date formatting and manipulation
    };

    // Try to execute using Function constructor
    let userFunc: Function;

    try {
      const contextKeys = Object.keys(context);
      const contextValues = Object.values(context);

      const wrapperCode = `
        "use strict";
        ${config.code}

        if (typeof ${functionName} !== 'function') {
          throw new Error('Function "${functionName}" not found');
        }

        return ${functionName}(...args);
      `;

      const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
      const fn = new AsyncFunction('args', ...contextKeys, wrapperCode);
      userFunc = (...callArgs: unknown[]) => fn(callArgs, ...contextValues);

    } catch (compileErr) {
      throw new Error(`Code compilation failed: ${compileErr instanceof Error ? compileErr.message : String(compileErr)}`);
    }

    const result = await userFunc(args);
    const durationMs = Date.now() - startTime;

    return {
      success: true,
      result,
      logs,
      durationMs,
      aiCostCents,
    };

  } catch (error) {
    const durationMs = Date.now() - startTime;

    return {
      success: false,
      result: null,
      logs,
      durationMs,
      aiCostCents,
      error: {
        type: error instanceof Error ? error.constructor.name : 'UnknownError',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
    };
  }
}

function formatLogItem(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item === null) return 'null';
  if (item === undefined) return 'undefined';
  if (typeof item === 'object') {
    try {
      return JSON.stringify(item);
    } catch {
      return '[Object]';
    }
  }
  return String(item);
}
