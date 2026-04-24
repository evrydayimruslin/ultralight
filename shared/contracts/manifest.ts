import type { EnvSchemaEntry } from './env.ts';
import { validateEnvVarKey } from './env.ts';
import type { MCPJsonSchema, MCPTool, MCPToolAnnotations } from './mcp.ts';

export interface AppManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  icon?: string;
  type: 'mcp';
  entry: {
    functions?: string;
  };
  functions?: Record<string, ManifestFunction>;
  permissions?: string[];
  env?: Record<string, ManifestEnvVar>;
  env_vars?: Record<string, ManifestEnvVar>;
}

export interface ManifestFunction {
  description: string;
  parameters?: Record<string, ManifestParameter>;
  returns?: ManifestReturn;
  examples?: string[];
  annotations?: MCPToolAnnotations;
}

export interface ManifestParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  required?: boolean;
  default?: unknown;
  enum?: unknown[];
  items?: ManifestParameter;
  properties?: Record<string, ManifestParameter>;
}

export interface ManifestReturn {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array' | 'void';
  description?: string;
}

export interface ManifestEnvVar {
  description?: string;
  required?: boolean;
  default?: string;
  scope?: EnvSchemaEntry['scope'];
  type?: EnvSchemaEntry['scope'];
  label?: string;
  input?: EnvSchemaEntry['input'];
  placeholder?: string;
  help?: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  manifest?: AppManifest;
  errors: ManifestValidationError[];
  warnings: string[];
}

export interface ManifestValidationError {
  path: string;
  message: string;
}

export function humanizeEnvVarKey(key: string): string {
  return key
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function normalizeEnvScope(value: unknown): EnvSchemaEntry['scope'] {
  return value === 'per_user' ? 'per_user' : 'universal';
}

function inferEnvInputType(
  key: string,
  description?: string,
): NonNullable<EnvSchemaEntry['input']> {
  const upperKey = key.toUpperCase();
  const combined = `${upperKey} ${description || ''}`.toUpperCase();

  if (/(PASS|PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY|SERVICE_KEY|ACCESS_KEY)/.test(combined)) {
    return 'password';
  }

  if (/(EMAIL|E-MAIL|MAILBOX|ADDRESS)/.test(combined)) {
    return 'email';
  }

  if (/(PORT|TIMEOUT|LIMIT|COUNT|INTERVAL)/.test(combined)) {
    return 'number';
  }

  if (/(URL|URI|WEBHOOK|ENDPOINT)/.test(combined) && !/HOST/.test(upperKey)) {
    return 'url';
  }

  return 'text';
}

function normalizeEnvInput(
  value: unknown,
  key: string,
  description?: string,
): NonNullable<EnvSchemaEntry['input']> {
  if (
    value === 'text' ||
    value === 'password' ||
    value === 'email' ||
    value === 'number' ||
    value === 'url' ||
    value === 'textarea'
  ) {
    return value;
  }

  return inferEnvInputType(key, description);
}

function normalizeManifestEnvVarEntry(
  key: string,
  entry: unknown,
): ManifestEnvVar | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const raw = entry as Record<string, unknown>;
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const label = typeof raw.label === 'string' && raw.label.trim()
    ? raw.label.trim()
    : humanizeEnvVarKey(key);

  return {
    description,
    required: typeof raw.required === 'boolean' ? raw.required : undefined,
    default: typeof raw.default === 'string' ? raw.default : undefined,
    scope: normalizeEnvScope(raw.scope ?? raw.type),
    label,
    input: normalizeEnvInput(raw.input, key, description),
    placeholder: typeof raw.placeholder === 'string' ? raw.placeholder : undefined,
    help: typeof raw.help === 'string' ? raw.help : undefined,
  };
}

export function normalizeManifestEnvVars(
  envVars: unknown,
): Record<string, ManifestEnvVar> | undefined {
  if (envVars === undefined || envVars === null) return undefined;
  if (typeof envVars !== 'object' || Array.isArray(envVars)) return undefined;

  const normalized: Record<string, ManifestEnvVar> = {};
  for (const [key, value] of Object.entries(envVars as Record<string, unknown>)) {
    const entry = normalizeManifestEnvVarEntry(key, value);
    if (entry) {
      normalized[key] = entry;
    }
  }

  return normalized;
}

