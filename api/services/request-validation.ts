export class RequestValidationError extends Error {
  readonly status: number;
  readonly oauthErrorCode?: string;

  constructor(message: string, status = 400, oauthErrorCode?: string) {
    super(message);
    this.name = "RequestValidationError";
    this.status = status;
    this.oauthErrorCode = oauthErrorCode;
  }
}

interface JsonBodyOptions {
  allowEmptyBody?: boolean;
  allowedKeys?: string[];
}

interface FormBodyOptions {
  allowEmptyBody?: boolean;
  allowedKeys?: string[];
}

interface StringOptions {
  maxLength?: number;
  oauthErrorCode?: string;
}

interface OptionalStringOptions extends StringOptions {
  trim?: boolean;
}

export function ensurePlainObject(
  value: unknown,
  message = "Request body must be a JSON object",
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequestValidationError(message);
  }
  return value as Record<string, unknown>;
}

export function rejectUnknownKeys(body: Record<string, unknown>, allowedKeys?: string[]) {
  if (!allowedKeys) return;
  const unknownKeys = Object.keys(body).filter((key) => !allowedKeys.includes(key));
  if (unknownKeys.length > 0) {
    throw new RequestValidationError(`Unsupported field(s): ${unknownKeys.join(", ")}`);
  }
}

export async function readJsonObject(
  request: Request,
  options: JsonBodyOptions = {},
): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) {
    if (options.allowEmptyBody) {
      return {};
    }
    throw new RequestValidationError("Request body is required");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new RequestValidationError("Invalid JSON");
  }

  const body = ensurePlainObject(parsed);
  rejectUnknownKeys(body, options.allowedKeys);
  return body;
}

export async function readFormUrlEncodedOrJsonObject(
  request: Request,
  options: FormBodyOptions = {},
): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const text = await request.text();
    if (!text.trim()) {
      if (options.allowEmptyBody) {
        return {};
      }
      throw new RequestValidationError("Request body is required", 400, "invalid_request");
    }

    const body = Object.fromEntries(new URLSearchParams(text).entries());
    rejectUnknownKeys(body, options.allowedKeys);
    return body;
  }

  return await readJsonObject(request, {
    allowEmptyBody: options.allowEmptyBody,
    allowedKeys: options.allowedKeys,
  });
}

export function normalizeOptionalString(
  value: unknown,
  field: string,
  options: OptionalStringOptions = {},
): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new RequestValidationError(`${field} must be a string`, 400, options.oauthErrorCode);
  }

  const normalized = options.trim === false ? value : value.trim();
  if (!normalized) {
    return undefined;
  }
  if (options.maxLength && normalized.length > options.maxLength) {
    throw new RequestValidationError(
      `${field} must be ${options.maxLength} characters or less`,
      400,
      options.oauthErrorCode,
    );
  }
  return normalized;
}

export function normalizeRequiredString(
  value: unknown,
  field: string,
  options: StringOptions = {},
): string {
  const normalized = normalizeOptionalString(value, field, options);
  if (!normalized) {
    throw new RequestValidationError(`Missing ${field}`, 400, options.oauthErrorCode);
  }
  return normalized;
}

export function normalizeStringArray(
  value: unknown,
  field: string,
  {
    allowedValues,
    oauthErrorCode,
    requireNonEmpty = true,
  }: {
    allowedValues?: Set<string>;
    oauthErrorCode?: string;
    requireNonEmpty?: boolean;
  } = {},
): string[] {
  if (!Array.isArray(value)) {
    throw new RequestValidationError(`${field} must be an array of strings`, 400, oauthErrorCode);
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== "string") {
      throw new RequestValidationError(`${field} must be an array of strings`, 400, oauthErrorCode);
    }
    const trimmed = entry.trim();
    if (!trimmed) {
      throw new RequestValidationError(`${field} cannot contain empty values`, 400, oauthErrorCode);
    }
    if (allowedValues && !allowedValues.has(trimmed)) {
      throw new RequestValidationError(
        `${field} contains unsupported value "${trimmed}"`,
        400,
        oauthErrorCode,
      );
    }
    return trimmed;
  });

  if (requireNonEmpty && normalized.length === 0) {
    throw new RequestValidationError(`${field} is required`, 400, oauthErrorCode);
  }

  return normalized;
}
