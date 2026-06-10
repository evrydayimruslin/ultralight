import {
  normalizeOptionalString,
  readJsonObject,
  RequestValidationError,
} from './request-validation.ts';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_LIGHT_AMOUNT = 100_000_000;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NOTE_LENGTH = 4000;
const MAX_BID_EXPIRY_HOURS = 24 * 30;

export interface MarketplaceBidPayload {
  appId: string;
  amountLight: number;
  message?: string;
  expiresInHours?: number;
}

export interface MarketplaceAskPayload {
  appId: string;
  priceLight: number | null;
  floorLight?: number | null;
  instantBuy: boolean;
  note?: string;
}

export interface MarketplaceBidActionPayload {
  bidId: string;
}

export interface MarketplaceBuyPayload {
  appId: string;
}

export interface MarketplaceMetricsVisibilityPayload {
  appId: string;
  showMetrics: boolean;
}

function normalizeRequiredString(value: unknown, field: string, maxLength: number): string {
  const normalized = normalizeOptionalString(value, field, { maxLength });
  if (!normalized) {
    throw new RequestValidationError(`Missing ${field}`);
  }
  return normalized;
}

function normalizeUuid(value: unknown, field: string): string {
  const normalized = normalizeRequiredString(value, field, 128);
  if (!UUID_REGEX.test(normalized)) {
    throw new RequestValidationError(`${field} must be a valid UUID`);
  }
  return normalized;
}

function normalizeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RequestValidationError(`${field} must be an integer`);
  }
  return value;
}

function normalizePositiveInteger(
  value: unknown,
  field: string,
  {
    max = MAX_LIGHT_AMOUNT,
    min = 1,
  }: {
    max?: number;
    min?: number;
  } = {},
): number {
  const normalized = normalizeInteger(value, field);
  if (normalized < min) {
    throw new RequestValidationError(`${field} must be at least ${min}`);
  }
  if (normalized > max) {
    throw new RequestValidationError(`${field} must be ${max} or less`);
  }
  return normalized;
}

function normalizeNullablePositiveInteger(value: unknown, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return normalizePositiveInteger(value, field);
}

export async function validateMarketplaceBidRequest(request: Request): Promise<MarketplaceBidPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['app_id', 'amount_light', 'message', 'expires_in_hours'],
  });

  return {
    appId: normalizeUuid(body.app_id, 'app_id'),
    amountLight: normalizePositiveInteger(body.amount_light, 'amount_light'),
    message: normalizeOptionalString(body.message, 'message', {
      maxLength: MAX_MESSAGE_LENGTH,
    }),
    expiresInHours: body.expires_in_hours === undefined
      ? undefined
      : normalizePositiveInteger(body.expires_in_hours, 'expires_in_hours', {
        max: MAX_BID_EXPIRY_HOURS,
      }),
  };
}

export async function validateMarketplaceAskRequest(request: Request): Promise<MarketplaceAskPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['app_id', 'price_light', 'floor_light', 'instant_buy', 'note'],
  });

  if (body.instant_buy !== undefined && typeof body.instant_buy !== 'boolean') {
    throw new RequestValidationError('instant_buy must be a boolean');
  }

  const priceLight = normalizeNullablePositiveInteger(body.price_light, 'price_light');
  const floorLight = normalizeNullablePositiveInteger(body.floor_light, 'floor_light');
  const instantBuy = body.instant_buy === undefined ? false : body.instant_buy;

  if (instantBuy && (priceLight === null || priceLight === undefined)) {
    throw new RequestValidationError('price_light is required when instant_buy is enabled');
  }
  if (
    priceLight !== null &&
    priceLight !== undefined &&
    floorLight !== null &&
    floorLight !== undefined &&
    floorLight > priceLight
  ) {
    throw new RequestValidationError('floor_light cannot exceed price_light');
  }

  return {
    appId: normalizeUuid(body.app_id, 'app_id'),
    priceLight: priceLight ?? null,
    floorLight,
    instantBuy,
    note: normalizeOptionalString(body.note, 'note', {
      maxLength: MAX_NOTE_LENGTH,
    }),
  };
}

export async function validateMarketplaceBidActionRequest(
  request: Request,
): Promise<MarketplaceBidActionPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['bid_id'],
  });

  return {
    bidId: normalizeUuid(body.bid_id, 'bid_id'),
  };
}

export async function validateMarketplaceBuyRequest(request: Request): Promise<MarketplaceBuyPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['app_id'],
  });

  return {
    appId: normalizeUuid(body.app_id, 'app_id'),
  };
}

export async function validateMarketplaceMetricsVisibilityRequest(
  request: Request,
): Promise<MarketplaceMetricsVisibilityPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['app_id', 'show_metrics'],
  });

  if (typeof body.show_metrics !== 'boolean') {
    throw new RequestValidationError('show_metrics must be a boolean');
  }

  return {
    appId: normalizeUuid(body.app_id, 'app_id'),
    showMetrics: body.show_metrics,
  };
}
