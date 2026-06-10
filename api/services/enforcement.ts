export type EnforcementMode = 'fail_open' | 'fail_closed';

export interface EnforcementOptions {
  mode?: EnforcementMode;
  resource?: string;
}

export function resolveEnforcementOptions(
  options: EnforcementOptions | undefined,
  defaultResource: string,
): Required<EnforcementOptions> {
  return {
    mode: options?.mode ?? 'fail_open',
    resource: options?.resource ?? defaultResource,
  };
}
