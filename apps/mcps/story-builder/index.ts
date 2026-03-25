// Story Builder v2 — Ultralight MCP App
// Create fictional worlds with characters, relationships, arcs, factions, lore, and rules.
// Storage: Ultralight D1 | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

// ── helpers ──

function uuid() { return crypto.randomUUID(); }
function now() { return new Date().toISOString(); }
function uid() { return ultralight.user.id; }

async function getWorld(world_id: string) {
  return ultralight.db.first(
    'SELECT id, name, genre, description FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, uid()]
  );
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

// ── ADD CHARACTER ──

export async function add_character(args: {
  world_id: string;
  name: string;
  traits?: string[];
  backstory?: string;
  role?: string;
}): Promise<unknown> {
  const { world_id, name, traits, backstory, role } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO characters (id, user_id, world_id, name, traits, backstory, role, relationships, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, JSON.stringify(traits || []), backstory || '', role || '', '[]', ts, ts]
  );

  return { success: true, character_id: id, world: world.name, name };
}

// ── ADD SETTING ──

export async function add_setting(args: {
  world_id: string;
  name: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, description } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO locations (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, description, ts, ts]
  );

  return { success: true, setting_id: id, world: world.name, name };
}

// ── ADD THEME ──

export async function add_theme(args: {
  world_id: string;
  name: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, description } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO themes (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, description, ts, ts]
  );

  return { success: true, theme_id: id, world: world.name, name };
}

// ── ADD RELATIONSHIP ──

export async function add_relationship(args: {
  world_id: string;
  character_a_id: string;
  character_b_id: string;
  type: string;
  description?: string;
}): Promise<unknown> {
  const { world_id, character_a_id, character_b_id, type, description } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const charA = await ultralight.db.first(
    'SELECT id, name FROM characters WHERE id = ? AND user_id = ?',
    [character_a_id, uid()]
  );
  const charB = await ultralight.db.first(
    'SELECT id, name FROM characters WHERE id = ? AND user_id = ?',
    [character_b_id, uid()]
  );
  if (!charA) return { success: false, error: 'Character A not found: ' + character_a_id };
  if (!charB) return { success: false, error: 'Character B not found: ' + character_b_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO relationships (id, user_id, world_id, character_a_id, character_b_id, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, character_a_id, character_b_id, type, description || '', ts, ts]
  );

  return {
    success: true,
    relationship_id: id,
    world: world.name,
    between: [charA.name, charB.name],
    type,
  };
}

// ── ADD ARC ──

export async function add_arc(args: {
  world_id: string;
  name: string;
  type?: string;
  description: string;
  season?: string;
  episode_range?: string;
  character_ids?: string[];
}): Promise<unknown> {
  const { world_id, name, type, description, season, episode_range, character_ids } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const arcCount = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM arcs WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO arcs (id, user_id, world_id, name, type, description, season, episode_range, character_ids, arc_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, type || 'narrative', description, season || '', episode_range || '', JSON.stringify(character_ids || []), arcCount ? arcCount.cnt : 0, ts, ts]
  );

  return { success: true, arc_id: id, world: world.name, name };
}

// ── ADD FACTION ──

export async function add_faction(args: {
  world_id: string;
  name: string;
  description: string;
  member_ids?: string[];
}): Promise<unknown> {
  const { world_id, name, description, member_ids } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO factions (id, user_id, world_id, name, description, member_ids, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, description, JSON.stringify(member_ids || []), ts, ts]
  );

  return { success: true, faction_id: id, world: world.name, name };
}

// ── ADD LORE ──

export async function add_lore(args: {
  world_id: string;
  name: string;
  type?: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, type, description } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO lore (id, user_id, world_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, type || 'institution', description, ts, ts]
  );

  return { success: true, lore_id: id, world: world.name, name, type: type || 'institution' };
}

// ── ADD RULE ──

export async function add_rule(args: {
  world_id: string;
  name: string;
  type?: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, type, description } = args;
  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  const id = uuid();
  const ts = now();

  await ultralight.db.run(
    'INSERT INTO rules (id, user_id, world_id, name, type, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [id, uid(), world_id, name, type || 'constraint', description, ts, ts]
  );

  return { success: true, rule_id: id, world: world.name, name, type: type || 'constraint' };
}

// ── GENERATE (AI) ──

