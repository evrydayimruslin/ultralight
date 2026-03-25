// Story Builder v3 — Ultralight MCP App
// 7 tools: create_world, add, read, update, delete, get_context, generate
// All lookups by name (unique per world). No UUIDs needed by the caller.
// Storage: Ultralight D1 | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function uid() { return ultralight.user.id; }

async function getWorld(world_id: string) {
  return ultralight.db.first(
    'SELECT id, name, genre, description FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, uid()]
  );
}

// Resolve a character by name or ID within a world
async function resolveChar(world_id: string, name_or_id: string): Promise<any> {
  return (
    await ultralight.db.first(
      'SELECT * FROM characters WHERE world_id = ? AND user_id = ? AND (id = ? OR name = ?)',
      [world_id, uid(), name_or_id, name_or_id]
    )
  );
}

// Resolve any entity by name or ID in a table
async function resolveEntity(table: string, world_id: string, name_or_id: string): Promise<any> {
  return ultralight.db.first(
    `SELECT * FROM ${table} WHERE world_id = ? AND user_id = ? AND (id = ? OR name = ?)`,
    [world_id, uid(), name_or_id, name_or_id]
  );
}

// Build a name→id map for characters in a world
async function charNameMap(world_id: string): Promise<Map<string, string>> {
  const chars = await ultralight.db.all(
    'SELECT id, name FROM characters WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  return new Map(chars.map((c: any) => [c.name, c.id]));
}

// ── CREATE WORLD ──

export async function create_world(args: {
  name: string;
  genre: string;
  description?: string;
}): Promise<unknown> {
  const { name, genre, description } = args;
  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO worlds (id, user_id, name, genre, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), name, genre, description || '', ts, ts]
  );

  return { success: true, world_id: id, name, genre };
}

// ── ADD (batch create any combination of entities) ──

export async function add(args: {
  world_id: string;
  characters?: Array<{ name: string; role?: string; traits?: string[]; backstory?: string }>;
  settings?: Array<{ name: string; description: string }>;
  themes?: Array<{ name: string; description: string }>;
  relationships?: Array<{ character_a: string; character_b: string; type: string; description?: string }>;
  arcs?: Array<{ name: string; type?: string; description: string; season?: string; episode_range?: string; characters?: string[] }>;
  factions?: Array<{ name: string; description: string; members?: string[] }>;
  lore?: Array<{ name: string; type?: string; description: string }>;
  rules?: Array<{ name: string; type?: string; description: string }>;
  scenes?: Array<{ title: string; content: string; type?: string; character_names?: string[]; setting_name?: string }>;
}): Promise<unknown> {
  const { world_id } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const ts = now();
  const created: Record<string, any[]> = {};

  // Characters first (so relationships/factions can reference them by name)
  if (args.characters && args.characters.length > 0) {
    created.characters = [];
    for (const c of args.characters) {
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO characters (id, user_id, world_id, name, traits, backstory, role, relationships, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, c.name, JSON.stringify(c.traits || []), c.backstory || '', c.role || '', '[]', ts, ts]
      );
      created.characters.push({ id, name: c.name });
    }
  }

  // Build name map after characters are created
  const nameMap = await charNameMap(world_id);

  // Settings
  if (args.settings && args.settings.length > 0) {
    created.settings = [];
    for (const s of args.settings) {
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO locations (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, s.name, s.description, ts, ts]
      );
      created.settings.push({ id, name: s.name });
    }
  }

  // Themes
  if (args.themes && args.themes.length > 0) {
    created.themes = [];
    for (const t of args.themes) {
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO themes (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, t.name, t.description, ts, ts]
      );
      created.themes.push({ id, name: t.name });
    }
  }

  // Relationships (by character name)
  if (args.relationships && args.relationships.length > 0) {
    created.relationships = [];
    for (const r of args.relationships) {
      const aId = nameMap.get(r.character_a);
      const bId = nameMap.get(r.character_b);
      if (!aId) { created.relationships.push({ error: 'Character not found: ' + r.character_a }); continue; }
      if (!bId) { created.relationships.push({ error: 'Character not found: ' + r.character_b }); continue; }
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO relationships (id, user_id, world_id, character_a_id, character_b_id, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, aId, bId, r.type, r.description || '', ts, ts]
      );
      created.relationships.push({ id, between: [r.character_a, r.character_b], type: r.type });
    }
  }

  // Arcs (character names resolved to IDs)
  if (args.arcs && args.arcs.length > 0) {
    created.arcs = [];
    const arcCount = (await ultralight.db.first('SELECT COUNT(*) as cnt FROM arcs WHERE world_id = ? AND user_id = ?', [world_id, uid()]))?.cnt || 0;
    let order = arcCount;
    for (const a of args.arcs) {
      const id = uuid();
      const charIds = (a.characters || []).map(n => nameMap.get(n)).filter(Boolean);
      await ultralight.db.run(
        'INSERT INTO arcs (id, user_id, world_id, name, type, description, season, episode_range, character_ids, arc_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, a.name, a.type || 'narrative', a.description, a.season || '', a.episode_range || '', JSON.stringify(charIds), order++, ts, ts]
      );
      created.arcs.push({ id, name: a.name });
    }
  }

  // Factions (member names resolved to IDs)
  if (args.factions && args.factions.length > 0) {
    created.factions = [];
    for (const f of args.factions) {
      const id = uuid();
      const memberIds = (f.members || []).map(n => nameMap.get(n)).filter(Boolean);
      await ultralight.db.run(
        'INSERT INTO factions (id, user_id, world_id, name, description, member_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, f.name, f.description, JSON.stringify(memberIds), ts, ts]
      );
      created.factions.push({ id, name: f.name });
    }
  }

  // Lore
  if (args.lore && args.lore.length > 0) {
    created.lore = [];
    for (const l of args.lore) {
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO lore (id, user_id, world_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, l.name, l.type || 'institution', l.description, ts, ts]
      );
      created.lore.push({ id, name: l.name });
    }
  }

  // Rules
  if (args.rules && args.rules.length > 0) {
    created.rules = [];
    for (const r of args.rules) {
      const id = uuid();
      await ultralight.db.run(
        'INSERT INTO rules (id, user_id, world_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, r.name, r.type || 'constraint', r.description, ts, ts]
      );
      created.rules.push({ id, name: r.name });
    }
  }

  // Scenes
  if (args.scenes && args.scenes.length > 0) {
    created.scenes = [];
    const sceneCount = (await ultralight.db.first('SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?', [world_id, uid()]))?.cnt || 0;
    let order = sceneCount;
    for (const s of args.scenes) {
      const id = uuid();
      const charIds = (s.character_names || []).map(n => nameMap.get(n)).filter(Boolean);
      const settingRow = s.setting_name ? await resolveEntity('locations', world_id, s.setting_name) : null;
      await ultralight.db.run(
        'INSERT INTO scenes (id, user_id, world_id, title, content, type, character_ids, setting_id, scene_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, uid(), world_id, s.title, s.content, s.type || 'scene', JSON.stringify(charIds), settingRow?.id || null, order++, ts, ts]
      );
      created.scenes.push({ id, title: s.title });
    }
  }

  return { success: true, world: world.name, created };
}

