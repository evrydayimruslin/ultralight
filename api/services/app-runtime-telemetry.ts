import { createServerLogger } from './logging.ts';

export type AppSupabaseResolutionSource =
  | 'saved_config'
  | 'legacy_app_config'
  | 'platform_default'
  | 'none';

export interface AppSupabaseResolutionLogInput {
  appId?: string;
  ownerId: string;
  source: AppSupabaseResolutionSource;
  supabaseEnabled: boolean;
  hasConfigId: boolean;
  hasLegacyAppConfig: boolean;
  note?: string;
}

export function buildAppSupabaseResolutionLogEntry(
  input: AppSupabaseResolutionLogInput,
): Record<string, unknown> {
  const requiresMigration = input.source === 'legacy_app_config'
    || input.source === 'platform_default'
    || (input.source === 'none' && (input.hasConfigId || input.supabaseEnabled));

  return {
    event: 'app_supabase_resolution',
    app_id: input.appId || '',
    owner_id: input.ownerId,
    source: input.source,
    supabase_enabled: input.supabaseEnabled,
    has_config_id: input.hasConfigId,
    has_legacy_app_config: input.hasLegacyAppConfig,
    resolution_status: input.source === 'none' ? 'unresolved' : 'resolved',
    fallback_used: input.source === 'legacy_app_config' || input.source === 'platform_default',
    requires_migration: requiresMigration,
    note: input.note || undefined,
  };
}

export function logAppSupabaseResolution(
  input: AppSupabaseResolutionLogInput,
): void {
  const entry = buildAppSupabaseResolutionLogEntry(input);
  const method = input.source === 'saved_config' ? 'info' : 'warn';
  createServerLogger('APP-RUNTIME')[method](
    'Resolved app Supabase runtime configuration',
    entry,
  );
}
