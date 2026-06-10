export type PlatformFailureCode =
  | 'service_unavailable'
  | 'integrity_blocked'
  | 'quota_exceeded'
  | 'insufficient_balance'
  | 'permission_denied'
  | 'rate_limited';

export class PlatformFailure extends Error {
  code: PlatformFailureCode;
  status: number;
  details?: unknown;

  constructor(
    code: PlatformFailureCode,
    message: string,
    options?: { status?: number; details?: unknown },
  ) {
    super(message);
    this.name = 'PlatformFailure';
    this.code = code;
    this.status = options?.status ?? 500;
    this.details = options?.details;
  }
}

export function createServiceUnavailableFailure(
  message: string,
  details?: unknown,
): PlatformFailure {
  return new PlatformFailure('service_unavailable', message, { status: 503, details });
}

export function createIntegrityBlockedFailure(
  message: string,
  details?: unknown,
): PlatformFailure {
  return new PlatformFailure('integrity_blocked', message, { status: 422, details });
}

export function isPlatformFailure(error: unknown): error is PlatformFailure {
  return error instanceof PlatformFailure;
}
