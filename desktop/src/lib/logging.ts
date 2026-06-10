type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ConsoleLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
}

interface CreateDesktopLoggerOptions {
  sink?: ConsoleLike;
  debugEnabled?: boolean;
}

const REDACTED = '[REDACTED]';
const REDACTED_KEY_PATTERNS = [
  /authorization/i,
  /cookie/i,
  /token/i,
  /secret/i,
  /password/i,
  /api[-_]?key/i,
  /service[-_]?key/i,
  /refresh[-_]?token/i,
  /email/i,
  /phone/i,
];

function shouldRedactKey(key: string): boolean {
  return REDACTED_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

export function sanitizeDesktopLogContext(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return value;

  if (value instanceof Error) {
    return { name: value.name, message: value.message };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDesktopLogContext(entry, seen));
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return '[Circular]';
  }
  seen.add(value);

  const sanitized: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    sanitized[key] = shouldRedactKey(key) ? REDACTED : sanitizeDesktopLogContext(entry, seen);
  }
  return sanitized;
}

function defaultDebugEnabled(): boolean {
  if (import.meta.env?.DEV) {
    return true;
  }

  try {
    return globalThis.localStorage?.getItem('ul_debug_logs') === '1';
  } catch {
    return false;
  }
}

export function createDesktopLogger(
  scope: string,
  options: CreateDesktopLoggerOptions = {},
) {
  const sink = options.sink ?? console;
  const debugEnabled = options.debugEnabled ?? defaultDebugEnabled();

  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (level === 'debug' && !debugEnabled) {
      return;
    }

    const sinkMethod =
      (level === 'debug' ? sink.debug : sink[level]) ??
      (level === 'error' ? sink.error : sink.log) ??
      console.log;

    if (context && Object.keys(context).length > 0) {
      sinkMethod(`[${scope}] ${message}`, sanitizeDesktopLogContext(context));
      return;
    }

    sinkMethod(`[${scope}] ${message}`);
  };

  return {
    debug: (message: string, context?: Record<string, unknown>) => emit('debug', message, context),
    info: (message: string, context?: Record<string, unknown>) => emit('info', message, context),
    warn: (message: string, context?: Record<string, unknown>) => emit('warn', message, context),
    error: (message: string, context?: Record<string, unknown>) => emit('error', message, context),
  };
}
