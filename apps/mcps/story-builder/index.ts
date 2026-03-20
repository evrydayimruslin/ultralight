// Story Builder — Ultralight MCP App
// Create fictional worlds, characters, and plotlines that persist across sessions.
// Storage: Ultralight D1 | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

// ── CREATE WORLD ──

export async function create_world(args: {
  name: string;
  genre: string;
  description?: string;
}): Promise<unknown> {
  const { name, genre, description } = args;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO worlds (id, user_id, name, genre, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, name, genre, description || '', now, now]
  );

  return {
    success: true,
    world_id: id,
    name: name,
    genre: genre,
  };
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

  const world = await ultralight.db.first(
    'SELECT id, name FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO characters (id, user_id, world_id, name, traits, backstory, role, relationships, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, world_id, name, JSON.stringify(traits || []), backstory || '', role || '', '[]', now, now]
  );

  return {
    success: true,
    character_id: id,
    world: world.name,
    name: name,
  };
}

// ── ADD SETTING ──

export async function add_setting(args: {
  world_id: string;
  name: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, description } = args;

  const world = await ultralight.db.first(
    'SELECT id, name FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO locations (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, world_id, name, description, now, now]
  );

  return {
    success: true,
    setting_id: id,
    world: world.name,
    name: name,
  };
}

// ── ADD THEME ──

export async function add_theme(args: {
  world_id: string;
  name: string;
  description: string;
}): Promise<unknown> {
  const { world_id, name, description } = args;

  const world = await ultralight.db.first(
    'SELECT id, name FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await ultralight.db.run(
    'INSERT INTO themes (id, user_id, world_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, ultralight.user.id, world_id, name, description, now, now]
  );

  return {
    success: true,
    theme_id: id,
    world: world.name,
    name: name,
  };
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

  const world = await ultralight.db.first(
    'SELECT id, name, genre, description FROM worlds WHERE id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  // Build world context
  let context = 'WORLD: ' + world.name + '\nGenre: ' + world.genre + '\n';
  if (world.description) context += 'Description: ' + world.description + '\n';

  // Load characters
  const chars = await ultralight.db.all(
    'SELECT id, name, role, traits, backstory FROM characters WHERE world_id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
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

  // Load settings (locations)
  const settings = await ultralight.db.all(
    'SELECT id, name, description FROM locations WHERE world_id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (settings.length > 0) {
    context += '\nSETTINGS:\n';
    for (const setting of settings) {
      context += '- ' + setting.name + ': ' + setting.description + '\n';
    }
  }

  // Load themes
  const storyThemes = await ultralight.db.all(
    'SELECT id, name, description FROM themes WHERE world_id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  if (storyThemes.length > 0) {
    context += '\nTHEMES:\n';
    for (const theme of storyThemes) {
      context += '- ' + theme.name + ': ' + theme.description + '\n';
    }
  }

  // Load recent scenes for continuity (last 3)
  const scenes = await ultralight.db.all(
    'SELECT id, title, content FROM scenes WHERE world_id = ? AND user_id = ? ORDER BY scene_order DESC LIMIT 3',
    [world_id, ultralight.user.id]
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
      [...character_ids, ultralight.user.id]
    );
    if (focused.length > 0) {
      context += '\nFOCUS CHARACTERS: ' + focused.map((f: any) => f.name).join(', ') + '\n';
    }
  }

  // Specific setting
  if (setting_id) {
    const setting = await ultralight.db.first(
      'SELECT id, name, description FROM locations WHERE id = ? AND user_id = ?',
      [setting_id, ultralight.user.id]
    );
    if (setting) {
      context += '\nSCENE LOCATION: ' + setting.name + ' — ' + setting.description + '\n';
    }
  }

  const genType = type || 'scene';
  const userPrompt = prompt || 'Write the next ' + genType + ' in this story.';

  // Count existing scenes for ordering
  const sceneCountRow = await ultralight.db.first(
    'SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?',
    [world_id, ultralight.user.id]
  );
  const sceneCount = sceneCountRow ? sceneCountRow.cnt : 0;

  try {
    const response = await ultralight.ai({
      model: 'openai/gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a creative writing assistant. Using the provided world context, generate compelling ' + genType + ' content that is consistent with the established characters, settings, and themes. Write in a vivid, engaging style appropriate for the genre.',
        },
        {
          role: 'user',
          content: context + '\n\nREQUEST: ' + userPrompt,
        },
      ],
      max_tokens: 2000,
    });

    const content = response.content;

    // Save as scene if requested
    let sceneId = null;
    if (save !== false) {
      sceneId = crypto.randomUUID();
      const now = new Date().toISOString();
      await ultralight.db.run(
        'INSERT INTO scenes (id, user_id, world_id, title, content, type, character_ids, setting_id, scene_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [sceneId, ultralight.user.id, world_id, genType + ' — ' + now.split('T')[0], content, genType, JSON.stringify(character_ids || []), setting_id || null, sceneCount, now, now]
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
    [ultralight.user.id]
  );

  const worldList: any[] = [];

  for (const world of worlds) {
    const charCount = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM characters WHERE world_id = ? AND user_id = ?',
      [world.id, ultralight.user.id]
    );
    const settingCount = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM locations WHERE world_id = ? AND user_id = ?',
      [world.id, ultralight.user.id]
    );
    const themeCount = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM themes WHERE world_id = ? AND user_id = ?',
      [world.id, ultralight.user.id]
    );
    const sceneCount = await ultralight.db.first(
      'SELECT COUNT(*) as cnt FROM scenes WHERE world_id = ? AND user_id = ?',
      [world.id, ultralight.user.id]
    );

    worldList.push({
      name: world.name,
      genre: world.genre,
      characters: charCount ? charCount.cnt : 0,
      settings: settingCount ? settingCount.cnt : 0,
      themes: themeCount ? themeCount.cnt : 0,
      scenes: sceneCount ? sceneCount.cnt : 0,
    });
  }

  return {
    total_worlds: worlds.length,
    worlds: worldList,
  };
}
