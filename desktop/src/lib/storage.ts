// Desktop storage wrapper for auth token and preferences.
// Long-lived auth tokens live in the OS keychain; non-secret prefs stay in localStorage.

import { invoke } from '@tauri-apps/api/core';

const STORAGE_KEYS = {
  token: 'ul_token',
  model: 'ul_model',
  interpreterModel: 'ul_interpreter_model',
  heavyModel: 'ul_heavy_model',
  apiBase: 'ul_api_base',
  autoApproveLight: 'ul_auto_approve_light',
  onboardingComplete: 'ul_onboarding_complete',
} as const;

const DEFAULT_API_BASE = 'https://ultralight-api.rgn4jz429m.workers.dev';
const SECURE_STORAGE_COMMANDS = {
  get: 'secure_get_auth_token',
  set: 'secure_set_auth_token',
  clear: 'secure_clear_auth_token',
} as const;

let cachedToken: string | null = null;
let hydratePromise: Promise<void> | null = null;

function secureStorageError(action: 'load' | 'save' | 'clear', error: unknown): Error {
  console.error(`[storage] Failed to ${action} auth token securely`, error);

  switch (action) {
    case 'load':
      return new Error('Unable to access secure desktop sign-in storage.');
    case 'save':
      return new Error('Unable to save your sign-in token securely on this device.');
    case 'clear':
      return new Error('Unable to clear your saved sign-in token securely.');
  }
}

async function readSecureToken(): Promise<string | null> {
  try {
    return await invoke<string | null>(SECURE_STORAGE_COMMANDS.get);
  } catch (error) {
    throw secureStorageError('load', error);
  }
}

async function writeSecureToken(token: string): Promise<void> {
  try {
    await invoke(SECURE_STORAGE_COMMANDS.set, { token });
  } catch (error) {
    throw secureStorageError('save', error);
  }
}

async function removeSecureToken(): Promise<void> {
  try {
    await invoke(SECURE_STORAGE_COMMANDS.clear);
  } catch (error) {
    throw secureStorageError('clear', error);
  }
}

async function awaitHydration(): Promise<void> {
  if (hydratePromise) {
    await hydratePromise;
  }
}

export async function hydrateSecureStorage(): Promise<void> {
  if (hydratePromise) {
    return hydratePromise;
  }

  hydratePromise = (async () => {
    const secureToken = await readSecureToken();
    if (secureToken) {
      cachedToken = secureToken;
      localStorage.removeItem(STORAGE_KEYS.token);
      return;
    }

    const legacyToken = localStorage.getItem(STORAGE_KEYS.token);
    if (!legacyToken) {
      cachedToken = null;
      localStorage.removeItem(STORAGE_KEYS.token);
      return;
    }

    await writeSecureToken(legacyToken);
    cachedToken = legacyToken;
    localStorage.removeItem(STORAGE_KEYS.token);
  })().catch((error) => {
    hydratePromise = null;
    throw error;
  });

  return hydratePromise;
}

export function getToken(): string | null {
  return cachedToken;
}

export async function setToken(token: string): Promise<void> {
  await awaitHydration();
  await writeSecureToken(token);
  cachedToken = token;
  localStorage.removeItem(STORAGE_KEYS.token);
}

export async function clearToken(): Promise<void> {
  await awaitHydration();
  await removeSecureToken();
  cachedToken = null;
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
  return val ? parseFloat(val) : 25; // default ✦25
}

export function setAutoApproveLight(light: number): void {
  localStorage.setItem(STORAGE_KEYS.autoApproveLight, String(light));
}

export function isOnboardingComplete(): boolean {
  return localStorage.getItem(STORAGE_KEYS.onboardingComplete) === '1';
}

export function setOnboardingComplete(): void {
  localStorage.setItem(STORAGE_KEYS.onboardingComplete, '1');
}

export function resetOnboarding(): void {
  localStorage.removeItem(STORAGE_KEYS.onboardingComplete);
}
