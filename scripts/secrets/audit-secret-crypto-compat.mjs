import { randomBytes, webcrypto } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ensureNode20, parseArgs, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const PER_RECORD_SALT_LENGTH = 16;
const IV_LENGTH = 12;
const API_KEY_LEGACY_SALT = 'ultralight-salt';
const ENV_VAR_LEGACY_SALT = 'ultralight-env-vars-salt';
const PAGE_SIZE = 1000;

const args = parseArgs(process.argv.slice(2));
const outputPath = typeof args.get('--write-json') === 'string'
  ? resolve(repoRoot, args.get('--write-json'))
  : null;
const applyBackfill = args.has('--apply-backfill');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BYOK_ENCRYPTION_KEY = process.env.BYOK_ENCRYPTION_KEY;
const ENV_VARS_ENCRYPTION_KEY = process.env.ENV_VARS_ENCRYPTION_KEY || BYOK_ENCRYPTION_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !BYOK_ENCRYPTION_KEY || !ENV_VARS_ENCRYPTION_KEY) {
  console.error(
    'SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BYOK_ENCRYPTION_KEY, and either ENV_VARS_ENCRYPTION_KEY or BYOK_ENCRYPTION_KEY must be set before running this audit.',
  );
  process.exit(1);
}

function headers(extra = {}) {
  return {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    ...extra,
  };
}

function base64ToBytes(value) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

function bytesToBase64(value) {
  return Buffer.from(value).toString('base64');
}

