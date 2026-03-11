// Story Builder — Ultralight MCP App
// Create fictional worlds, characters, and plotlines that persist across sessions.
// Storage: Ultralight KV | Permissions: ai:call

const ultralight = (globalThis as any).ultralight;

// ── CREATE WORLD ──

export async function create_world(args: {
  name: string;
  genre: string;
  description?: string;
}): Promise<unknown> {
  const { name, genre, description } = args;
  const id = crypto.randomUUID();

  const world = {
    id: id,
    name: name,
    genre: genre,
    description: description || '',
    created_at: new Date().toISOString(),
  };

  await ultralight.store('worlds/' + id, world);

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

  const world = await ultralight.load('worlds/' + world_id) as any;
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const character = {
    id: id,
    world_id: world_id,
    name: name,
    traits: traits || [],
    backstory: backstory || '',
    role: role || '',
    relationships: [],
    created_at: new Date().toISOString(),
  };

  await ultralight.store('characters/' + world_id + '/' + id, character);

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

  const world = await ultralight.load('worlds/' + world_id) as any;
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const setting = {
    id: id,
    world_id: world_id,
    name: name,
    description: description,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('settings/' + world_id + '/' + id, setting);

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

  const world = await ultralight.load('worlds/' + world_id) as any;
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  const id = crypto.randomUUID();
  const theme = {
    id: id,
    world_id: world_id,
    name: name,
    description: description,
    created_at: new Date().toISOString(),
  };

  await ultralight.store('themes/' + world_id + '/' + id, theme);

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

  const world = await ultralight.load('worlds/' + world_id) as any;
  if (!world) {
    return { success: false, error: 'World not found: ' + world_id };
  }

  // Build world context
  let context = 'WORLD: ' + world.name + '\nGenre: ' + world.genre + '\n';
  if (world.description) context += 'Description: ' + world.description + '\n';

  // Load characters
  const charKeys = await ultralight.list('characters/' + world_id + '/');
  if (charKeys.length > 0) {
    const chars = await ultralight.batchLoad(charKeys);
    context += '\nCHARACTERS:\n';
    for (const c of chars) {
      const char = c.value as any;
      context += '- ' + char.name;
      if (char.role) context += ' (' + char.role + ')';
      if (char.traits && char.traits.length > 0) context += ': ' + char.traits.join(', ');
      if (char.backstory) context += '. ' + char.backstory;
      context += '\n';
    }
  }

  // Load settings
  const settingKeys = await ultralight.list('settings/' + world_id + '/');
  if (settingKeys.length > 0) {
    const settings = await ultralight.batchLoad(settingKeys);
    context += '\nSETTINGS:\n';
    for (const s of settings) {
      const setting = s.value as any;
      context += '- ' + setting.name + ': ' + setting.description + '\n';
    }
  }

  // Load themes
  const themeKeys = await ultralight.list('themes/' + world_id + '/');
  if (themeKeys.length > 0) {
    const themes = await ultralight.batchLoad(themeKeys);
    context += '\nTHEMES:\n';
    for (const t of themes) {
      const theme = t.value as any;
      context += '- ' + theme.name + ': ' + theme.description + '\n';
    }
  }

  // Load recent scenes for continuity
  const sceneKeys = await ultralight.list('scenes/' + world_id + '/');
  if (sceneKeys.length > 0) {
    const scenes = await ultralight.batchLoad(sceneKeys.slice(-3)); // last 3 scenes
    context += '\nRECENT SCENES:\n';
    for (const s of scenes) {
      const scene = s.value as any;
      context += '--- ' + scene.title + ' ---\n' + scene.content.slice(0, 500) + '\n\n';
    }
  }

  // Specific character focus
  if (character_ids && character_ids.length > 0) {
    context += '\nFOCUS CHARACTERS: ';
    const focusKeys = character_ids.map((id) => 'characters/' + world_id + '/' + id);
    const focused = await ultralight.batchLoad(focusKeys);
    context += focused.filter((f: any) => f.value).map((f: any) => (f.value as any).name).join(', ') + '\n';
  }

  // Specific setting
  if (setting_id) {
    const setting = await ultralight.load('settings/' + world_id + '/' + setting_id) as any;
    if (setting) {
      context += '\nSCENE LOCATION: ' + setting.name + ' — ' + setting.description + '\n';
    }
  }

  const genType = type || 'scene';
  const userPrompt = prompt || 'Write the next ' + genType + ' in this story.';

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
      await ultralight.store('scenes/' + world_id + '/' + sceneId, {
        id: sceneId,
        world_id: world_id,
        title: genType + ' — ' + new Date().toISOString().split('T')[0],
        content: content,
        type: genType,
        character_ids: character_ids || [],
        setting_id: setting_id || null,
        order: sceneKeys.length,
        created_at: new Date().toISOString(),
      });
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
  const worldKeys = await ultralight.list('worlds/');
  const worlds: any[] = [];

  for (const key of worldKeys) {
    const world = await ultralight.load(key) as any;
    const worldId = world.id;
    const charCount = (await ultralight.list('characters/' + worldId + '/')).length;
    const settingCount = (await ultralight.list('settings/' + worldId + '/')).length;
    const themeCount = (await ultralight.list('themes/' + worldId + '/')).length;
    const sceneCount = (await ultralight.list('scenes/' + worldId + '/')).length;

    worlds.push({
      name: world.name,
      genre: world.genre,
      characters: charCount,
      settings: settingCount,
      themes: themeCount,
      scenes: sceneCount,
    });
  }

  return {
    total_worlds: worldKeys.length,
    worlds: worlds,
  };
}