export function getManifestEnvVars(
  manifest: { env?: unknown; env_vars?: unknown } | null | undefined,
): Record<string, ManifestEnvVar> | undefined {
  if (!manifest) return undefined;

  const legacy = normalizeManifestEnvVars(manifest.env) || {};
  const current = normalizeManifestEnvVars(manifest.env_vars) || {};
  const merged = { ...legacy, ...current };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

export function manifestEnvVarsToEnvSchema(
  envVars: Record<string, ManifestEnvVar> | undefined,
): Record<string, EnvSchemaEntry> {
  if (!envVars) return {};

  const schema: Record<string, EnvSchemaEntry> = {};
  for (const [key, value] of Object.entries(envVars)) {
    schema[key] = {
      scope: normalizeEnvScope(value.scope ?? value.type),
      description: value.description,
      required: value.required,
      label: value.label || humanizeEnvVarKey(key),
      input: normalizeEnvInput(value.input, key, value.description),
      placeholder: value.placeholder,
      help: value.help,
    };
  }
  return schema;
}

export function resolveManifestEnvSchema(
  manifest: { env?: unknown; env_vars?: unknown } | null | undefined,
): Record<string, EnvSchemaEntry> {
  return manifestEnvVarsToEnvSchema(getManifestEnvVars(manifest));
}

export function normalizeEnvSchema(input: unknown): Record<string, EnvSchemaEntry> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};

  const normalized: Record<string, EnvSchemaEntry> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
    const entry = value as Record<string, unknown>;
    const description = typeof entry.description === 'string' ? entry.description : undefined;
    normalized[key] = {
      scope: normalizeEnvScope(entry.scope),
      description,
      required: typeof entry.required === 'boolean' ? entry.required : undefined,
      label: typeof entry.label === 'string' && entry.label.trim()
        ? entry.label.trim()
        : humanizeEnvVarKey(key),
      input: normalizeEnvInput(entry.input, key, description),
      placeholder: typeof entry.placeholder === 'string' ? entry.placeholder : undefined,
      help: typeof entry.help === 'string' ? entry.help : undefined,
    };
  }

  return normalized;
}

export function normalizeManifestParameters(
  params: unknown,
): Record<string, ManifestParameter> | undefined {
  if (params === undefined || params === null) return undefined;

  if (typeof params === 'object' && !Array.isArray(params)) {
    return params as Record<string, ManifestParameter>;
  }

  if (Array.isArray(params)) {
    const result: Record<string, ManifestParameter> = {};
    for (const item of params) {
      if (item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string') {
        const { name, ...rest } = item as { name: string } & Record<string, unknown>;
        const candidate = rest as Record<string, unknown>;
        if (
          candidate.type === 'string' ||
          candidate.type === 'number' ||
          candidate.type === 'boolean' ||
          candidate.type === 'object' ||
          candidate.type === 'array'
        ) {
          result[name] = candidate as unknown as ManifestParameter;
        }
      }
    }
    return result;
  }

  return undefined;
}