// ── READ (query any combination of dimensions) ──

export async function read(args: {
  world_id: string;
  include?: string[];
  character_name?: string;
  scene_limit?: number;
  scene_offset?: number;
}): Promise<unknown> {
  const { world_id } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const include = args.include || ['characters', 'settings', 'themes', 'relationships', 'arcs', 'factions', 'lore', 'rules', 'scenes'];
  const includeSet = new Set(include);
  const result: Record<string, any> = { world: { id: world.id, name: world.name, genre: world.genre, description: world.description } };

  // If zooming into a single character
  if (args.character_name) {
    const char = await resolveChar(world_id, args.character_name);
    if (!char) return { success: false, error: 'Character not found: ' + args.character_name };

    result.character = {
      id: char.id, name: char.name, role: char.role,
      traits: JSON.parse(char.traits || '[]'),
      backstory: char.backstory,
    };

    // Their relationships
    const rels = await ultralight.db.all(
      'SELECT r.*, a.name as a_name, b.name as b_name FROM relationships r JOIN characters a ON r.character_a_id = a.id JOIN characters b ON r.character_b_id = b.id WHERE r.world_id = ? AND r.user_id = ? AND (r.character_a_id = ? OR r.character_b_id = ?)',
      [world_id, uid(), char.id, char.id]
    );
    result.character.relationships = rels.map((r: any) => ({
      with: r.a_name === char.name ? r.b_name : r.a_name,
      type: r.type,
      description: r.description,
    }));

    // Scenes they appear in
    const scenes = await ultralight.db.all(
      'SELECT id, title, type, content, scene_order, created_at FROM scenes WHERE world_id = ? AND user_id = ? AND character_ids LIKE ? ORDER BY scene_order ASC',
      [world_id, uid(), '%' + char.id + '%']
    );
    result.character.scenes = scenes.map((s: any) => ({
      id: s.id, title: s.title, type: s.type, scene_order: s.scene_order,
      content_preview: s.content.slice(0, 300),
    }));

    // Factions they belong to
    const factions = await ultralight.db.all(
      'SELECT id, name, description, member_ids FROM factions WHERE world_id = ? AND user_id = ? AND member_ids LIKE ?',
      [world_id, uid(), '%' + char.id + '%']
    );
    result.character.factions = factions.map((f: any) => ({ name: f.name, description: f.description }));

    return { success: true, ...result };
  }

  // Full world read with include filter
  if (includeSet.has('characters')) {
    const chars = await ultralight.db.all(
      'SELECT id, name, role, traits, backstory FROM characters WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
    result.characters = chars.map((c: any) => ({
      id: c.id, name: c.name, role: c.role,
      traits: JSON.parse(c.traits || '[]'),
      backstory: c.backstory,
    }));
  }

  if (includeSet.has('settings')) {
    result.settings = await ultralight.db.all(
      'SELECT id, name, description FROM locations WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
  }

  if (includeSet.has('themes')) {
    result.themes = await ultralight.db.all(
      'SELECT id, name, description FROM themes WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
  }

  if (includeSet.has('relationships')) {
    const rels = await ultralight.db.all(
      'SELECT r.id, r.type, r.description, a.name as character_a, b.name as character_b FROM relationships r JOIN characters a ON r.character_a_id = a.id JOIN characters b ON r.character_b_id = b.id WHERE r.world_id = ? AND r.user_id = ?',
      [world_id, uid()]
    );
    result.relationships = rels;
  }

  if (includeSet.has('arcs')) {
    const arcs = await ultralight.db.all(
      'SELECT id, name, type, description, season, episode_range, character_ids, arc_order FROM arcs WHERE world_id = ? AND user_id = ? ORDER BY arc_order ASC',
      [world_id, uid()]
    );
    const nameMapData = result.characters ? new Map(result.characters.map((c: any) => [c.id, c.name])) : await charNameMap(world_id).then(m => new Map([...m].map(([k, v]) => [v, k])));
    // Build id→name map
    const idToName = new Map<string, string>();
    if (result.characters) {
      for (const c of result.characters) idToName.set(c.id, c.name);
    } else {
      const chars = await ultralight.db.all('SELECT id, name FROM characters WHERE world_id = ? AND user_id = ?', [world_id, uid()]);
      for (const c of chars) idToName.set(c.id, c.name);
    }
    result.arcs = arcs.map((a: any) => ({
      id: a.id, name: a.name, type: a.type, description: a.description,
      season: a.season, episode_range: a.episode_range, arc_order: a.arc_order,
      characters: JSON.parse(a.character_ids || '[]').map((id: string) => idToName.get(id) || id),
    }));
  }

  if (includeSet.has('factions')) {
    const factions = await ultralight.db.all(
      'SELECT id, name, description, member_ids FROM factions WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
    // Build id→name if not already done
    let idToName: Map<string, string>;
    if (result.characters) {
      idToName = new Map(result.characters.map((c: any) => [c.id, c.name]));
    } else {
      const chars = await ultralight.db.all('SELECT id, name FROM characters WHERE world_id = ? AND user_id = ?', [world_id, uid()]);
      idToName = new Map(chars.map((c: any) => [c.id, c.name]));
    }
    result.factions = factions.map((f: any) => ({
      id: f.id, name: f.name, description: f.description,
      members: JSON.parse(f.member_ids || '[]').map((id: string) => idToName.get(id) || id),
    }));
  }

  if (includeSet.has('lore')) {
    result.lore = await ultralight.db.all(
      'SELECT id, name, type, description FROM lore WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
  }

  if (includeSet.has('rules')) {
    result.rules = await ultralight.db.all(
      'SELECT id, name, type, description FROM rules WHERE world_id = ? AND user_id = ?',
      [world_id, uid()]
    );
  }

  if (includeSet.has('scenes')) {
    const limit = args.scene_limit || 10;
    const offset = args.scene_offset || 0;
    const scenes = await ultralight.db.all(
      'SELECT id, title, type, content, character_ids, setting_id, scene_order, created_at FROM scenes WHERE world_id = ? AND user_id = ? ORDER BY scene_order ASC LIMIT ? OFFSET ?',
      [world_id, uid(), limit, offset]
    );
    // Resolve names
    let idToName: Map<string, string>;
    if (result.characters) {
      idToName = new Map(result.characters.map((c: any) => [c.id, c.name]));
    } else {
      const chars = await ultralight.db.all('SELECT id, name FROM characters WHERE world_id = ? AND user_id = ?', [world_id, uid()]);
      idToName = new Map(chars.map((c: any) => [c.id, c.name]));
    }
    const settingsMap = new Map<string, string>();
    if (result.settings) {
      for (const s of result.settings) settingsMap.set(s.id, s.name);
    } else {
      const locs = await ultralight.db.all('SELECT id, name FROM locations WHERE world_id = ? AND user_id = ?', [world_id, uid()]);
      for (const l of locs) settingsMap.set(l.id, l.name);
    }
    const totalScenes = (await ultralight.db.first('SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?', [world_id, uid()]))?.cnt || 0;
    result.scenes = {
      total: totalScenes,
      offset,
      limit,
      items: scenes.map((s: any) => ({
        id: s.id, title: s.title, type: s.type, scene_order: s.scene_order,
        characters: JSON.parse(s.character_ids || '[]').map((id: string) => idToName.get(id) || id),
        setting: s.setting_id ? settingsMap.get(s.setting_id) || s.setting_id : null,
        content: s.content,
        created_at: s.created_at,
      })),
    };
  }

  return { success: true, ...result };
}

// ── UPDATE (batch update entities by name or ID) ──

export async function update(args: {
  world_id: string;
  world?: { name?: string; genre?: string; description?: string };
  characters?: Array<{ name_or_id: string; name?: string; role?: string; traits?: string[]; backstory?: string; merge_traits?: boolean }>;
  settings?: Array<{ name_or_id: string; name?: string; description?: string }>;
  themes?: Array<{ name_or_id: string; name?: string; description?: string }>;
  relationships?: Array<{ between: string[]; type?: string; description?: string }>;
  arcs?: Array<{ name_or_id: string; name?: string; type?: string; description?: string; season?: string; episode_range?: string; characters?: string[] }>;
  factions?: Array<{ name_or_id: string; name?: string; description?: string; add_members?: string[]; remove_members?: string[] }>;
  lore?: Array<{ name_or_id: string; name?: string; type?: string; description?: string }>;
  rules?: Array<{ name_or_id: string; name?: string; type?: string; description?: string }>;
}): Promise<unknown> {
  const { world_id } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const ts = now();
  const updated: Record<string, any[]> = {};

  // World metadata
  if (args.world) {
    const fields: string[] = [];
    const values: any[] = [];
    if (args.world.name !== undefined) { fields.push('name = ?'); values.push(args.world.name); }
    if (args.world.genre !== undefined) { fields.push('genre = ?'); values.push(args.world.genre); }
    if (args.world.description !== undefined) { fields.push('description = ?'); values.push(args.world.description); }
    if (fields.length > 0) {
      fields.push('updated_at = ?'); values.push(ts);
      values.push(world_id, uid());
      await ultralight.db.run(`UPDATE worlds SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
      updated.world = [{ success: true }];
    }
  }

  // Characters
  if (args.characters && args.characters.length > 0) {
    updated.characters = [];
    for (const c of args.characters) {
      const existing = await resolveChar(world_id, c.name_or_id);
      if (!existing) { updated.characters.push({ error: 'Not found: ' + c.name_or_id }); continue; }

      const fields: string[] = [];
      const values: any[] = [];
      if (c.name !== undefined) { fields.push('name = ?'); values.push(c.name); }
      if (c.role !== undefined) { fields.push('role = ?'); values.push(c.role); }
      if (c.backstory !== undefined) { fields.push('backstory = ?'); values.push(c.backstory); }
      if (c.traits !== undefined) {
        if (c.merge_traits) {
          const existingTraits = JSON.parse(existing.traits || '[]');
          const merged = [...new Set([...existingTraits, ...c.traits])];
          fields.push('traits = ?'); values.push(JSON.stringify(merged));
        } else {
          fields.push('traits = ?'); values.push(JSON.stringify(c.traits));
        }
      }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE characters SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.characters.push({ name: c.name || existing.name, success: true });
      }
    }
  }

  // Settings
  if (args.settings && args.settings.length > 0) {
    updated.settings = [];
    for (const s of args.settings) {
      const existing = await resolveEntity('locations', world_id, s.name_or_id);
      if (!existing) { updated.settings.push({ error: 'Not found: ' + s.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (s.name !== undefined) { fields.push('name = ?'); values.push(s.name); }
      if (s.description !== undefined) { fields.push('description = ?'); values.push(s.description); }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE locations SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.settings.push({ name: s.name || existing.name, success: true });
      }
    }
  }

  // Themes
  if (args.themes && args.themes.length > 0) {
    updated.themes = [];
    for (const t of args.themes) {
      const existing = await resolveEntity('themes', world_id, t.name_or_id);
      if (!existing) { updated.themes.push({ error: 'Not found: ' + t.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (t.name !== undefined) { fields.push('name = ?'); values.push(t.name); }
      if (t.description !== undefined) { fields.push('description = ?'); values.push(t.description); }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE themes SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.themes.push({ name: t.name || existing.name, success: true });
      }
    }
  }

  // Relationships (by name pair)
  if (args.relationships && args.relationships.length > 0) {
    updated.relationships = [];
    const nameMapData = await charNameMap(world_id);
    for (const r of args.relationships) {
      if (!r.between || r.between.length !== 2) { updated.relationships.push({ error: 'between must be [charA, charB]' }); continue; }
      const aId = nameMapData.get(r.between[0]);
      const bId = nameMapData.get(r.between[1]);
      if (!aId || !bId) { updated.relationships.push({ error: 'Character not found in pair: ' + r.between.join(', ') }); continue; }

      // Find relationship in either direction
      const existing = await ultralight.db.first(
        'SELECT id FROM relationships WHERE world_id = ? AND user_id = ? AND ((character_a_id = ? AND character_b_id = ?) OR (character_a_id = ? AND character_b_id = ?))',
        [world_id, uid(), aId, bId, bId, aId]
      );
      if (!existing) { updated.relationships.push({ error: 'No relationship between: ' + r.between.join(', ') }); continue; }

      const fields: string[] = [];
      const values: any[] = [];
      if (r.type !== undefined) { fields.push('type = ?'); values.push(r.type); }
      if (r.description !== undefined) { fields.push('description = ?'); values.push(r.description); }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE relationships SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.relationships.push({ between: r.between, success: true });
      }
    }
  }

  // Arcs
  if (args.arcs && args.arcs.length > 0) {
    updated.arcs = [];
    const nameMapData = await charNameMap(world_id);
    for (const a of args.arcs) {
      const existing = await resolveEntity('arcs', world_id, a.name_or_id);
      if (!existing) { updated.arcs.push({ error: 'Not found: ' + a.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (a.name !== undefined) { fields.push('name = ?'); values.push(a.name); }
      if (a.type !== undefined) { fields.push('type = ?'); values.push(a.type); }
      if (a.description !== undefined) { fields.push('description = ?'); values.push(a.description); }
      if (a.season !== undefined) { fields.push('season = ?'); values.push(a.season); }
      if (a.episode_range !== undefined) { fields.push('episode_range = ?'); values.push(a.episode_range); }
      if (a.characters !== undefined) {
        const charIds = a.characters.map(n => nameMapData.get(n)).filter(Boolean);
        fields.push('character_ids = ?'); values.push(JSON.stringify(charIds));
      }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE arcs SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.arcs.push({ name: a.name || existing.name, success: true });
      }
    }
  }

  // Factions (with add/remove members)
  if (args.factions && args.factions.length > 0) {
    updated.factions = [];
    const nameMapData = await charNameMap(world_id);
    for (const f of args.factions) {
      const existing = await resolveEntity('factions', world_id, f.name_or_id);
      if (!existing) { updated.factions.push({ error: 'Not found: ' + f.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (f.name !== undefined) { fields.push('name = ?'); values.push(f.name); }
      if (f.description !== undefined) { fields.push('description = ?'); values.push(f.description); }

      // Member management
      if (f.add_members || f.remove_members) {
        let currentMembers: string[] = JSON.parse(existing.member_ids || '[]');
        if (f.add_members) {
          const newIds = f.add_members.map(n => nameMapData.get(n)).filter(Boolean) as string[];
          currentMembers = [...new Set([...currentMembers, ...newIds])];
        }
        if (f.remove_members) {
          const removeIds = new Set(f.remove_members.map(n => nameMapData.get(n)).filter(Boolean));
          currentMembers = currentMembers.filter(id => !removeIds.has(id));
        }
        fields.push('member_ids = ?'); values.push(JSON.stringify(currentMembers));
      }

      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE factions SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.factions.push({ name: f.name || existing.name, success: true });
      }
    }
  }

  // Lore
  if (args.lore && args.lore.length > 0) {
    updated.lore = [];
    for (const l of args.lore) {
      const existing = await resolveEntity('lore', world_id, l.name_or_id);
      if (!existing) { updated.lore.push({ error: 'Not found: ' + l.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (l.name !== undefined) { fields.push('name = ?'); values.push(l.name); }
      if (l.type !== undefined) { fields.push('type = ?'); values.push(l.type); }
      if (l.description !== undefined) { fields.push('description = ?'); values.push(l.description); }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE lore SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.lore.push({ name: l.name || existing.name, success: true });
      }
    }
  }

  // Rules
  if (args.rules && args.rules.length > 0) {
    updated.rules = [];
    for (const r of args.rules) {
      const existing = await resolveEntity('rules', world_id, r.name_or_id);
      if (!existing) { updated.rules.push({ error: 'Not found: ' + r.name_or_id }); continue; }
      const fields: string[] = [];
      const values: any[] = [];
      if (r.name !== undefined) { fields.push('name = ?'); values.push(r.name); }
      if (r.type !== undefined) { fields.push('type = ?'); values.push(r.type); }
      if (r.description !== undefined) { fields.push('description = ?'); values.push(r.description); }
      if (fields.length > 0) {
        fields.push('updated_at = ?'); values.push(ts);
        values.push(existing.id, uid());
        await ultralight.db.run(`UPDATE rules SET ${fields.join(', ')} WHERE id = ? AND user_id = ?`, values);
        updated.rules.push({ name: r.name || existing.name, success: true });
      }
    }
  }

  return { success: true, world: world.name, updated };
}

// ── DELETE (batch delete entities by name or ID) ──

export async function remove(args: {
  world_id: string;
  characters?: string[];
  settings?: string[];
  themes?: string[];
  relationships?: string[];
  arcs?: string[];
  factions?: string[];
  lore?: string[];
  rules?: string[];
  scenes?: string[];
}): Promise<unknown> {
  const { world_id } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const deleted: Record<string, any[]> = {};

  // Helper: delete from table by name or ID
  async function deleteEntities(table: string, items: string[], label: string) {
    const results: any[] = [];
    for (const nameOrId of items) {
      const entity = await resolveEntity(table, world_id, nameOrId);
      if (!entity) { results.push({ error: 'Not found: ' + nameOrId }); continue; }
      await ultralight.db.run(`DELETE FROM ${table} WHERE id = ? AND user_id = ?`, [entity.id, uid()]);
      results.push({ name: entity.name || nameOrId, success: true });
    }
    deleted[label] = results;
  }

  if (args.characters) {
    // Also delete their relationships
    for (const nameOrId of args.characters) {
      const char = await resolveChar(world_id, nameOrId);
      if (char) {
        await ultralight.db.run(
          'DELETE FROM relationships WHERE user_id = ? AND (character_a_id = ? OR character_b_id = ?)',
          [uid(), char.id, char.id]
        );
      }
    }
    await deleteEntities('characters', args.characters, 'characters');
  }
  if (args.settings) await deleteEntities('locations', args.settings, 'settings');
  if (args.themes) await deleteEntities('themes', args.themes, 'themes');
  if (args.arcs) await deleteEntities('arcs', args.arcs, 'arcs');
  if (args.factions) await deleteEntities('factions', args.factions, 'factions');
  if (args.lore) await deleteEntities('lore', args.lore, 'lore');
  if (args.rules) await deleteEntities('rules', args.rules, 'rules');
  if (args.scenes) await deleteEntities('scenes', args.scenes, 'scenes');

  // Relationships by name pair ("Cash Bo / Blazer Sith") or ID
  if (args.relationships) {
    deleted.relationships = [];
    const nameMapData = await charNameMap(world_id);
    for (const item of args.relationships) {
      if (item.includes(' / ')) {
        const [nameA, nameB] = item.split(' / ').map(s => s.trim());
        const aId = nameMapData.get(nameA);
        const bId = nameMapData.get(nameB);
        if (!aId || !bId) { deleted.relationships.push({ error: 'Characters not found: ' + item }); continue; }
        const rel = await ultralight.db.first(
          'SELECT id FROM relationships WHERE world_id = ? AND user_id = ? AND ((character_a_id = ? AND character_b_id = ?) OR (character_a_id = ? AND character_b_id = ?))',
          [world_id, uid(), aId, bId, bId, aId]
        );
        if (!rel) { deleted.relationships.push({ error: 'No relationship: ' + item }); continue; }
        await ultralight.db.run('DELETE FROM relationships WHERE id = ? AND user_id = ?', [rel.id, uid()]);
        deleted.relationships.push({ between: item, success: true });
      } else {
        // By ID
        const rel = await ultralight.db.first('SELECT id FROM relationships WHERE id = ? AND user_id = ?', [item, uid()]);
        if (!rel) { deleted.relationships.push({ error: 'Not found: ' + item }); continue; }
        await ultralight.db.run('DELETE FROM relationships WHERE id = ? AND user_id = ?', [item, uid()]);
        deleted.relationships.push({ id: item, success: true });
      }
    }
  }

  return { success: true, world: world.name, deleted };
}

// ── GET CONTEXT (full world dump for agent handoff) ──

export async function get_context(args: {
  world_id: string;
  format?: string;
}): Promise<unknown> {
  const { world_id } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  // Get everything
  const fullRead = await read({ world_id, scene_limit: 100 }) as any;

  if (args.format === 'narrative') {
    // AI-generated handoff brief
    let context = `World: ${world.name} (${world.genre})\n`;
    if (world.description) context += world.description + '\n';

    if (fullRead.characters?.length) {
      context += `\n${fullRead.characters.length} Characters:\n`;
      for (const c of fullRead.characters) {
        context += `- ${c.name}${c.role ? ' (' + c.role + ')' : ''}`;
        if (c.traits?.length) context += ': ' + c.traits.join(', ');
        if (c.backstory) context += '. ' + c.backstory;
        context += '\n';
      }
    }

    if (fullRead.relationships?.length) {
      context += `\n${fullRead.relationships.length} Relationships:\n`;
      for (const r of fullRead.relationships) {
        context += `- ${r.character_a} ↔ ${r.character_b} [${r.type}]${r.description ? ': ' + r.description : ''}\n`;
      }
    }

    if (fullRead.factions?.length) {
      context += `\n${fullRead.factions.length} Factions:\n`;
      for (const f of fullRead.factions) {
        context += `- ${f.name}: ${f.description}${f.members?.length ? ' [' + f.members.join(', ') + ']' : ''}\n`;
      }
    }

    if (fullRead.arcs?.length) {
      context += `\nNarrative Arcs:\n`;
      for (const a of fullRead.arcs) {
        context += `- ${a.name} [${a.type}]`;
        if (a.season) context += ` (S${a.season}${a.episode_range ? ' E' + a.episode_range : ''})`;
        context += `: ${a.description}`;
        if (a.characters?.length) context += ` [${a.characters.join(', ')}]`;
        context += '\n';
      }
    }

    if (fullRead.lore?.length) {
      context += `\nLore & Institutions:\n`;
      for (const l of fullRead.lore) {
        context += `- ${l.name} [${l.type}]: ${l.description}\n`;
      }
    }

    if (fullRead.rules?.length) {
      context += `\nWorld Rules & Constraints:\n`;
      for (const r of fullRead.rules) {
        context += `- ${r.name} [${r.type}]: ${r.description}\n`;
      }
    }

    if (fullRead.settings?.length) {
      context += `\nSettings:\n`;
      for (const s of fullRead.settings) {
        context += `- ${s.name}: ${s.description}\n`;
      }
    }

    if (fullRead.themes?.length) {
      context += `\nThemes:\n`;
      for (const t of fullRead.themes) {
        context += `- ${t.name}: ${t.description}\n`;
      }
    }

    if (fullRead.scenes?.items?.length) {
      context += `\n${fullRead.scenes.total} Scenes (timeline):\n`;
      for (const s of fullRead.scenes.items) {
        context += `--- [${s.scene_order}] ${s.title} (${s.type})`;
        if (s.characters?.length) context += ` — ${s.characters.join(', ')}`;
        if (s.setting) context += ` @ ${s.setting}`;
        context += ` ---\n${s.content.slice(0, 500)}\n\n`;
      }
    }

    try {
      const response = await ultralight.ai({
        model: 'openai/gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a story bible summarizer. Given the full structured data of a fictional world, produce a concise but comprehensive handoff brief. Cover: premise, key characters and their dynamics, political landscape, active narrative arcs and where they stand, world rules, and what has happened so far in generated scenes. Be specific — use character names, relationship types, faction allegiances. The brief should let a new writer pick up exactly where the last one left off.' },
          { role: 'user', content: context },
        ],
        max_tokens: 2000,
      });
      return { success: true, world: world.name, format: 'narrative', brief: response.content };
    } catch {
      // Fallback to structured if AI fails
      return { success: true, world: world.name, format: 'structured', ...fullRead };
    }
  }

  // Default: structured
  return { success: true, world: world.name, format: 'structured', ...fullRead };
}

// ── GENERATE (AI) ──

export async function generate(args: {
  world_id: string;
  type?: string;
  prompt?: string;
  character_names?: string[];
  setting_name?: string;
  save?: boolean;
}): Promise<unknown> {
  const { world_id, type, prompt, character_names, setting_name, save } = args;

  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  // Use get_context to build the full world state
  const contextResult = await get_context({ world_id, format: 'narrative' }) as any;
  let context = '';
  if (contextResult.brief) {
    context = contextResult.brief;
  } else {
    // Fallback: build context manually from structured data
    const fullRead = await read({ world_id, scene_limit: 5 }) as any;
    context = 'WORLD: ' + world.name + ' (' + world.genre + ')\n';
    if (world.description) context += world.description + '\n';

    if (fullRead.characters?.length) {
      context += '\nCHARACTERS:\n';
      for (const c of fullRead.characters) {
        context += '- ' + c.name;
        if (c.role) context += ' (' + c.role + ')';
        if (c.traits?.length) context += ': ' + c.traits.join(', ');
        if (c.backstory) context += '. ' + c.backstory;
        context += '\n';
      }
    }

    if (fullRead.relationships?.length) {
      context += '\nRELATIONSHIPS:\n';
      for (const r of fullRead.relationships) {
        context += '- ' + r.character_a + ' ↔ ' + r.character_b + ' [' + r.type + ']';
        if (r.description) context += ': ' + r.description;
        context += '\n';
      }
    }

    if (fullRead.factions?.length) {
      context += '\nFACTIONS:\n';
      for (const f of fullRead.factions) context += '- ' + f.name + ': ' + f.description + '\n';
    }
    if (fullRead.arcs?.length) {
      context += '\nARCS:\n';
      for (const a of fullRead.arcs) context += '- ' + a.name + ' [' + a.type + ']: ' + a.description + '\n';
    }
    if (fullRead.lore?.length) {
      context += '\nLORE:\n';
      for (const l of fullRead.lore) context += '- ' + l.name + ': ' + l.description + '\n';
    }
    if (fullRead.rules?.length) {
      context += '\nRULES:\n';
      for (const r of fullRead.rules) context += '- ' + r.name + ': ' + r.description + '\n';
    }
    if (fullRead.settings?.length) {
      context += '\nSETTINGS:\n';
      for (const s of fullRead.settings) context += '- ' + s.name + ': ' + s.description + '\n';
    }
    if (fullRead.themes?.length) {
      context += '\nTHEMES:\n';
      for (const t of fullRead.themes) context += '- ' + t.name + ': ' + t.description + '\n';
    }
    if (fullRead.scenes?.items?.length) {
      context += '\nRECENT SCENES:\n';
      for (const s of fullRead.scenes.items) context += '--- ' + s.title + ' ---\n' + s.content.slice(0, 500) + '\n\n';
    }
  }

  // Focus characters
  if (character_names && character_names.length > 0) {
    context += '\nFOCUS CHARACTERS: ' + character_names.join(', ') + '\n';
  }

  // Setting
  if (setting_name) {
    const setting = await resolveEntity('locations', world_id, setting_name);
    if (setting) {
      context += '\nSCENE LOCATION: ' + setting.name + ' — ' + setting.description + '\n';
    }
  }

  const genType = type || 'scene';
  const userPrompt = prompt || 'Write the next ' + genType + ' in this story.';

  const sceneCount = (await ultralight.db.first('SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?', [world_id, uid()]))?.cnt || 0;

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a creative writing assistant. Using the provided world context — including characters, relationships, factions, narrative arcs, lore, and world rules — generate compelling ' + genType + ' content that is consistent with all established dimensions. Respect world rules and craft constraints. Write in a vivid, engaging style appropriate for the genre.',
        },
        { role: 'user', content: context + '\n\nREQUEST: ' + userPrompt },
      ],
      max_tokens: 2000,
    });

    const content = response.content;

    // Save scene with character and setting linkage
    let sceneId = null;
    if (save !== false) {
      sceneId = uuid();
      const ts = now();
      const nameMapData = await charNameMap(world_id);
      const charIds = (character_names || []).map(n => nameMapData.get(n)).filter(Boolean);
      const settingRow = setting_name ? await resolveEntity('locations', world_id, setting_name) : null;

      await ultralight.db.run(
        'INSERT INTO scenes (id, user_id, world_id, title, content, type, character_ids, setting_id, scene_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sceneId, uid(), world_id, genType + ' — ' + ts.split('T')[0], content, genType, JSON.stringify(charIds), settingRow?.id || null, sceneCount, ts, ts]
      );
    }

    return {
      type: genType,
      content,
      scene_id: sceneId,
      saved: save !== false,
      world: world.name,
      scene_order: sceneCount,
    };
  } catch (e) {
    return { success: false, error: 'Generation failed. Try a simpler prompt or fewer context elements.' };
  }
}
