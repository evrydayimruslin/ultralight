// Local storage wrapper for auth token and preferences

const STORAGE_KEYS = {
  token: 'ul_token',
  model: 'ul_model',
  interpreterModel: 'ul_interpreter_model',
  heavyModel: 'ul_heavy_model',
  apiBase: 'ul_api_base',
  autoApproveLight: 'ul_auto_approve_light',
} as const;

const DEFAULT_API_BASE = 'https://ultralight-api.rgn4jz429m.workers.dev';

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
  return localStorage.getItem(STORAGE_KEYS.model) || 'google/gemini-3.1-flash-lite-preview:nitro';
}

export function setModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.model, model);
}

// Two-model architecture: interpreter (Flash) + heavy (Sonnet)
export function getInterpreterModel(): string {
  return localStorage.getItem(STORAGE_KEYS.interpreterModel) || 'google/gemini-3.1-flash-lite-preview:nitro';
}
export function setInterpreterModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.interpreterModel, model);
}
export function getHeavyModel(): string {
  return localStorage.getItem(STORAGE_KEYS.heavyModel) || 'anthropic/claude-sonnet-4';
}
export function setHeavyModel(model: string): void {
  localStorage.setItem(STORAGE_KEYS.heavyModel, model);
}

export function getApiBase(): string {
  return localStorage.getItem(STORAGE_KEYS.apiBase) || DEFAULT_API_BASE;
}

export function setApiBase(url: string): void {
  localStorage.setItem(STORAGE_KEYS.apiBase, url);
}

export function getAutoApproveLight(): number {
  const val = localStorage.getItem(STORAGE_KEYS.autoApproveLight);
  return val ? parseFloat(val) : 200; // default ✦200
}

export function setAutoApproveLight(light: number): void {
  localStorage.setItem(STORAGE_KEYS.autoApproveLight, String(light));
}
