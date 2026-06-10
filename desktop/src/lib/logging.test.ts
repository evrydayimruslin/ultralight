import { describe, expect, it, vi } from 'vitest';

import { createDesktopLogger, sanitizeDesktopLogContext } from './logging';

describe('desktop logging', () => {
  it('redacts sensitive fields in nested context objects', () => {
    expect(
      sanitizeDesktopLogContext({
        access_token: 'secret-token',
        nested: {
          user_email: 'user@example.com',
          cookie: 'session=abc',
        },
      }),
    ).toEqual({
      access_token: '[REDACTED]',
      nested: {
        user_email: '[REDACTED]',
        cookie: '[REDACTED]',
      },
    });
  });

  it('suppresses debug logs by default and emits structured warnings', () => {
    const warn = vi.fn();
    const debug = vi.fn();
    const logger = createDesktopLogger('agentStateSummary', {
      sink: { warn, debug, log: vi.fn(), error: vi.fn(), info: vi.fn() },
      debugEnabled: false,
    });

    logger.debug('debug only', { access_token: 'secret-token' });
    logger.warn('Generation failed', { access_token: 'secret-token' });

    expect(debug).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith('[agentStateSummary] Generation failed', {
      access_token: '[REDACTED]',
    });
  });
});
