import {
  normalizeOptionalString,
  readJsonObject,
  RequestValidationError,
} from './request-validation.ts';

const GAP_SEVERITIES = new Set<CreateGapPayload['severity']>(['low', 'medium', 'high', 'critical']);
const GAP_STATUSES = new Set<NonNullable<UpdateGapPayload['status']>>(['open', 'claimed', 'fulfilled', 'closed']);
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const MAX_GAP_TITLE_LENGTH = 200;
const MAX_GAP_DESCRIPTION_LENGTH = 8000;
const MAX_AGENT_NOTES_LENGTH = 8000;
const MAX_REVIEWED_BY_LENGTH = 120;
const MAX_APP_CATEGORY_LENGTH = 64;
const MAX_POINTS_VALUE = 1_000_000;
const MAX_TOP_UP_LIGHT = 100_000_000;

export interface CreateGapPayload {
  title: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  pointsValue: number;
  season: number;
  sourceShortcomingIds: string[];
  sourceQueryIds: string[];
}

export interface UpdateGapPayload {
  title?: string;
  description?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  pointsValue?: number;
  season?: number;
  status?: 'open' | 'claimed' | 'fulfilled' | 'closed';
  sourceShortcomingIds?: string[];
  sourceQueryIds?: string[];
  fulfilledByAppId?: string | null;
  fulfilledByUserId?: string | null;
}

export interface RecordAssessmentPayload {
  agentScore?: number;
  agentNotes?: string;
  proposedPoints?: number;
}

export interface ApproveAssessmentPayload {
  awardedPoints?: number;
  reviewedBy?: string;
}

export interface TopUpBalancePayload {
  amountLight: number;
}

export interface SetAppCategoryPayload {
  category: string | null;
}

export interface SetAppFeaturedPayload {
  featured: boolean;
}

function normalizeRequiredString(value: unknown, field: string, maxLength: number): string {
  const normalized = normalizeOptionalString(value, field, { maxLength });
  if (!normalized) {
    throw new RequestValidationError(`Missing ${field}`);
  }
  return normalized;
}

function normalizeEnum<T extends string>(value: unknown, field: string, allowed: Set<T>): T {
  const normalized = normalizeRequiredString(value, field, 64);
  if (!allowed.has(normalized as T)) {
    throw new RequestValidationError(
      `${field} must be one of: ${Array.from(allowed).join(', ')}`,
    );
  }
  return normalized as T;
}

function normalizeOptionalEnum<T extends string>(value: unknown, field: string, allowed: Set<T>): T | undefined {
  const normalized = normalizeOptionalString(value, field, { maxLength: 64 });
  if (!normalized) {
    return undefined;
  }
  if (!allowed.has(normalized as T)) {
    throw new RequestValidationError(
      `${field} must be one of: ${Array.from(allowed).join(', ')}`,
    );
  }
  return normalized as T;
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
    min = 1,
    max = MAX_POINTS_VALUE,
  }: {
    min?: number;
    max?: number;
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

function normalizeOptionalPositiveInteger(
  value: unknown,
  field: string,
  options?: {
    min?: number;
    max?: number;
  },
): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return normalizePositiveInteger(value, field, options);
}

function normalizeOptionalUuid(value: unknown, field: string): string | undefined {
  const normalized = normalizeOptionalString(value, field, { maxLength: 128 });
  if (!normalized) {
    return undefined;
  }
  if (!UUID_REGEX.test(normalized)) {
    throw new RequestValidationError(`${field} must be a valid UUID`);
  }
  return normalized;
}

function normalizeNullableUuid(value: unknown, field: string): string | null | undefined {
  if (value === null) {
    return null;
  }
  return normalizeOptionalUuid(value, field);
}

function normalizeUuidArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${field} must be an array of UUIDs`);
  }

  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== 'string' || !UUID_REGEX.test(entry)) {
      throw new RequestValidationError(`${field} must contain only valid UUIDs`);
    }
    deduped.add(entry);
  }
  return Array.from(deduped);
}

function normalizeOptionalUuidArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }
  return normalizeUuidArray(value, field);
}

export async function validateCreateGapRequest(request: Request): Promise<CreateGapPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: [
      'title',
      'description',
      'severity',
      'points_value',
      'season',
      'source_shortcoming_ids',
      'source_query_ids',
    ],
  });

  return {
    title: normalizeRequiredString(body.title, 'title', MAX_GAP_TITLE_LENGTH),
    description: normalizeRequiredString(body.description, 'description', MAX_GAP_DESCRIPTION_LENGTH),
    severity: normalizeOptionalEnum(body.severity, 'severity', GAP_SEVERITIES) || 'medium',
    pointsValue: normalizeOptionalPositiveInteger(body.points_value, 'points_value') ?? 100,
    season: normalizeOptionalPositiveInteger(body.season, 'season', { max: 10_000 }) ?? 1,
    sourceShortcomingIds: normalizeUuidArray(body.source_shortcoming_ids, 'source_shortcoming_ids'),
    sourceQueryIds: normalizeUuidArray(body.source_query_ids, 'source_query_ids'),
  };
}

export async function validateUpdateGapRequest(request: Request): Promise<UpdateGapPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: [
      'title',
      'description',
      'severity',
      'points_value',
      'season',
      'status',
      'source_shortcoming_ids',
      'source_query_ids',
      'fulfilled_by_app_id',
      'fulfilled_by_user_id',
    ],
  });

  const payload: UpdateGapPayload = {};

  if (body.title !== undefined) {
    payload.title = normalizeRequiredString(body.title, 'title', MAX_GAP_TITLE_LENGTH);
  }
  if (body.description !== undefined) {
    payload.description = normalizeRequiredString(body.description, 'description', MAX_GAP_DESCRIPTION_LENGTH);
  }
  if (body.severity !== undefined) {
    payload.severity = normalizeEnum(body.severity, 'severity', GAP_SEVERITIES);
  }
  if (body.points_value !== undefined) {
    payload.pointsValue = normalizePositiveInteger(body.points_value, 'points_value');
  }
  if (body.season !== undefined) {
    payload.season = normalizePositiveInteger(body.season, 'season', { max: 10_000 });
  }
  if (body.status !== undefined) {
    payload.status = normalizeEnum(body.status, 'status', GAP_STATUSES);
  }
  if (body.source_shortcoming_ids !== undefined) {
    payload.sourceShortcomingIds = normalizeOptionalUuidArray(
      body.source_shortcoming_ids,
      'source_shortcoming_ids',
    );
  }
  if (body.source_query_ids !== undefined) {
    payload.sourceQueryIds = normalizeOptionalUuidArray(
      body.source_query_ids,
      'source_query_ids',
    );
  }
  if (body.fulfilled_by_app_id !== undefined) {
    payload.fulfilledByAppId = normalizeNullableUuid(body.fulfilled_by_app_id, 'fulfilled_by_app_id');
  }
  if (body.fulfilled_by_user_id !== undefined) {
    payload.fulfilledByUserId = normalizeNullableUuid(body.fulfilled_by_user_id, 'fulfilled_by_user_id');
  }

  if (Object.keys(payload).length === 0) {
    throw new RequestValidationError('At least one gap field is required');
  }

  return payload;
}

export async function validateRecordAssessmentRequest(request: Request): Promise<RecordAssessmentPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['agent_score', 'agent_notes', 'proposed_points'],
  });

  const payload: RecordAssessmentPayload = {};
  if (body.agent_score !== undefined) {
    payload.agentScore = normalizePositiveInteger(body.agent_score, 'agent_score', { min: 0, max: 100 });
  }
  if (body.agent_notes !== undefined) {
    payload.agentNotes = normalizeRequiredString(body.agent_notes, 'agent_notes', MAX_AGENT_NOTES_LENGTH);
  }
  if (body.proposed_points !== undefined) {
    payload.proposedPoints = normalizePositiveInteger(body.proposed_points, 'proposed_points');
  }

  if (Object.keys(payload).length === 0) {
    throw new RequestValidationError('At least one of agent_score, agent_notes, proposed_points required');
  }

  return payload;
}

export async function validateApproveAssessmentRequest(request: Request): Promise<ApproveAssessmentPayload> {
  const body = await readJsonObject(request, {
    allowEmptyBody: true,
    allowedKeys: ['awarded_points', 'reviewed_by'],
  });

  return {
    awardedPoints: normalizeOptionalPositiveInteger(body.awarded_points, 'awarded_points'),
    reviewedBy: normalizeOptionalString(body.reviewed_by, 'reviewed_by', {
      maxLength: MAX_REVIEWED_BY_LENGTH,
    }),
  };
}

export async function validateTopUpBalanceRequest(request: Request): Promise<TopUpBalancePayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['amount_light'],
  });

  return {
    amountLight: normalizePositiveInteger(body.amount_light, 'amount_light', {
      max: MAX_TOP_UP_LIGHT,
    }),
  };
}

export async function validateSetAppCategoryRequest(request: Request): Promise<SetAppCategoryPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['category'],
  });

  if (body.category === null || body.category === undefined) {
    return { category: null };
  }

  return {
    category: normalizeRequiredString(body.category, 'category', MAX_APP_CATEGORY_LENGTH),
  };
}

export async function validateSetAppFeaturedRequest(request: Request): Promise<SetAppFeaturedPayload> {
  const body = await readJsonObject(request, {
    allowedKeys: ['featured'],
  });

  if (typeof body.featured !== 'boolean') {
    throw new RequestValidationError('featured must be a boolean');
  }

  return {
    featured: body.featured,
  };
}
