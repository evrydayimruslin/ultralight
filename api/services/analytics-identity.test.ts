import {
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
} from 'https://deno.land/std@0.210.0/assert/mod.ts';
import { getAnalyticsIdentity, isExplicitlyDisabled, sha256Text } from './analytics-identity.ts';

Deno.test('analytics identity: HMAC pseudonym is stable and hides raw user id', async () => {
  const first = await getAnalyticsIdentity('user-123', {
    pepper: 'test-pepper',
  });
  const second = await getAnalyticsIdentity('user-123', {
    pepper: 'test-pepper',
  });
  const third = await getAnalyticsIdentity('user-456', {
    pepper: 'test-pepper',
  });

  assertEquals(first.anonUserId, second.anonUserId);
  assertNotEquals(first.anonUserId, third.anonUserId);
  assertStringIncludes(first.anonUserId, 'anon_');
  assertEquals(first.anonUserId.includes('user-123'), false);
});

Deno.test('analytics identity: capture disable flag normalization', () => {
  assertEquals(isExplicitlyDisabled('false'), true);
  assertEquals(isExplicitlyDisabled('OFF'), true);
  assertEquals(isExplicitlyDisabled('1'), false);
  assertEquals(isExplicitlyDisabled(undefined), false);
});

Deno.test('analytics identity: sha256 text helper is deterministic', async () => {
  assertEquals(
    await sha256Text('ultralight'),
    await sha256Text('ultralight'),
  );
  assertNotEquals(
    await sha256Text('ultralight'),
    await sha256Text('Ultralight'),
  );
});
