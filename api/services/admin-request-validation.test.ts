import { assertEquals } from 'https://deno.land/std@0.210.0/assert/assert_equals.ts';
import { assertRejects } from 'https://deno.land/std@0.210.0/assert/assert_rejects.ts';

import {
  validateApproveAssessmentRequest,
  validateCreateGapRequest,
  validateRecordAssessmentRequest,
  validateSetAppCategoryRequest,
  validateSetAppFeaturedRequest,
  validateTopUpBalanceRequest,
  validateUpdateBillingConfigRequest,
  validateUpdateGapRequest,
} from './admin-request-validation.ts';
import { RequestValidationError } from './request-validation.ts';

Deno.test('admin request validation: create gap normalizes severity and source ids', async () => {
  const payload = await validateCreateGapRequest(
    new Request('https://example.com/api/admin/gaps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'Launch blocker',
        description: 'A serious platform issue',
        severity: 'high',
        points_value: 250,
        season: 2,
        source_shortcoming_ids: [
          '11111111-1111-4111-8111-111111111111',
          '11111111-1111-4111-8111-111111111111',
        ],
        source_query_ids: ['22222222-2222-4222-8222-222222222222'],
      }),
    }),
  );

  assertEquals(payload, {
    title: 'Launch blocker',
    description: 'A serious platform issue',
    severity: 'high',
    pointsValue: 250,
    season: 2,
    sourceShortcomingIds: ['11111111-1111-4111-8111-111111111111'],
    sourceQueryIds: ['22222222-2222-4222-8222-222222222222'],
  });
});

Deno.test('admin request validation: billing config accepts rates and policy copy', async () => {
  const payload = await validateUpdateBillingConfigRequest(
    new Request('https://example.com/api/admin/billing-config', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        canonical_light_per_usd: 100,
        wallet_light_per_usd: 95,
        wire_light_per_usd: 99,
        payout_light_per_usd: 100,
        platform_fee_rate: 0.1,
        min_withdrawal_light: 5000,
        payout_policy_copy: 'Payouts run monthly.',
      }),
    }),
  );

  assertEquals(payload, {
    canonical_light_per_usd: 100,
    wallet_light_per_usd: 95,
    wire_light_per_usd: 99,
    payout_light_per_usd: 100,
    platform_fee_rate: 0.1,
    min_withdrawal_light: 5000,
    payout_policy_copy: 'Payouts run monthly.',
  });

  await assertRejects(
    () =>
      validateUpdateBillingConfigRequest(
        new Request('https://example.com/api/admin/billing-config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ wallet_light_per_usd: 95.5 }),
        }),
      ),
    RequestValidationError,
    'wallet_light_per_usd must be an integer Light-per-USD rate',
  );

  await assertRejects(
    () =>
      validateUpdateBillingConfigRequest(
        new Request('https://example.com/api/admin/billing-config', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ),
    RequestValidationError,
    'At least one billing config field is required',
  );
});

Deno.test('admin request validation: update gap rejects empty and validates status', async () => {
  await assertRejects(
    () =>
      validateUpdateGapRequest(
        new Request('https://example.com/api/admin/gaps/id', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ),
    RequestValidationError,
    'At least one gap field is required',
  );

  const payload = await validateUpdateGapRequest(
    new Request('https://example.com/api/admin/gaps/id', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'fulfilled',
        fulfilled_by_app_id: '33333333-3333-4333-8333-333333333333',
        fulfilled_by_user_id: null,
      }),
    }),
  );

  assertEquals(payload, {
    status: 'fulfilled',
    fulfilledByAppId: '33333333-3333-4333-8333-333333333333',
    fulfilledByUserId: null,
  });
});

Deno.test('admin request validation: assessment updates require at least one field', async () => {
  await assertRejects(
    () =>
      validateRecordAssessmentRequest(
        new Request('https://example.com/api/admin/assess/id', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
      ),
    RequestValidationError,
    'At least one of agent_score, agent_notes, proposed_points required',
  );

  const payload = await validateRecordAssessmentRequest(
    new Request('https://example.com/api/admin/assess/id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_score: 92,
        proposed_points: 400,
      }),
    }),
  );

  assertEquals(payload, {
    agentScore: 92,
    proposedPoints: 400,
  });
});

Deno.test('admin request validation: approve assessment, topup, and app curation are strongly typed', async () => {
  const approvePayload = await validateApproveAssessmentRequest(
    new Request('https://example.com/api/admin/approve/id', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        awarded_points: 500,
        reviewed_by: 'launch-admin',
      }),
    }),
  );
  assertEquals(approvePayload, {
    awardedPoints: 500,
    reviewedBy: 'launch-admin',
  });

  const topupPayload = await validateTopUpBalanceRequest(
    new Request('https://example.com/api/admin/balance/user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount_light: 2500 }),
    }),
  );
  assertEquals(topupPayload, { amountLight: 2500 });

  const categoryPayload = await validateSetAppCategoryRequest(
    new Request('https://example.com/api/admin/apps/id/category', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category: 'ops' }),
    }),
  );
  assertEquals(categoryPayload, { category: 'ops' });

  const featuredPayload = await validateSetAppFeaturedRequest(
    new Request('https://example.com/api/admin/apps/id/featured', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ featured: true }),
    }),
  );
  assertEquals(featuredPayload, { featured: true });

  await assertRejects(
    () =>
      validateSetAppFeaturedRequest(
        new Request('https://example.com/api/admin/apps/id/featured', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ featured: 'yes' }),
        }),
      ),
    RequestValidationError,
    'featured must be a boolean',
  );
});