export async function generate(args: {
  world_id: string;
  type?: string;
  prompt?: string;
  character_ids?: string[];
  setting_id?: string;
  save?: boolean;
}): Promise<unknown> {
  const { world_id, type, prompt, character_ids, setting_id, save } = args;

  const world = await getWorld(world_id);
  if (!world) return { success: false, error: 'World not found: ' + world_id };

  // Build world context
  let context = 'WORLD: ' + world.name + '\nGenre: ' + world.genre + '\n';
  if (world.description) context += 'Description: ' + world.description + '\n';

  // Characters
  const chars = await ultralight.db.all(
    'SELECT id, name, role, traits, backstory FROM characters WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (chars.length > 0) {
    context += '\nCHARACTERS:\n';
    for (const char of chars) {
      const parsedTraits = JSON.parse(char.traits || '[]');
      context += '- ' + char.name;
      if (char.role) context += ' (' + char.role + ')';
      if (parsedTraits.length > 0) context += ': ' + parsedTraits.join(', ');
      if (char.backstory) context += '. ' + char.backstory;
      context += '\n';
    }
  }

  // Relationships
  const rels = await ultralight.db.all(
    'SELECT r.type, r.description, a.name as a_name, b.name as b_name FROM relationships r JOIN characters a ON r.character_a_id = a.id JOIN characters b ON r.character_b_id = b.id WHERE r.world_id = ? AND r.user_id = ?',
    [world_id, uid()]
  );
  if (rels.length > 0) {
    context += '\nRELATIONSHIPS:\n';
    for (const rel of rels) {
      context += '- ' + rel.a_name + ' ↔ ' + rel.b_name + ' [' + rel.type + ']';
      if (rel.description) context += ': ' + rel.description;
      context += '\n';
    }
  }

  // Factions
  const factions = await ultralight.db.all(
    'SELECT id, name, description, member_ids FROM factions WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (factions.length > 0) {
    context += '\nFACTIONS:\n';
    for (const faction of factions) {
      context += '- ' + faction.name + ': ' + faction.description;
      const memberIds = JSON.parse(faction.member_ids || '[]');
      if (memberIds.length > 0) {
        const charMap = new Map(chars.map((c: any) => [c.id, c.name]));
        const memberNames = memberIds.map((mid: string) => charMap.get(mid) || mid).filter(Boolean);
        if (memberNames.length > 0) context += ' [Members: ' + memberNames.join(', ') + ']';
      }
      context += '\n';
    }
  }

  // Arcs / Timeline
  const arcs = await ultralight.db.all(
    'SELECT name, type, description, season, episode_range, character_ids FROM arcs WHERE world_id = ? AND user_id = ? ORDER BY arc_order ASC',
    [world_id, uid()]
  );
  if (arcs.length > 0) {
    context += '\nNARRATIVE ARCS:\n';
    for (const arc of arcs) {
      context += '- ' + arc.name + ' [' + arc.type + ']';
      if (arc.season) context += ' (Season ' + arc.season;
      if (arc.episode_range) context += ', Ep ' + arc.episode_range;
      if (arc.season) context += ')';
      context += ': ' + arc.description;
      const arcCharIds = JSON.parse(arc.character_ids || '[]');
      if (arcCharIds.length > 0) {
        const charMap = new Map(chars.map((c: any) => [c.id, c.name]));
        const names = arcCharIds.map((cid: string) => charMap.get(cid) || cid).filter(Boolean);
        if (names.length > 0) context += ' [Characters: ' + names.join(', ') + ']';
      }
      context += '\n';
    }
  }

  // Lore
  const loreItems = await ultralight.db.all(
    'SELECT name, type, description FROM lore WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (loreItems.length > 0) {
    context += '\nLORE & INSTITUTIONS:\n';
    for (const item of loreItems) {
      context += '- ' + item.name + ' [' + item.type + ']: ' + item.description + '\n';
    }
  }

  // Rules / Constraints
  const ruleItems = await ultralight.db.all(
    'SELECT name, type, description FROM rules WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (ruleItems.length > 0) {
    context += '\nWORLD RULES & CRAFT CONSTRAINTS:\n';
    for (const rule of ruleItems) {
      context += '- ' + rule.name + ' [' + rule.type + ']: ' + rule.description + '\n';
    }
  }

  // Settings (locations)
  const settings = await ultralight.db.all(
    'SELECT id, name, description FROM locations WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (settings.length > 0) {
    context += '\nSETTINGS:\n';
    for (const setting of settings) {
      context += '- ' + setting.name + ': ' + setting.description + '\n';
    }
  }

  // Themes
  const storyThemes = await ultralight.db.all(
    'SELECT id, name, description FROM themes WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  if (storyThemes.length > 0) {
    context += '\nTHEMES:\n';
    for (const theme of storyThemes) {
      context += '- ' + theme.name + ': ' + theme.description + '\n';
    }
  }

  // Recent scenes for continuity (last 3)
  const scenes = await ultralight.db.all(
    'SELECT id, title, content FROM scenes WHERE world_id = ? AND user_id = ? ORDER BY scene_order DESC LIMIT 3',
    [world_id, uid()]
  );
  if (scenes.length > 0) {
    context += '\nRECENT SCENES:\n';
    for (const scene of scenes) {
      context += '--- ' + scene.title + ' ---\n' + scene.content.slice(0, 500) + '\n\n';
    }
  }

  // Specific character focus
  if (character_ids && character_ids.length > 0) {
    const placeholders = character_ids.map(() => '?').join(', ');
    const focused = await ultralight.db.all(
      'SELECT id, name FROM characters WHERE id IN (' + placeholders + ') AND user_id = ?',
      [...character_ids, uid()]
    );
    if (focused.length > 0) {
      context += '\nFOCUS CHARACTERS: ' + focused.map((f: any) => f.name).join(', ') + '\n';

      // Also include relationships for focused characters
      if (rels.length > 0) {
        const focusNames = new Set(focused.map((f: any) => f.name));
        const relevantRels = rels.filter((r: any) => focusNames.has(r.a_name) || focusNames.has(r.b_name));
        if (relevantRels.length > 0) {
          context += 'FOCUS CHARACTER RELATIONSHIPS:\n';
          for (const rel of relevantRels) {
            context += '- ' + rel.a_name + ' ↔ ' + rel.b_name + ' [' + rel.type + ']: ' + (rel.description || '') + '\n';
          }
        }
      }
    }
  }

  // Specific setting
  if (setting_id) {
    const setting = await ultralight.db.first(
      'SELECT id, name, description FROM locations WHERE id = ? AND user_id = ?',
      [setting_id, uid()]
    );
    if (setting) {
      context += '\nSCENE LOCATION: ' + setting.name + ' — ' + setting.description + '\n';
    }
  }

  const genType = type || 'scene';
  const userPrompt = prompt || 'Write the next ' + genType + ' in this story.';

  const sceneCountRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?',
    [world_id, uid()]
  );
  const sceneCount = sceneCountRow ? sceneCountRow.cnt : 0;

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a creative writing assistant. Using the provided world context — including characters, relationships, factions, narrative arcs, lore, and world rules — generate compelling ' + genType + ' content that is consistent with all established dimensions. Respect world rules and craft constraints. Write in a vivid, engaging style appropriate for the genre.',
        },
        {
          role: 'user',
          content: context + '\n\nREQUEST: ' + userPrompt,
        },
      ],
      max_tokens: 2000,
    });

    const content = response.content;

    let sceneId = null;
    if (save !== false) {
      sceneId = uuid();
      const ts = now();
      await ultralight.db.run(
        'INSERT INTO scenes (id, user_id, world_id, title, content, type, character_ids, setting_id, scene_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sceneId, uid(), world_id, genType + ' — ' + ts.split('T')[0], content, genType, JSON.stringify(character_ids || []), setting_id || null, sceneCount, ts, ts]
      );
    }

    return {
      type: genType,
      content: content,
      scene_id: sceneId,
      saved: save !== false,
      world: world.name,
    };
  } catch (e) {
    return { success: false, error: 'Generation failed. Try a simpler prompt or fewer context elements.' };
  }
}

// ── STATUS ──

export async function status(args?: {}): Promise<unknown> {
  const worlds = await ultralight.db.all(
    'SELECT id, name, genre FROM worlds WHERE user_id = ?',
    [uid()]
  );

  const worldList: any[] = [];

  for (const world of worlds) {
    const counts = await Promise.all([
      ultralight.db.first('SELECT COUNT(*) as cnt FROM characters WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM locations WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM themes WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM relationships WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM arcs WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM factions WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM lore WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
      ultralight.db.first('SELECT COUNT(*) as cnt FROM rules WHERE world_id = ? AND user_id = ?', [world.id, uid()]),
    ]);

    worldList.push({
      name: world.name,
      genre: world.genre,
      characters: counts[0]?.cnt || 0,
      settings: counts[1]?.cnt || 0,
      themes: counts[2]?.cnt || 0,
      scenes: counts[3]?.cnt || 0,
      relationships: counts[4]?.cnt || 0,
      arcs: counts[5]?.cnt || 0,
      factions: counts[6]?.cnt || 0,
      lore: counts[7]?.cnt || 0,
      rules: counts[8]?.cnt || 0,
    });
  }

  return { total_worlds: worlds.length, worlds: worldList };
}
