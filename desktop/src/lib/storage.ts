// Local storage wrapper for auth token and preferences

const STORAGE_KEYS = {
  token: 'ul_token',
  model: 'ul_model',
  apiBase: 'ul_api_base',
} as const;

const DEFAULT_API_BASE = 'https://ultralight-api-iikqz.ondigitalocean.app';

export function getToken(): string | null {
  return localStorage.getItem(STORAGE_KEYS.token);
}

export function setToken(token: string): void {
  localStorage.setItem(STORAGE_KEYS.token, token);
}

export function clearToken(): void {
  localStorage.removeItem(STORAGE_KEYS.token);
}

export function getModel(): string {
  return localStorage.getItem(STORAGE_KEYS.model) || 'anthropic/claude-sonnet-4-20250514';
}

export function setModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.model, model);
}

export function getApiBase(): string {
  return localStorage.getItem(STORAGE_KEYS.apiBase) || DEFAULT_API_BASE;
}

export function setApiBase(url: string): void {
  localStorage.setItem(STORAGE_KEYS.apiBase, url);
}
