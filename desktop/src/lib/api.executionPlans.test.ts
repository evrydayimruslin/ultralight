import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./storage', () => ({
  getApiBase: () => 'https://api.ultralight.dev',
  getToken: () => 'desktop-test-token',
  fetchFromApi: (path: string, init?: RequestInit) => fetch(`https://api.ultralight.dev${path}`, init),
}));

describe('execution plan API helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('confirms execution plans with auth headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { confirmExecutionPlan } = await import('./api');
    await confirmExecutionPlan('plan-123');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.ultralight.dev/chat/plan/plan-123/confirm',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer desktop-test-token',
          'Content-Type': 'application/json',
        }),
      }),
    );
  });

  it('surfaces structured request errors for expired confirmations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: 'Execution plan expired',
      detail: 'expired in KV gate',
    }), {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { confirmExecutionPlan } = await import('./api');

    await expect(confirmExecutionPlan('plan-expired')).rejects.toMatchObject({
      name: 'ExecutionPlanRequestError',
      message: 'Execution plan expired',
      status: 410,
      detail: 'expired in KV gate',
    });
  });

  it('surfaces plain-text request errors for cancellation races', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('Execution plan already confirmed', {
      status: 409,
      headers: { 'Content-Type': 'text/plain' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { cancelExecutionPlan } = await import('./api');

    await expect(cancelExecutionPlan('plan-race')).rejects.toMatchObject({
      name: 'ExecutionPlanRequestError',
      message: 'Execution plan already confirmed',
      status: 409,
      detail: 'Execution plan already confirmed',
    });
  });
});
