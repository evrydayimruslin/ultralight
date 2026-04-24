export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LoggerLike {
  debug: (message: string, context?: Record<string, unknown>) => void;
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, context?: Record<string, unknown>) => void;
}

interface ConsoleLike {
  debug?: (...args: unknown[]) => void;
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
  log?: (...args: unknown[]) => void;
}

interface CreateServerLoggerOptions {
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

export function sanitizeLogContext(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeLogContext(entry, seen));
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
    sanitized[key] = shouldRedactKey(key) ? REDACTED : sanitizeLogContext(entry, seen);
  }
  return sanitized;
}

export function buildServerLogRecord(
  scope: string,
  level: LogLevel,
  message: string,
  context?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ts: new Date().toISOString(),
    level,
    scope,
    message,
    context: context ? sanitizeLogContext(context) : undefined,
  };
}

export function createServerLogger(
  scope: string,
  options: CreateServerLoggerOptions = {},
): LoggerLike {
  const sink = options.sink ?? console;
  const debugEnabled = options.debugEnabled ?? false;

  const emit = (level: LogLevel, message: string, context?: Record<string, unknown>): void => {
    if (level === 'debug' && !debugEnabled) {
      return;
    }

    const record = buildServerLogRecord(scope, level, message, context);
    const sinkMethod =
      (level === 'debug' ? sink.debug : sink[level]) ??
      (level === 'error' ? sink.error : sink.log) ??
      console.log;

    sinkMethod(`[${scope}]`, JSON.stringify(record));
  };

  return {
    debug: (message, context) => emit('debug', message, context),
    info: (message, context) => emit('info', message, context),
    warn: (message, context) => emit('warn', message, context),
    error: (message, context) => emit('error', message, context),
  };
}
