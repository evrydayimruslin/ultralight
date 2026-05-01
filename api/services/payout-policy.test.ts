import { assertEquals } from "https://deno.land/std@0.210.0/assert/assert_equals.ts";
import { assertThrows } from "https://deno.land/std@0.210.0/assert/assert_throws.ts";

import {
  calculateNextPayoutSchedule,
  firstUtcBusinessDayOfMonth,
  isUsBankHoliday,
  isUtcBusinessDay,
  PAYOUT_POLICY_VERSION,
  PAYOUT_REQUEST_CUTOFF_DAYS,
} from "./payout-policy.ts";

Deno.test("payout policy: first business day skips weekends", () => {
  assertEquals(
    firstUtcBusinessDayOfMonth(2026, 4).toISOString(),
    "2026-05-01T00:00:00.000Z",
  );
  assertEquals(
    firstUtcBusinessDayOfMonth(2026, 7).toISOString(),
    "2026-08-03T00:00:00.000Z",
  );
  assertEquals(isUtcBusinessDay(new Date("2026-08-01T00:00:00Z")), false);
  assertEquals(isUtcBusinessDay(new Date("2026-08-03T00:00:00Z")), true);
});

Deno.test("payout policy: first business day skips US bank holidays", () => {
  assertEquals(isUsBankHoliday(new Date("2027-01-01T00:00:00Z")), true);
  assertEquals(
    firstUtcBusinessDayOfMonth(2027, 0).toISOString(),
    "2027-01-04T00:00:00.000Z",
  );
});

Deno.test("payout policy: request before cutoff joins the next monthly run", () => {
  const schedule = calculateNextPayoutSchedule(
    new Date("2026-01-05T12:00:00Z"),
  );

  assertEquals(schedule.releaseAt.toISOString(), "2026-02-02T00:00:00.000Z");
  assertEquals(schedule.scheduledPayoutDate, "2026-02-02");
  assertEquals(
    schedule.payoutCutoffAt.toISOString(),
    "2026-01-12T00:00:00.000Z",
  );
  assertEquals(schedule.requestCutoffDays, PAYOUT_REQUEST_CUTOFF_DAYS);
  assertEquals(schedule.payoutPolicyVersion, PAYOUT_POLICY_VERSION);
});

Deno.test("payout policy: request after cutoff rolls to following month", () => {
  const schedule = calculateNextPayoutSchedule(
    new Date("2026-01-12T00:00:01Z"),
  );

  assertEquals(schedule.releaseAt.toISOString(), "2026-03-02T00:00:00.000Z");
  assertEquals(schedule.scheduledPayoutDate, "2026-03-02");
  assertEquals(
    schedule.payoutCutoffAt.toISOString(),
    "2026-02-09T00:00:00.000Z",
  );
});

Deno.test("payout policy: exact cutoff timestamp is included", () => {
  const schedule = calculateNextPayoutSchedule(
    new Date("2026-01-12T00:00:00Z"),
  );

  assertEquals(schedule.releaseAt.toISOString(), "2026-02-02T00:00:00.000Z");
});

Deno.test("payout policy: invalid inputs fail closed", () => {
  assertThrows(
    () => calculateNextPayoutSchedule(new Date("not-a-date")),
    Error,
    "requestedAt must be a valid date",
  );
  assertThrows(
    () =>
      calculateNextPayoutSchedule(new Date("2026-01-01T00:00:00Z"), {
        cutoffDays: 0,
      }),
    Error,
    "cutoffDays must be a positive integer",
  );
});
