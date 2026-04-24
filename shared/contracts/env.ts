export interface EnvVarLimits {
  max_vars_per_app: number;
  max_key_length: number;
  max_value_length: number;
  reserved_prefixes: string[];
}

export interface EnvSchemaEntry {
  scope: 'universal' | 'per_user';
  description?: string;
  required?: boolean;
  label?: string;
  input?: 'text' | 'password' | 'email' | 'number' | 'url' | 'textarea';
  placeholder?: string;
  help?: string;
}

export const ENV_VAR_LIMITS: EnvVarLimits = {
  max_vars_per_app: 50,
  max_key_length: 64,
  max_value_length: 4096,
  reserved_prefixes: ['ULTRALIGHT'],
};

export function validateEnvVarKey(key: string): { valid: boolean; error?: string } {
  if (!key || typeof key !== 'string') {
    return { valid: false, error: 'Key is required' };
  }

  if (key.length > ENV_VAR_LIMITS.max_key_length) {
    return { valid: false, error: `Key must be ${ENV_VAR_LIMITS.max_key_length} characters or less` };
  }

  for (const prefix of ENV_VAR_LIMITS.reserved_prefixes) {
    if (key.toUpperCase().startsWith(prefix)) {
      return { valid: false, error: `Keys starting with "${prefix}" are reserved` };
    }
  }

  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) {
    return { valid: false, error: 'Key must be uppercase letters, numbers, and underscores, starting with a letter' };
  }

  return { valid: true };
}

export function validateEnvVarValue(value: string): { valid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: 'Value must be a string' };
  }

  if (value.length > ENV_VAR_LIMITS.max_value_length) {
    return { valid: false, error: `Value must be ${ENV_VAR_LIMITS.max_value_length} characters or less` };
  }

  return { valid: true };
}
