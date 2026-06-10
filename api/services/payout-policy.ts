// Monthly payout policy helpers.
// Payouts process on the first business day of the month, and requests must
// arrive at least 21 days before that run to be included.

export const PAYOUT_POLICY_VERSION = 1;
export const PAYOUT_REQUEST_CUTOFF_DAYS = 21;

export interface PayoutSchedule {
  releaseAt: Date;
  scheduledPayoutDate: string;
  payoutCutoffAt: Date;
  payoutPolicyVersion: number;
  requestCutoffDays: number;
}

export interface PayoutScheduleOptions {
  policyVersion?: number;
  cutoffDays?: number;
}

function utcDate(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function observedFixedHoliday(
  year: number,
  monthIndex: number,
  dayOfMonth: number,
): string {
  const date = utcDate(year, monthIndex, dayOfMonth);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return formatUtcDate(date);
}

function nthUtcWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
  nth: number,
): string {
  const date = utcDate(year, monthIndex, 1);
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  date.setUTCDate(date.getUTCDate() + (nth - 1) * 7);
  return formatUtcDate(date);
}

function lastUtcWeekdayOfMonth(
  year: number,
  monthIndex: number,
  weekday: number,
): string {
  const date = utcDate(year, monthIndex + 1, 0);
  while (date.getUTCDay() !== weekday) {
    date.setUTCDate(date.getUTCDate() - 1);
  }
  return formatUtcDate(date);
}

function usBankHolidaysForYear(year: number): Set<string> {
  return new Set([
    observedFixedHoliday(year, 0, 1), // New Year's Day
    nthUtcWeekdayOfMonth(year, 0, 1, 3), // Martin Luther King Jr. Day
    nthUtcWeekdayOfMonth(year, 1, 1, 3), // Washington's Birthday
    lastUtcWeekdayOfMonth(year, 4, 1), // Memorial Day
    observedFixedHoliday(year, 5, 19), // Juneteenth
    observedFixedHoliday(year, 6, 4), // Independence Day
    nthUtcWeekdayOfMonth(year, 8, 1, 1), // Labor Day
    nthUtcWeekdayOfMonth(year, 9, 1, 2), // Columbus Day
    observedFixedHoliday(year, 10, 11), // Veterans Day
    nthUtcWeekdayOfMonth(year, 10, 4, 4), // Thanksgiving Day
    observedFixedHoliday(year, 11, 25), // Christmas Day
  ]);
}

export function isUsBankHoliday(date: Date): boolean {
  const dateKey = formatUtcDate(date);
  const year = date.getUTCFullYear();
  return usBankHolidaysForYear(year - 1).has(dateKey) ||
    usBankHolidaysForYear(year).has(dateKey) ||
    usBankHolidaysForYear(year + 1).has(dateKey);
}

export function isUtcBusinessDay(date: Date): boolean {
  const day = date.getUTCDay();
  return day !== 0 && day !== 6 && !isUsBankHoliday(date);
}

export function firstUtcBusinessDayOfMonth(
  year: number,
  monthIndex: number,
): Date {
  const date = utcDate(year, monthIndex, 1);
  while (!isUtcBusinessDay(date)) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date;
}

function addUtcMonths(date: Date, months: number): Date {
  return utcDate(date.getUTCFullYear(), date.getUTCMonth() + months, 1);
}

export function calculateNextPayoutSchedule(
  requestedAt = new Date(),
  options: PayoutScheduleOptions = {},
): PayoutSchedule {
  if (Number.isNaN(requestedAt.getTime())) {
    throw new Error("requestedAt must be a valid date");
  }

  const policyVersion = options.policyVersion ?? PAYOUT_POLICY_VERSION;
  const cutoffDays = options.cutoffDays ?? PAYOUT_REQUEST_CUTOFF_DAYS;
  if (!Number.isInteger(cutoffDays) || cutoffDays <= 0) {
    throw new Error("cutoffDays must be a positive integer");
  }

  let candidateMonth = addUtcMonths(requestedAt, 1);
  for (let i = 0; i < 24; i++) {
    const releaseAt = firstUtcBusinessDayOfMonth(
      candidateMonth.getUTCFullYear(),
      candidateMonth.getUTCMonth(),
    );
    const payoutCutoffAt = new Date(releaseAt.getTime());
    payoutCutoffAt.setUTCDate(payoutCutoffAt.getUTCDate() - cutoffDays);

    if (requestedAt.getTime() <= payoutCutoffAt.getTime()) {
      return {
        releaseAt,
        scheduledPayoutDate: formatUtcDate(releaseAt),
        payoutCutoffAt,
        payoutPolicyVersion: policyVersion,
        requestCutoffDays: cutoffDays,
      };
    }

    candidateMonth = addUtcMonths(candidateMonth, 1);
  }

  throw new Error("Unable to calculate the next payout schedule");
}

export function buildPayoutPolicyMessage(schedule: PayoutSchedule): string {
  return `Scheduled for the ${schedule.scheduledPayoutDate} payout run. ` +
    `Requests must be submitted at least ${schedule.requestCutoffDays} days ` +
    `before a monthly run; later requests roll to the next eligible month.`;
}