export function validateManifest(input: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];
  const warnings: string[] = [];

  if (!input || typeof input !== 'object') {
    return { valid: false, errors: [{ path: '', message: 'Manifest must be an object' }], warnings };
  }

  const manifest = input as Record<string, unknown>;

  if (!manifest.name || typeof manifest.name !== 'string') {
    errors.push({ path: 'name', message: 'name is required and must be a string' });
  }

  if (!manifest.version || typeof manifest.version !== 'string') {
    errors.push({ path: 'version', message: 'version is required and must be a string' });
  }

  if (!manifest.type || manifest.type !== 'mcp') {
    errors.push({ path: 'type', message: 'type must be "mcp"' });
  }

  if (!manifest.entry || typeof manifest.entry !== 'object') {
    errors.push({ path: 'entry', message: 'entry is required and must be an object' });
  } else {
    const entry = manifest.entry as Record<string, unknown>;
    if (!entry.functions) {
      errors.push({ path: 'entry.functions', message: 'entry.functions is required for MCP apps' });
    }
  }

  if (manifest.functions !== undefined) {
    if (typeof manifest.functions !== 'object' || manifest.functions === null) {
      errors.push({ path: 'functions', message: 'functions must be an object' });
    } else {
      const functions = manifest.functions as Record<string, unknown>;
      for (const [fnName, fnDef] of Object.entries(functions)) {
        if (!fnDef || typeof fnDef !== 'object') {
          errors.push({ path: `functions.${fnName}`, message: 'function definition must be an object' });
          continue;
        }

        const fn = fnDef as Record<string, unknown>;
        if (!fn.description || typeof fn.description !== 'string') {
          errors.push({ path: `functions.${fnName}.description`, message: 'description is required' });
        }

        if (fn.parameters !== undefined) {
          if (typeof fn.parameters !== 'object') {
            errors.push({ path: `functions.${fnName}.parameters`, message: 'parameters must be an object or array' });
          } else {
            fn.parameters = normalizeManifestParameters(fn.parameters);
          }
        }
      }
    }
  }

  if (manifest.env !== undefined && (typeof manifest.env !== 'object' || manifest.env === null || Array.isArray(manifest.env))) {
    errors.push({ path: 'env', message: 'env must be an object' });
  }

  if (
    manifest.env_vars !== undefined &&
    (typeof manifest.env_vars !== 'object' || manifest.env_vars === null || Array.isArray(manifest.env_vars))
  ) {
    errors.push({ path: 'env_vars', message: 'env_vars must be an object' });
  }

  const rawEnvVars = {
    ...((manifest.env && typeof manifest.env === 'object' && !Array.isArray(manifest.env))
      ? manifest.env as Record<string, unknown>
      : {}),
    ...((manifest.env_vars && typeof manifest.env_vars === 'object' && !Array.isArray(manifest.env_vars))
      ? manifest.env_vars as Record<string, unknown>
      : {}),
  };

  for (const [key, value] of Object.entries(rawEnvVars)) {
    const keyValidation = validateEnvVarKey(key);
    if (!keyValidation.valid) {
      errors.push({ path: `env_vars.${key}`, message: keyValidation.error || 'Invalid env var key' });
      continue;
    }

    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      errors.push({ path: `env_vars.${key}`, message: 'env var entry must be an object' });
      continue;
    }

    const envVar = value as Record<string, unknown>;

    if (envVar.scope !== undefined && envVar.scope !== 'universal' && envVar.scope !== 'per_user') {
      errors.push({ path: `env_vars.${key}.scope`, message: 'scope must be "universal" or "per_user"' });
    }

    if (envVar.type !== undefined && envVar.type !== 'universal' && envVar.type !== 'per_user') {
      errors.push({ path: `env_vars.${key}.type`, message: 'type must be "universal" or "per_user"' });
    }

    if (
      envVar.input !== undefined &&
      envVar.input !== 'text' &&
      envVar.input !== 'password' &&
      envVar.input !== 'email' &&
      envVar.input !== 'number' &&
      envVar.input !== 'url' &&
      envVar.input !== 'textarea'
    ) {
      errors.push({
        path: `env_vars.${key}.input`,
        message: 'input must be one of: text, password, email, number, url, textarea',
      });
    }

    if (envVar.description !== undefined && typeof envVar.description !== 'string') {
      errors.push({ path: `env_vars.${key}.description`, message: 'description must be a string' });
    }

    if (envVar.required !== undefined && typeof envVar.required !== 'boolean') {
      errors.push({ path: `env_vars.${key}.required`, message: 'required must be a boolean' });
    }

    if (envVar.default !== undefined && typeof envVar.default !== 'string') {
      errors.push({ path: `env_vars.${key}.default`, message: 'default must be a string' });
    }

    if (envVar.label !== undefined && typeof envVar.label !== 'string') {
      errors.push({ path: `env_vars.${key}.label`, message: 'label must be a string' });
    }

    if (envVar.placeholder !== undefined && typeof envVar.placeholder !== 'string') {
      errors.push({ path: `env_vars.${key}.placeholder`, message: 'placeholder must be a string' });
    }

    if (envVar.help !== undefined && typeof envVar.help !== 'string') {
      errors.push({ path: `env_vars.${key}.help`, message: 'help must be a string' });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  const normalizedEnvVars = getManifestEnvVars(manifest);
  if (normalizedEnvVars) {
    manifest.env = normalizedEnvVars;
    manifest.env_vars = normalizedEnvVars;
  }

  return {
    valid: true,
    manifest: input as AppManifest,
    errors: [],
    warnings,
  };
}

export function manifestToMCPTools(manifest: AppManifest, _appId: string, appSlug: string): MCPTool[] {
  if (!manifest.functions) return [];

  const tools: MCPTool[] = [];
  const defaultAnnotations: MCPToolAnnotations = {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  };

  for (const [fnName, fnDef] of Object.entries(manifest.functions)) {
    const tool: MCPTool = {
      name: `${appSlug}_${fnName}`,
      title: fnName,
      description: fnDef.description,
      annotations: fnDef.annotations
        ? { ...defaultAnnotations, ...fnDef.annotations }
        : defaultAnnotations,
      inputSchema: {
        type: 'object',
        properties: {},
        required: [],
      },
    };

    if (fnDef.parameters) {
      const normalized = normalizeManifestParameters(fnDef.parameters) || {};
      const properties: Record<string, MCPJsonSchema> = {};
      const required: string[] = [];

      for (const [paramName, paramDef] of Object.entries(normalized)) {
        properties[paramName] = {
          type: paramDef.type,
          description: paramDef.description,
        };

        if (paramDef.enum) {
          properties[paramName].enum = paramDef.enum;
        }

        if (paramDef.default !== undefined) {
          properties[paramName].default = paramDef.default;
        }

        if (paramDef.required !== false) {
          required.push(paramName);
        }
      }

      tool.inputSchema.properties = properties;
      tool.inputSchema.required = required;
    }

    tools.push(tool);
  }

  return tools;
}
