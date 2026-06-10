// Pre-bundled stdlib for Worker sandbox
// Ported from api/runtime/sandbox.ts — identical behavior

// ============================================
// UUID
// ============================================
export const uuid = {
  v4: (): string => {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  },
};

// ============================================
// BASE64
// ============================================
export const base64 = {
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

// ============================================
// HASH
// ============================================
function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    h = ((h << 5) - h) + char;
    h = h & h;
  }
  return Math.abs(h).toString(16).padStart(8, '0');
}

export const hash = {
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
    return simpleHash(data);
  },
};

// ============================================
// LODASH-LIKE UTILITIES
// ============================================
export const _ = {
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
      if ((aVal as number | string) < (bVal as number | string)) return -1;
      if ((aVal as number | string) > (bVal as number | string)) return 1;
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
    let timeout: ReturnType<typeof setTimeout> | undefined;
    return ((...args: unknown[]) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), wait);
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

// ============================================
// DATE UTILITIES
// ============================================
export const dateFns = {
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
// SCHEMA VALIDATION
// ============================================
class BaseSchema<T> {
  protected _optional = false;
  protected _default: T | undefined;

  parse(value: unknown): T {
    const result = this.safeParse(value);
    if (!result.success) throw new Error(result.error);
    return result.data;
  }

  safeParse(value: unknown): { success: true; data: T } | { success: false; error: string } {
    return { success: true, data: value as T };
  }

  optional(): OptionalSchema<T> {
    return new OptionalSchema(this);
  }

  default(defaultValue: T): this {
    this._default = defaultValue;
    return this;
  }
}

class StringSchema extends BaseSchema<string> {
  private _minLength?: number;
  private _maxLength?: number;
  private _pattern?: RegExp;
  private _email = false;
  private _url = false;

  safeParse(value: unknown): { success: true; data: string } | { success: false; error: string } {
    if (value === undefined && this._default !== undefined) return { success: true, data: this._default };
    if (typeof value !== 'string') return { success: false, error: 'Expected string' };
    if (this._minLength !== undefined && value.length < this._minLength) return { success: false, error: `String must be at least ${this._minLength} characters` };
    if (this._maxLength !== undefined && value.length > this._maxLength) return { success: false, error: `String must be at most ${this._maxLength} characters` };
    if (this._pattern && !this._pattern.test(value)) return { success: false, error: 'String does not match pattern' };
    if (this._email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return { success: false, error: 'Invalid email format' };
    if (this._url && !/^https?:\/\/.+/.test(value)) return { success: false, error: 'Invalid URL format' };
    return { success: true, data: value };
  }

  min(length: number): this { this._minLength = length; return this; }
  max(length: number): this { this._maxLength = length; return this; }
  length(length: number): this { this._minLength = length; this._maxLength = length; return this; }
  regex(pattern: RegExp): this { this._pattern = pattern; return this; }
  email(): this { this._email = true; return this; }
  url(): this { this._url = true; return this; }
}

class NumberSchema extends BaseSchema<number> {
  private _min?: number;
  private _max?: number;
  private _int = false;

  safeParse(value: unknown): { success: true; data: number } | { success: false; error: string } {
    if (value === undefined && this._default !== undefined) return { success: true, data: this._default };
    if (typeof value !== 'number' || isNaN(value)) return { success: false, error: 'Expected number' };
    if (this._int && !Number.isInteger(value)) return { success: false, error: 'Expected integer' };
    if (this._min !== undefined && value < this._min) return { success: false, error: `Number must be >= ${this._min}` };
    if (this._max !== undefined && value > this._max) return { success: false, error: `Number must be <= ${this._max}` };
    return { success: true, data: value };
  }

  min(value: number): this { this._min = value; return this; }
  max(value: number): this { this._max = value; return this; }
  int(): this { this._int = true; return this; }
  positive(): this { this._min = 0; return this; }
  negative(): this { this._max = 0; return this; }
}

class BooleanSchema extends BaseSchema<boolean> {
  safeParse(value: unknown): { success: true; data: boolean } | { success: false; error: string } {
    if (value === undefined && this._default !== undefined) return { success: true, data: this._default };
    if (typeof value !== 'boolean') return { success: false, error: 'Expected boolean' };
    return { success: true, data: value };
  }
}

class ArraySchema<T> extends BaseSchema<T[]> {
  private _minLength?: number;
  private _maxLength?: number;
  constructor(private itemSchema: BaseSchema<T>) { super(); }

  safeParse(value: unknown): { success: true; data: T[] } | { success: false; error: string } {
    if (!Array.isArray(value)) return { success: false, error: 'Expected array' };
    if (this._minLength !== undefined && value.length < this._minLength) return { success: false, error: `Array must have at least ${this._minLength} items` };
    if (this._maxLength !== undefined && value.length > this._maxLength) return { success: false, error: `Array must have at most ${this._maxLength} items` };
    const results: T[] = [];
    for (let i = 0; i < value.length; i++) {
      const result = this.itemSchema.safeParse(value[i]);
      if (!result.success) return { success: false, error: `[${i}]: ${result.error}` };
      results.push(result.data);
    }
    return { success: true, data: results };
  }

  min(length: number): this { this._minLength = length; return this; }
  max(length: number): this { this._maxLength = length; return this; }
  nonempty(): this { this._minLength = 1; return this; }
}

class ObjectSchema<T extends Record<string, BaseSchema<unknown>>> extends BaseSchema<{ [K in keyof T]: T[K] extends BaseSchema<infer U> ? U : never }> {
  constructor(private shape: T) { super(); }

  safeParse(value: unknown): { success: true; data: { [K in keyof T]: T[K] extends BaseSchema<infer U> ? U : never } } | { success: false; error: string } {
    if (typeof value !== 'object' || value === null) return { success: false, error: 'Expected object' };
    const result: Record<string, unknown> = {};
    for (const [key, s] of Object.entries(this.shape)) {
      const fieldResult = s.safeParse((value as Record<string, unknown>)[key]);
      if (!fieldResult.success) return { success: false, error: `${key}: ${fieldResult.error}` };
      result[key] = fieldResult.data;
    }
    return { success: true, data: result as { [K in keyof T]: T[K] extends BaseSchema<infer U> ? U : never } };
  }
}

class OptionalSchema<T> extends BaseSchema<T | undefined> {
  constructor(private innerSchema: BaseSchema<T>) { super(); }

  safeParse(value: unknown): { success: true; data: T | undefined } | { success: false; error: string } {
    if (value === undefined || value === null) return { success: true, data: undefined };
    return this.innerSchema.safeParse(value);
  }
}

class UnionSchema<T extends BaseSchema<unknown>[]> extends BaseSchema<T[number] extends BaseSchema<infer U> ? U : never> {
  constructor(private schemas: T) { super(); }

  safeParse(value: unknown): { success: true; data: T[number] extends BaseSchema<infer U> ? U : never } | { success: false; error: string } {
    for (const s of this.schemas) {
      const result = s.safeParse(value);
      if (result.success) return result as { success: true; data: T[number] extends BaseSchema<infer U> ? U : never };
    }
    return { success: false, error: 'Value does not match any schema in union' };
  }
}

class LiteralSchema<T extends string | number | boolean> extends BaseSchema<T> {
  constructor(private literalValue: T) { super(); }

  safeParse(value: unknown): { success: true; data: T } | { success: false; error: string } {
    if (value !== this.literalValue) return { success: false, error: `Expected ${JSON.stringify(this.literalValue)}` };
    return { success: true, data: value as T };
  }
}

class EnumSchema<T extends string[]> extends BaseSchema<T[number]> {
  constructor(private values: T) { super(); }

  safeParse(value: unknown): { success: true; data: T[number] } | { success: false; error: string } {
    if (!this.values.includes(value as string)) return { success: false, error: `Expected one of: ${this.values.join(', ')}` };
    return { success: true, data: value as T[number] };
  }
}

class AnySchema extends BaseSchema<unknown> {
  safeParse(value: unknown): { success: true; data: unknown } {
    return { success: true, data: value };
  }
}

export const schema = {
  string: () => new StringSchema(),
  number: () => new NumberSchema(),
  boolean: () => new BooleanSchema(),
  array: <T>(itemSchema: BaseSchema<T>) => new ArraySchema(itemSchema),
  object: <T extends Record<string, BaseSchema<unknown>>>(shape: T) => new ObjectSchema(shape),
  optional: <T>(innerSchema: BaseSchema<T>) => new OptionalSchema(innerSchema),
  union: <T extends BaseSchema<unknown>[]>(...schemas: T) => new UnionSchema(schemas),
  literal: <T extends string | number | boolean>(value: T) => new LiteralSchema(value),
  enum: <T extends string[]>(...values: T) => new EnumSchema(values),
  any: () => new AnySchema(),
};

// ============================================
// MARKDOWN
// ============================================
export const markdown = {
  toHtml: (md: string): string => {
    let html = md;
    html = html.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^######\s+(.+)$/gm, '<h6>$1</h6>');
    html = html.replace(/^#####\s+(.+)$/gm, '<h5>$1</h5>');
    html = html.replace(/^####\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^###\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^##\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^#\s+(.+)$/gm, '<h1>$1</h1>');
    html = html.replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
    html = html.replace(/___(.+?)___/g, '<strong><em>$1</em></strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    html = html.replace(/_(.+?)_/g, '<em>$1</em>');
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code class="language-$1">$2</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2">');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');
    html = html.replace(/^\s*(\d+)\.\s+(.+)$/gm, '<li>$2</li>');
    html = html.replace(/^>\s+(.+)$/gm, '<blockquote>$1</blockquote>');
    html = html.replace(/^---+$/gm, '<hr>');
    html = html.replace(/^\*\*\*+$/gm, '<hr>');
    html = html.replace(/^(?!<[a-z]|$)(.+)$/gm, '<p>$1</p>');
    html = html.replace(/<p>(<(?:h[1-6]|ul|ol|li|blockquote|pre|hr)[^>]*>)/g, '$1');
    html = html.replace(/(<\/(?:h[1-6]|ul|ol|li|blockquote|pre)>)<\/p>/g, '$1');
    return html;
  },
  toText: (md: string): string => {
    let text = md;
    text = text.replace(/^#+\s+/gm, '');
    text = text.replace(/\*\*\*(.+?)\*\*\*/g, '$1');
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    text = text.replace(/\*(.+?)\*/g, '$1');
    text = text.replace(/___(.+?)___/g, '$1');
    text = text.replace(/__(.+?)__/g, '$1');
    text = text.replace(/_(.+?)_/g, '$1');
    text = text.replace(/```[\s\S]*?```/g, '');
    text = text.replace(/`([^`]+)`/g, '$1');
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1');
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
    text = text.replace(/^>\s+/gm, '');
    text = text.replace(/^\s*[-*]\s+/gm, '');
    text = text.replace(/^\s*\d+\.\s+/gm, '');
    text = text.replace(/^---+$/gm, '');
    text = text.replace(/^\*\*\*+$/gm, '');
    return text.trim();
  },
};

// ============================================
// STRING UTILITIES
// ============================================
export const str = {
  slugify: (text: string): string => {
    return text.toString().toLowerCase().trim()
      .replace(/\s+/g, '-')
      .replace(/[^\w\-]+/g, '')
      .replace(/\-\-+/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '');
  },
  pluralize: (word: string, count: number, plural?: string): string => {
    if (count === 1) return word;
    return plural || (word + 's');
  },
  titleCase: (text: string): string => {
    return text.replace(/\w\S*/g, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );
  },
  escapeHtml: (text: string): string => {
    const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    return text.replace(/[&<>"']/g, c => escapes[c]);
  },
  unescapeHtml: (text: string): string => {
    const unescapes: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };
    return text.replace(/&(?:amp|lt|gt|quot|#39);/g, m => unescapes[m]);
  },
  wordCount: (text: string): number => {
    return text.trim().split(/\s+/).filter(Boolean).length;
  },
  truncateWords: (text: string, count: number, suffix = '...'): string => {
    const words = text.trim().split(/\s+/);
    if (words.length <= count) return text;
    return words.slice(0, count).join(' ') + suffix;
  },
  random: (length: number, charset = 'alphanumeric'): string => {
    const charsets: Record<string, string> = {
      alphanumeric: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
      alpha: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
      numeric: '0123456789',
      hex: '0123456789abcdef',
    };
    const chars = charsets[charset] || charset;
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  },
};

// ============================================
// JWT (decode only)
// ============================================
export const jwt = {
  decode: (token: string): { header: Record<string, unknown>; payload: Record<string, unknown> } | null => {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      const header = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return { header: header, payload: payload };
    } catch {
      return null;
    }
  },
  isExpired: (token: string): boolean => {
    const decoded = jwt.decode(token);
    if (!decoded) return true;
    const exp = decoded.payload.exp as number | undefined;
    if (!exp) return false;
    return exp * 1000 < Date.now();
  },
  getExpiration: (token: string): Date | null => {
    const decoded = jwt.decode(token);
    if (!decoded) return null;
    const exp = decoded.payload.exp as number | undefined;
    if (!exp) return null;
    return new Date(exp * 1000);
  },
};

// ============================================
// HTTP RESPONSE HELPERS
// ============================================
export const http = {
  json: (data: unknown, status = 200, headers: Record<string, string> = {}): Response => {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...headers },
    });
  },
  text: (data: string, status = 200, headers: Record<string, string> = {}): Response => {
    return new Response(data, {
      status,
      headers: { 'Content-Type': 'text/plain', ...headers },
    });
  },
  html: (data: string, status = 200, headers: Record<string, string> = {}): Response => {
    return new Response(data, {
      status,
      headers: { 'Content-Type': 'text/html', ...headers },
    });
  },
  redirect: (url: string, status = 302): Response => {
    return new Response(null, { status, headers: { Location: url } });
  },
  error: (message: string, status = 400, details?: unknown): Response => {
    return new Response(JSON.stringify({ error: message, details: details }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
