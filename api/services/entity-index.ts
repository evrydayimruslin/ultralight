// Entity Index — per-user index of searchable entities across all D1-backed apps.
// Built on demand, stored in KV. Enables natural-language entity resolution
// (e.g., "email from Sarah" → resolve Sarah to a contact row).

import { getEnv } from '../lib/env.ts';
import { createD1DataService } from './d1-data.ts';

// ── Types ──

export interface Entity {
  appId: string;
  appSlug: string;
  table: string;
  rowId: number | string;
  label: string;
  searchTerms: string[];  // lowercase normalized terms for matching
  fields: Record<string, string>;  // key display fields from the row
}

export interface EntityIndex {
  entities: Entity[];
  appCount: number;
  updatedAt: string;
}

// Columns that likely contain searchable entity names/identifiers
const ENTITY_COLUMNS = new Set([
  'name', 'email', 'title', 'subject', 'label',
  'first_name', 'last_name', 'full_name', 'display_name',
  'username', 'handle', 'company', 'organization',
]);

// ── Build Index ──

/**
 * Rebuild the entity index for a user.
 * Scans all D1-backed apps for tables with entity-like columns,
 * extracts recent rows, and builds a searchable index stored in KV.
 */
export async function rebuildEntityIndex(userId: string): Promise<EntityIndex> {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getSupabaseEnv();
  const headers = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
  };

  // Fetch all user's apps that have D1 databases
  const appsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/apps?owner_id=eq.${userId}&deleted_at=is.null&d1_database_id=not.is.null&select=id,slug,d1_database_id`,
    { headers }
  );
  const apps = appsRes.ok
    ? await appsRes.json() as Array<{ id: string; slug: string; d1_database_id: string }>
    : [];

  const entities: Entity[] = [];

  for (const app of apps) {
    try {
      const d1 = createD1DataService(app.id, app.d1_database_id);

      // 1. Query sqlite_master for user tables
      const tables = await d1.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name != 'conventions'`
      );

      for (const table of tables) {
        try {
          // 2. Use PRAGMA table_info to find entity-like columns
          const columns = await d1.all<{ name: string; type: string }>(
            `PRAGMA table_info(${table.name})`
          );

          const entityCols = columns.filter(c => ENTITY_COLUMNS.has(c.name.toLowerCase()));
          if (entityCols.length === 0) continue;

          // 3. Query recent entities from this table
          const colNames = entityCols.map(c => c.name);
          const hasUserIdCol = columns.some(c => c.name === 'user_id');
          const hasRowId = columns.some(c => c.name === 'id' || c.name === 'rowid');

          const idCol = columns.find(c => c.name === 'id') ? 'id' : 'rowid';
          const selectCols = [idCol, ...colNames].join(', ');

          let query = `SELECT ${selectCols} FROM ${table.name}`;
          const params: unknown[] = [];

          if (hasUserIdCol) {
            query += ` WHERE user_id = ?`;
            params.push(userId);
          }

          query += ` ORDER BY rowid DESC LIMIT 20`;

          const rows = await d1.all<Record<string, unknown>>(query, params);

          for (const row of rows) {
            const entity = extractEntity(app.id, app.slug, table.name, row, idCol, colNames);
            if (entity) {
              entities.push(entity);
            }
          }
        } catch {
          // Skip tables that fail (e.g., permission issues, schema changes)
          continue;
        }
      }
    } catch {
      // Skip apps whose D1 is unreachable
      continue;
    }
  }

  const index: EntityIndex = {
    entities,
    appCount: apps.length,
    updatedAt: new Date().toISOString(),
  };

  // Store in KV
  const kv = (globalThis as any).__env?.FN_INDEX;
  if (kv) {
    try {
      await kv.put(`entities:${userId}`, JSON.stringify(index));
    } catch (err) {
      console.error(`KV write failed for entity index ${userId}:`, err);
    }
  }

  return index;
}

// ── Read Index ──

/**
 * Get the entity index for a user from KV.
 * Returns null if not yet built.
 */
export async function getEntityIndex(userId: string): Promise<EntityIndex | null> {
  const kv = (globalThis as any).__env?.FN_INDEX;
  if (!kv) return null;

  try {
    const data = await kv.get(`entities:${userId}`, 'json');
    if (data) return data as EntityIndex;
  } catch {
    // KV read failed
  }

  return null;
}

// ── Entity Extraction ──

/**
 * Extract a searchable Entity object from a database row.
 * Builds search terms from entity-like columns for fuzzy matching.
 */
export function extractEntity(
  appId: string,
  appSlug: string,
  table: string,
  row: Record<string, unknown>,
  idCol: string,
  entityCols: string[],
): Entity | null {
  const fields: Record<string, string> = {};
  const searchTerms: string[] = [];

  for (const col of entityCols) {
    const val = row[col];
    if (val == null || val === '') continue;

    const strVal = String(val).trim();
    fields[col] = strVal;

    // Split into individual search terms (lowercase)
    const normalized = strVal.toLowerCase();
    searchTerms.push(normalized);

    // Also add individual words for multi-word values
    const words = normalized.split(/[\s@.,;]+/).filter(w => w.length > 1);
    for (const word of words) {
      if (!searchTerms.includes(word)) {
        searchTerms.push(word);
      }
    }
  }

  // Skip rows with no searchable content
  if (searchTerms.length === 0) return null;

  // Build a human-readable label from the best available fields
  const label =
    fields['name'] || fields['full_name'] || fields['display_name'] ||
    fields['title'] || fields['subject'] || fields['email'] ||
    fields['username'] || searchTerms[0] || 'unknown';

  return {
    appId,
    appSlug,
    table,
    rowId: row[idCol] as number | string,
    label,
    searchTerms,
    fields,
  };
}

// ── Helpers ──

function getSupabaseEnv(): { SUPABASE_URL: string; SUPABASE_SERVICE_ROLE_KEY: string } {
  return {
    SUPABASE_URL: getEnv('SUPABASE_URL'),
    SUPABASE_SERVICE_ROLE_KEY: getEnv('SUPABASE_SERVICE_ROLE_KEY'),
  };
}
