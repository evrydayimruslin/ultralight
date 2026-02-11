// Subscription Expiry Service
// Checks for expired subscriptions and downgrades users.
// - Sets tier to 'free'
// - Sets public apps to 'unlisted' (soft degradation — shared links still work)
// - Clears tier_expires_at
// - Runs hourly via setInterval in main.ts

// @ts-ignore
const Deno = globalThis.Deno;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';

interface ExpiredUser {
  id: string;
  email: string;
  tier: string;
}

interface ExpiryResult {
  usersProcessed: number;
  appsUnlisted: number;
  errors: string[];
  details: { userId: string; previousTier: string; appsChanged: number }[];
}

/**
 * Check for and process expired subscriptions.
 *
 * 1. Query users where tier_expires_at < NOW() and tier != 'free'
 * 2. For each: downgrade to free, set public apps to unlisted
 * 3. Log results
 */
export async function processExpiredSubscriptions(): Promise<ExpiryResult> {
  const result: ExpiryResult = {
    usersProcessed: 0,
    appsUnlisted: 0,
    errors: [],
    details: [],
  };

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.warn('[EXPIRY] Supabase not configured, skipping');
    return result;
  }

  try {
    // 1. Find all expired users (tier != free, tier_expires_at in the past)
    const expiredResponse = await fetch(
      `${SUPABASE_URL}/rest/v1/users?tier=neq.free&tier_expires_at=lt.${new Date().toISOString()}&tier_expires_at=not.is.null&select=id,email,tier`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_ROLE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );

    if (!expiredResponse.ok) {
      const err = await expiredResponse.text();
      result.errors.push(`Failed to query expired users: ${err}`);
      console.error('[EXPIRY] Query failed:', err);
      return result;
    }

    const expiredUsers: ExpiredUser[] = await expiredResponse.json();

    if (expiredUsers.length === 0) {
      return result; // Nothing to do — silent return
    }

    console.log(`[EXPIRY] Found ${expiredUsers.length} expired subscription(s)`);

    // 2. Process each expired user
    for (const user of expiredUsers) {
      try {
        // 2a. Set public apps to unlisted (soft degradation)
        //     Only affects 'public' apps — unlisted and private stay as-is
        const appsResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user.id}&deleted_at=is.null&visibility=eq.public&select=id,name`,
          {
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            },
          }
        );

        let appsChanged = 0;

        if (appsResponse.ok) {
          const publicApps = await appsResponse.json();

          if (publicApps.length > 0) {
            const updateResponse = await fetch(
              `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${user.id}&deleted_at=is.null&visibility=eq.public`,
              {
                method: 'PATCH',
                headers: {
                  'apikey': SUPABASE_SERVICE_ROLE_KEY,
                  'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                  'Content-Type': 'application/json',
                  'Prefer': 'return=minimal',
                },
                body: JSON.stringify({
                  visibility: 'unlisted',
                  updated_at: new Date().toISOString(),
                }),
              }
            );

            if (updateResponse.ok) {
              appsChanged = publicApps.length;
              result.appsUnlisted += appsChanged;
              console.log(
                `[EXPIRY] User ${user.id}: ${appsChanged} app(s) set to unlisted: ` +
                publicApps.map((a: { name: string }) => a.name).join(', ')
              );
            } else {
              const err = await updateResponse.text();
              result.errors.push(`Failed to update apps for ${user.id}: ${err}`);
            }
          }
        }

        // 2b. Downgrade user to free tier, clear expiry
        const tierUpdateResponse = await fetch(
          `${SUPABASE_URL}/rest/v1/users?id=eq.${user.id}`,
          {
            method: 'PATCH',
            headers: {
              'apikey': SUPABASE_SERVICE_ROLE_KEY,
              'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              tier: 'free',
              tier_expires_at: null,
              updated_at: new Date().toISOString(),
            }),
          }
        );

        if (tierUpdateResponse.ok) {
          result.usersProcessed++;
          result.details.push({
            userId: user.id,
            previousTier: user.tier,
            appsChanged,
          });
          console.log(
            `[EXPIRY] User ${user.id}: ${user.tier} -> free (${appsChanged} apps unlisted)`
          );
        } else {
          const err = await tierUpdateResponse.text();
          result.errors.push(`Failed to downgrade ${user.id}: ${err}`);
          console.error(`[EXPIRY] Failed to downgrade ${user.id}:`, err);
        }
      } catch (userErr) {
        const msg = userErr instanceof Error ? userErr.message : String(userErr);
        result.errors.push(`Error processing ${user.id}: ${msg}`);
        console.error(`[EXPIRY] Error processing ${user.id}:`, msg);
      }
    }

    if (result.usersProcessed > 0) {
      console.log(
        `[EXPIRY] Complete: ${result.usersProcessed} user(s) downgraded, ` +
        `${result.appsUnlisted} app(s) unlisted, ${result.errors.length} error(s)`
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`Fatal error: ${msg}`);
    console.error('[EXPIRY] Fatal error:', msg);
  }

  return result;
}

/**
 * Start the subscription expiry checker.
 * Runs immediately on startup, then every hour.
 */
export function startSubscriptionExpiryChecker(): void {
  const INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  console.log('[EXPIRY] Starting subscription expiry checker (hourly)');

  // Run on startup (after a short delay to let the server initialize)
  setTimeout(async () => {
    try {
      await processExpiredSubscriptions();
    } catch (err) {
      console.error('[EXPIRY] Startup check failed:', err);
    }
  }, 10_000); // 10 second delay

  // Then run every hour
  setInterval(async () => {
    try {
      await processExpiredSubscriptions();
    } catch (err) {
      console.error('[EXPIRY] Scheduled check failed:', err);
    }
  }, INTERVAL_MS);
}