async function deriveEncryptionKey(masterKey, salt) {
  const keyMaterial = await subtle.importKey(
    'raw',
    encoder.encode(masterKey),
    'PBKDF2',
    false,
    ['deriveKey'],
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function decryptCanonicalBlob(value, masterKey) {
  const combined = base64ToBytes(value);
  const salt = combined.slice(0, PER_RECORD_SALT_LENGTH);
  const iv = combined.slice(PER_RECORD_SALT_LENGTH, PER_RECORD_SALT_LENGTH + IV_LENGTH);
  const ciphertext = combined.slice(PER_RECORD_SALT_LENGTH + IV_LENGTH);
  const key = await deriveEncryptionKey(masterKey, salt);
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return decoder.decode(decrypted);
}

async function decryptLegacyBlob(value, masterKey, legacySalt) {
  const combined = base64ToBytes(value);
  const iv = combined.slice(0, IV_LENGTH);
  const ciphertext = combined.slice(IV_LENGTH);
  const key = await deriveEncryptionKey(masterKey, encoder.encode(legacySalt));
  const decrypted = await subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return decoder.decode(decrypted);
}

async function encryptCanonicalBlob(value, masterKey) {
  const salt = randomBytes(PER_RECORD_SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = await deriveEncryptionKey(masterKey, salt);
  const encrypted = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(value),
  );
  const combined = new Uint8Array(PER_RECORD_SALT_LENGTH + IV_LENGTH + encrypted.byteLength);
  combined.set(salt);
  combined.set(iv, PER_RECORD_SALT_LENGTH);
  combined.set(new Uint8Array(encrypted), PER_RECORD_SALT_LENGTH + IV_LENGTH);
  return bytesToBase64(combined);
}

async function decryptCanonicalOAuthToken(value) {
  return decryptCanonicalBlob(value, `oauth-token-encryption:${SUPABASE_SERVICE_ROLE_KEY}`);
}

async function encryptCanonicalOAuthToken(value) {
  return encryptCanonicalBlob(value, `oauth-token-encryption:${SUPABASE_SERVICE_ROLE_KEY}`);
}

async function auditApiCryptoValue(value) {
  if (!value) {
    return { state: 'absent', recommended_action: 'none' };
  }

  try {
    await decryptCanonicalBlob(value, BYOK_ENCRYPTION_KEY);
    return { state: 'canonical', recommended_action: 'none' };
  } catch {
    try {
      const plaintext = await decryptLegacyBlob(value, BYOK_ENCRYPTION_KEY, API_KEY_LEGACY_SALT);
      return {
        state: 'legacy_blob_backfillable',
        recommended_action: 'backfill_canonical_encryption',
        plaintext,
      };
    } catch {
      return {
        state: 'unreadable',
        recommended_action: 'rotate_or_delete_then_recreate',
      };
    }
  }
}

async function auditEnvCryptoValue(value) {
  if (!value) {
    return { state: 'absent', recommended_action: 'none' };
  }

  try {
    await decryptCanonicalBlob(value, ENV_VARS_ENCRYPTION_KEY);
    return { state: 'canonical', recommended_action: 'none' };
  } catch {
    try {
      const plaintext = await decryptLegacyBlob(value, ENV_VARS_ENCRYPTION_KEY, ENV_VAR_LEGACY_SALT);
      return {
        state: 'legacy_blob_backfillable',
        recommended_action: 'backfill_canonical_encryption',
        plaintext,
      };
    } catch {
      return {
        state: 'unreadable',
        recommended_action: 'rotate_or_delete_then_recreate',
      };
    }
  }
}

async function auditOAuthTokenValue(value) {
  if (!value) {
    return { state: 'absent', recommended_action: 'none' };
  }

  try {
    await decryptCanonicalOAuthToken(value);
    return { state: 'canonical', recommended_action: 'none' };
  } catch {
    if (value.startsWith('eyJ')) {
      return {
        state: 'legacy_plaintext_backfillable',
        recommended_action: 'backfill_canonical_encryption',
        plaintext: value,
      };
    }

    return {
      state: 'unreadable',
      recommended_action: 'expire_or_delete_then_reissue',
    };
  }
}

async function fetchAllRows(table, {
  select,
  filters = {},
  order = null,
}) {
  const rows = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams();
    params.set('select', select);
    if (order) {
      params.set('order', order);
    }
    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && value !== undefined) {
        params.set(key, value);
      }
    }

    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/${table}?${params.toString()}`,
      {
        headers: headers({
          Range: `${offset}-${offset + PAGE_SIZE - 1}`,
        }),
      },
    );

    if (!response.ok) {
      console.error(`Failed to fetch ${table}: ${await response.text()}`);
      process.exit(1);
    }

    const page = await response.json();
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      break;
    }
    offset += PAGE_SIZE;
  }

  return rows;
}

async function patchRow(table, primaryField, primaryValue, payload) {
  const response = await fetch(
    `${SUPABASE_URL}/rest/v1/${table}?${primaryField}=eq.${encodeURIComponent(primaryValue)}`,
    {
      method: 'PATCH',
      headers: headers({
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      }),
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(await response.text());
  }
}

function buildField(field, result) {
  return {
    field,
    state: result.state,
    recommended_action: result.recommended_action,
  };
}

function hasLegacyField(fields) {
  return fields.some((field) => field.state === 'legacy_blob_backfillable' || field.state === 'legacy_plaintext_backfillable');
}

function hasUnreadableField(fields) {
  return fields.some((field) => field.state === 'unreadable');
}

async function auditUserAppSecrets() {
  const rows = await fetchAllRows('user_app_secrets', {
    select: 'id,user_id,app_id,key,value_encrypted,created_at',
    order: 'created_at.asc,id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const valueResult = await auditEnvCryptoValue(row.value_encrypted);
    const fields = [buildField('value_encrypted', valueResult)];
    const reportRow = {
      surface: 'user_app_secrets',
      primary_id: row.id,
      user_id: row.user_id,
      app_id: row.app_id,
      secret_key: row.key,
      fields,
    };

    if (applyBackfill && valueResult.state === 'legacy_blob_backfillable') {
      try {
        await patchRow('user_app_secrets', 'id', row.id, {
          value_encrypted: await encryptCanonicalBlob(valueResult.plaintext, ENV_VARS_ENCRYPTION_KEY),
        });
        remediation.push({ surface: 'user_app_secrets', primary_id: row.id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'user_app_secrets',
          primary_id: row.id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditUserSupabaseConfigs() {
  const rows = await fetchAllRows('user_supabase_configs', {
    select: 'id,user_id,name,supabase_url,anon_key_encrypted,service_key_encrypted,created_at',
    order: 'created_at.asc,id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const anonResult = await auditEnvCryptoValue(row.anon_key_encrypted);
    const serviceResult = await auditEnvCryptoValue(row.service_key_encrypted);
    const fields = [
      buildField('anon_key_encrypted', anonResult),
      buildField('service_key_encrypted', serviceResult),
    ].filter((field) => field.state !== 'absent');
    const reportRow = {
      surface: 'user_supabase_configs',
      primary_id: row.id,
      user_id: row.user_id,
      name: row.name,
      supabase_url: row.supabase_url,
      fields,
    };

    if (fields.length === 0) {
      continue;
    }

    if (applyBackfill && hasLegacyField(fields)) {
      const payload = {};
      if (anonResult.state === 'legacy_blob_backfillable') {
        payload.anon_key_encrypted = await encryptCanonicalBlob(anonResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }
      if (serviceResult.state === 'legacy_blob_backfillable') {
        payload.service_key_encrypted = await encryptCanonicalBlob(serviceResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }

      try {
        await patchRow('user_supabase_configs', 'id', row.id, payload);
        remediation.push({ surface: 'user_supabase_configs', primary_id: row.id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'user_supabase_configs',
          primary_id: row.id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditUserSupabaseOAuth() {
  const rows = await fetchAllRows('user_supabase_oauth', {
    select: 'id,user_id,project_ref,access_token_encrypted,refresh_token_encrypted,created_at',
    order: 'created_at.asc,id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const accessResult = await auditEnvCryptoValue(row.access_token_encrypted);
    const refreshResult = await auditEnvCryptoValue(row.refresh_token_encrypted);
    const fields = [
      buildField('access_token_encrypted', accessResult),
      buildField('refresh_token_encrypted', refreshResult),
    ].filter((field) => field.state !== 'absent');
    const reportRow = {
      surface: 'user_supabase_oauth',
      primary_id: row.id,
      user_id: row.user_id,
      project_ref: row.project_ref,
      fields,
    };

    if (fields.length === 0) {
      continue;
    }

    if (applyBackfill && hasLegacyField(fields)) {
      const payload = {};
      if (accessResult.state === 'legacy_blob_backfillable') {
        payload.access_token_encrypted = await encryptCanonicalBlob(accessResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }
      if (refreshResult.state === 'legacy_blob_backfillable') {
        payload.refresh_token_encrypted = await encryptCanonicalBlob(refreshResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }

      try {
        await patchRow('user_supabase_oauth', 'id', row.id, payload);
        remediation.push({ surface: 'user_supabase_oauth', primary_id: row.id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'user_supabase_oauth',
          primary_id: row.id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditUsers() {
  const rows = await fetchAllRows('users', {
    select: 'id,email,byok_key_encrypted,byok_keys,supabase_anon_key_encrypted,supabase_service_key_encrypted,created_at',
    order: 'created_at.asc,id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const byokKeyResult = await auditApiCryptoValue(row.byok_key_encrypted);
    const anonResult = await auditEnvCryptoValue(row.supabase_anon_key_encrypted);
    const serviceResult = await auditEnvCryptoValue(row.supabase_service_key_encrypted);
    const byokKeys = row.byok_keys && typeof row.byok_keys === 'object' ? row.byok_keys : {};
    const fields = [
      buildField('byok_key_encrypted', byokKeyResult),
      buildField('supabase_anon_key_encrypted', anonResult),
      buildField('supabase_service_key_encrypted', serviceResult),
    ].filter((field) => field.state !== 'absent');
    const nextByokKeys = { ...byokKeys };

    for (const [provider, entry] of Object.entries(byokKeys)) {
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      if (typeof entry.encrypted_key === 'string') {
        const entryResult = await auditApiCryptoValue(entry.encrypted_key);
        fields.push(buildField(`byok_keys.${provider}.encrypted_key`, entryResult));
        if (applyBackfill && entryResult.state === 'legacy_blob_backfillable') {
          nextByokKeys[provider] = {
            ...entry,
            encrypted_key: await encryptCanonicalBlob(entryResult.plaintext, BYOK_ENCRYPTION_KEY),
          };
        }
      } else if (typeof entry.key === 'string') {
        fields.push({
          field: `byok_keys.${provider}.key`,
          state: 'legacy_plaintext_backfillable',
          recommended_action: 'backfill_canonical_encryption',
        });
        if (applyBackfill) {
          const updatedEntry = { ...entry };
          delete updatedEntry.key;
          nextByokKeys[provider] = {
            ...updatedEntry,
            encrypted_key: await encryptCanonicalBlob(entry.key, BYOK_ENCRYPTION_KEY),
          };
        }
      }
    }

    const reportRow = {
      surface: 'users',
      primary_id: row.id,
      email: row.email,
      fields,
    };

    if (fields.length === 0) {
      continue;
    }

    if (applyBackfill && hasLegacyField(fields)) {
      const payload = {};
      if (byokKeyResult.state === 'legacy_blob_backfillable') {
        payload.byok_key_encrypted = await encryptCanonicalBlob(byokKeyResult.plaintext, BYOK_ENCRYPTION_KEY);
      }
      if (anonResult.state === 'legacy_blob_backfillable') {
        payload.supabase_anon_key_encrypted = await encryptCanonicalBlob(anonResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }
      if (serviceResult.state === 'legacy_blob_backfillable') {
        payload.supabase_service_key_encrypted = await encryptCanonicalBlob(serviceResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }
      if (JSON.stringify(nextByokKeys) !== JSON.stringify(byokKeys)) {
        payload.byok_keys = nextByokKeys;
      }

      try {
        await patchRow('users', 'id', row.id, payload);
        remediation.push({ surface: 'users', primary_id: row.id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'users',
          primary_id: row.id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditApps() {
  const rows = await fetchAllRows('apps', {
    select: 'id,name,slug,owner_id,supabase_anon_key_encrypted,supabase_service_key_encrypted,created_at',
    order: 'created_at.asc,id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const anonResult = await auditEnvCryptoValue(row.supabase_anon_key_encrypted);
    const serviceResult = await auditEnvCryptoValue(row.supabase_service_key_encrypted);
    const fields = [
      buildField('supabase_anon_key_encrypted', anonResult),
      buildField('supabase_service_key_encrypted', serviceResult),
    ].filter((field) => field.state !== 'absent');
    const reportRow = {
      surface: 'apps',
      primary_id: row.id,
      name: row.name,
      slug: row.slug,
      owner_id: row.owner_id,
      fields,
    };

    if (fields.length === 0) {
      continue;
    }

    if (applyBackfill && hasLegacyField(fields)) {
      const payload = {};
      if (anonResult.state === 'legacy_blob_backfillable') {
        payload.supabase_anon_key_encrypted = await encryptCanonicalBlob(anonResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }
      if (serviceResult.state === 'legacy_blob_backfillable') {
        payload.supabase_service_key_encrypted = await encryptCanonicalBlob(serviceResult.plaintext, ENV_VARS_ENCRYPTION_KEY);
      }

      try {
        await patchRow('apps', 'id', row.id, payload);
        remediation.push({ surface: 'apps', primary_id: row.id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'apps',
          primary_id: row.id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditDesktopOAuthSessions() {
  const rows = await fetchAllRows('desktop_oauth_sessions', {
    select: 'session_id,completed_at,expires_at,access_token_encrypted',
    filters: {
      expires_at: `gt.${new Date().toISOString()}`,
      access_token_encrypted: 'not.is.null',
    },
    order: 'expires_at.asc,session_id.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const tokenResult = await auditApiCryptoValue(row.access_token_encrypted);
    const fields = [buildField('access_token_encrypted', tokenResult)];
    const reportRow = {
      surface: 'desktop_oauth_sessions',
      primary_id: row.session_id,
      expires_at: row.expires_at,
      completed_at: row.completed_at,
      fields,
    };

    if (applyBackfill && tokenResult.state === 'legacy_blob_backfillable') {
      try {
        await patchRow('desktop_oauth_sessions', 'session_id', row.session_id, {
          access_token_encrypted: await encryptCanonicalBlob(tokenResult.plaintext, BYOK_ENCRYPTION_KEY),
        });
        remediation.push({ surface: 'desktop_oauth_sessions', primary_id: row.session_id, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'desktop_oauth_sessions',
          primary_id: row.session_id,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

async function auditOAuthAuthorizationCodes() {
  const rows = await fetchAllRows('oauth_authorization_codes', {
    select: 'code,client_id,user_id,expires_at,supabase_access_token,supabase_refresh_token,created_at',
    filters: {
      expires_at: `gt.${new Date().toISOString()}`,
    },
    order: 'expires_at.asc,code.asc',
  });

  const reportRows = [];
  const remediation = [];

  for (const row of rows) {
    const accessResult = await auditOAuthTokenValue(row.supabase_access_token);
    const refreshResult = await auditOAuthTokenValue(row.supabase_refresh_token);
    const fields = [
      buildField('supabase_access_token', accessResult),
      buildField('supabase_refresh_token', refreshResult),
    ].filter((field) => field.state !== 'absent');
    const reportRow = {
      surface: 'oauth_authorization_codes',
      primary_id: row.code,
      client_id: row.client_id,
      user_id: row.user_id,
      expires_at: row.expires_at,
      fields,
    };

    if (applyBackfill && hasLegacyField(fields)) {
      const payload = {};
      if (accessResult.state === 'legacy_plaintext_backfillable') {
        payload.supabase_access_token = await encryptCanonicalOAuthToken(accessResult.plaintext);
      }
      if (refreshResult.state === 'legacy_plaintext_backfillable') {
        payload.supabase_refresh_token = await encryptCanonicalOAuthToken(refreshResult.plaintext);
      }

      try {
        await patchRow('oauth_authorization_codes', 'code', row.code, payload);
        remediation.push({ surface: 'oauth_authorization_codes', primary_id: row.code, action: 'backfilled' });
        reportRow.remediation = 'backfilled';
      } catch (error) {
        remediation.push({
          surface: 'oauth_authorization_codes',
          primary_id: row.code,
          action: 'backfill_failed',
          error: error instanceof Error ? error.message : String(error),
        });
        reportRow.remediation = 'backfill_failed';
      }
    }

    reportRows.push(reportRow);
  }

  return { rows: reportRows, remediation };
}

const surfaceReports = await Promise.all([
  auditUserAppSecrets(),
  auditUserSupabaseConfigs(),
  auditUserSupabaseOAuth(),
  auditUsers(),
  auditApps(),
  auditDesktopOAuthSessions(),
  auditOAuthAuthorizationCodes(),
]);

const rows = surfaceReports.flatMap((report) => report.rows);
const remediation = {
  backfilled: [],
  failures: [],
};

for (const report of surfaceReports) {
  for (const item of report.remediation) {
    if (item.action === 'backfilled') {
      remediation.backfilled.push({
        surface: item.surface,
        primary_id: item.primary_id,
      });
    } else {
      remediation.failures.push(item);
    }
  }
}

const summary = rows.reduce((acc, row) => {
  acc.total_rows += 1;
  acc.by_surface[row.surface] = (acc.by_surface[row.surface] ?? 0) + 1;
  if (hasLegacyField(row.fields)) {
    acc.rows_with_legacy += 1;
  }
  if (hasUnreadableField(row.fields)) {
    acc.rows_with_unreadable += 1;
  }
  for (const field of row.fields) {
    acc.by_state[field.state] = (acc.by_state[field.state] ?? 0) + 1;
  }
  return acc;
}, {
  total_rows: 0,
  rows_with_legacy: 0,
  rows_with_unreadable: 0,
  by_surface: {},
  by_state: {},
});

const report = {
  generated_at: new Date().toISOString(),
  actions: {
    apply_backfill: applyBackfill,
  },
  summary,
  remediation,
  rows,
};

if (outputPath) {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(`Audited ${summary.total_rows} secret-bearing row(s).`);
console.log(`Rows with recoverable legacy state: ${summary.rows_with_legacy}`);
console.log(`Rows with unreadable secret state: ${summary.rows_with_unreadable}`);
for (const [surface, count] of Object.entries(summary.by_surface)) {
  console.log(`- ${surface}: ${count}`);
}
for (const [state, count] of Object.entries(summary.by_state)) {
  console.log(`- ${state}: ${count}`);
}
if (applyBackfill) {
  console.log(`Backfilled ${remediation.backfilled.length} row(s).`);
}
if (remediation.failures.length > 0) {
  console.log(`Remediation failures: ${remediation.failures.length}`);
}
if (outputPath) {
  console.log(`Wrote audit report to ${outputPath}`);
}
