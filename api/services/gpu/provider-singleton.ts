import type { GPUProvider } from './provider.ts';
import { RunPodProvider } from './runpod.ts';
import { getEnv } from '../../lib/env.ts';

let provider: GPUProvider | null = null;

export function getGPUProvider(): GPUProvider {
  if (!provider) {
    const apiKey = getEnv('RUNPOD_API_KEY');
    if (!apiKey) {
      throw Object.assign(
        new Error('GPU compute is not configured. RUNPOD_API_KEY environment variable is required.'),
        { status: 503 },
      );
    }
    provider = new RunPodProvider(apiKey);
  }
  return provider;
}

export function isGpuAvailable(): boolean {
  try {
    getGPUProvider();
    return true;
  } catch {
    return false;
  }
}
