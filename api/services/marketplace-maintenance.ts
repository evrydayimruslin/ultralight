import { getEnv } from '../lib/env.ts';
import { createServerLogger } from './logging.ts';

export interface ExpireMarketplaceBidsResult {
  expired_count: number;
}

interface ExpireMarketplaceBidsDeps {
  fetchFn?: typeof fetch;
  supabaseUrl?: string;
  serviceRoleKey?: string;
  logger?: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
  };
}

const marketplaceMaintenanceLogger = createServerLogger('MARKETPLACE-MAINT');

export async function expireMarketplaceBids(
  deps: ExpireMarketplaceBidsDeps = {},
): Promise<ExpireMarketplaceBidsResult> {
  const fetchFn = deps.fetchFn || fetch;
  const supabaseUrl = deps.supabaseUrl || getEnv('SUPABASE_URL');
  const serviceRoleKey = deps.serviceRoleKey || getEnv('SUPABASE_SERVICE_ROLE_KEY');
  const logger = deps.logger || marketplaceMaintenanceLogger;

  const res = await fetchFn(`${supabaseUrl}/rest/v1/rpc/expire_old_bids`, {
    method: 'POST',
    headers: {
      'apikey': serviceRoleKey,
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    logger.error('Failed to expire marketplace bids', {
      status: res.status,
      error: errText,
    });
    throw new Error('Failed to expire marketplace bids');
  }

  const expiredCount = await res.json() as number;
  if (expiredCount > 0) {
    logger.info('Expired marketplace bids', { expired_count: expiredCount });
  }

  return { expired_count: expiredCount };
}
