#!/usr/bin/env -S deno run --allow-net --allow-read --allow-write --allow-env

/**
 * Ultralight CLI
 * Command-line interface for managing Ultralight apps
 *
 * Usage:
 *   ultralight <command> [options]
 *
 * Commands:
 *   login           Authenticate with Ultralight
 *   logout          Clear stored credentials
 *   whoami          Show current user
 *   scaffold        Generate a structured app skeleton (ul.scaffold)
 *   upload          Upload a new app or update existing
 *   test            Test functions without deploying (ul.test)
 *   lint            Validate code against conventions (ul.lint)
 *   apps            App management commands
 *   draft           Draft management commands
 *   docs            Documentation commands
 *   run             Execute a deployed app function
 *   discover        Search the App Store for MCP tools
 *
 * Run `ultralight <command> --help` for more information on a command.
 */

import { parseArgs, getConfig, saveConfig, clearConfig, type Config } from './config.ts';
import { ApiClient } from './api.ts';
import { colors } from './colors.ts';

const VERSION = '1.1.0';

// Command handlers
const commands: Record<string, (args: string[], client: ApiClient, config: Config) => Promise<void>> = {
  init,
  login,
  logout,
  whoami,
  upload,
  apps,
  draft,
  docs,
  test: testCmd,
  lint,
  scaffold,
  run,
  discover,
  config: configCmd,
  help,
  version,
};

async function main() {
  const args = Deno.args;

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    await help([], null as unknown as ApiClient, {} as Config);
    return;
  }

  if (args[0] === '--version' || args[0] === '-v') {
    console.log(`ultralight v${VERSION}`);
    return;
  }

  const command = args[0];
  const commandArgs = args.slice(1);

  if (!commands[command]) {
    console.error(colors.red(`Unknown command: ${command}`));
    console.error(`Run ${colors.cyan('ultralight help')} for available commands.`);
    Deno.exit(1);
  }

  try {
    const config = await getConfig();
    const client = new ApiClient(config);

    await commands[command](commandArgs, client, config);
  } catch (err) {
    if (err instanceof Error) {
      console.error(colors.red(`Error: ${err.message}`));
    } else {
      console.error(colors.red('An unexpected error occurred'));
    }
    Deno.exit(1);
  }
}

// ============================================
// COMMAND IMPLEMENTATIONS
// ============================================

async function help(_args: string[], _client: ApiClient, _config: Config) {
  console.log(`
${colors.bold('Ultralight CLI')} v${VERSION}

${colors.dim('USAGE')}
  ultralight <command> [options]

${colors.dim('COMMANDS')}
  ${colors.cyan('init')} [name]        Create a new Ultralight app project
  ${colors.cyan('scaffold')} <name>    Generate a structured app skeleton (uses ul.scaffold)
  ${colors.cyan('login')}              Authenticate with Ultralight
  ${colors.cyan('logout')}             Clear stored credentials
  ${colors.cyan('whoami')}             Show current user

  ${colors.cyan('upload')} [dir]       Upload a new app or update existing
  ${colors.cyan('test')} [dir]         Test functions without deploying (uses ul.test)
  ${colors.cyan('lint')} [dir]         Validate code against platform conventions (uses ul.lint)
  ${colors.cyan('apps')}               App management (list, get, delete, update)
  ${colors.cyan('draft')}              Draft management (upload, status, publish, discard)
  ${colors.cyan('docs')}               Documentation (generate, get, update)

  ${colors.cyan('run')} <app> <fn>     Execute a deployed app function
  ${colors.cyan('discover')} <q>       Search the App Store for MCP tools

  ${colors.cyan('config')}             CLI configuration
  ${colors.cyan('help')}               Show this help message
  ${colors.cyan('version')}            Show version

${colors.dim('OPTIONS')}
  --help, -h      Show help for a command
  --version, -v   Show version

${colors.dim('BUILD WORKFLOW')}
  1. ${colors.cyan('ultralight scaffold my-app')}        Generate skeleton
  2. Fill in function implementations
  3. ${colors.cyan('ultralight test .')}                  Verify functions work
  4. ${colors.cyan('ultralight lint .')}                  Validate conventions
  5. ${colors.cyan('ultralight upload .')}                Deploy

${colors.dim('EXAMPLES')}
  ultralight scaffold my-app --storage supabase
  ultralight test . --function hello '{"name":"World"}'
  ultralight lint . --strict
  ultralight discover "weather API"
  ultralight run my-app hello '{"name": "World"}'

${colors.dim('DOCUMENTATION')}
  https://ultralight.dev/docs/cli
`);
}

async function version(_args: string[], _client: ApiClient, _config: Config) {
  console.log(`ultralight v${VERSION}`);
}

// ============================================
// INIT COMMAND
// ============================================

async function init(args: string[], _client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    boolean: ['react', 'help'],
    alias: { r: 'react', h: 'help' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight init')} [name]

Create a new Ultralight app project with TypeScript types and starter template.

${colors.dim('OPTIONS')}
  --react, -r     Use React template instead of basic TypeScript

${colors.dim('EXAMPLES')}
  ultralight init my-app          # Create basic TypeScript app
  ultralight init my-app --react  # Create React app

${colors.dim('WHAT IT CREATES')}
  my-app/
  ├── index.ts         # Entry point with example functions
  ├── tsconfig.json    # TypeScript config
  ├── package.json     # Dependencies (types only)
  └── README.md        # Quick reference
`);
    return;
  }

  const projectName = parsed._[0] as string || 'ultralight-app';
  const useReact = parsed.react as boolean;

  // Check if directory already exists
  try {
    const stat = await Deno.stat(projectName);
    if (stat.isDirectory) {
      console.error(colors.red(`Error: Directory '${projectName}' already exists`));
      Deno.exit(1);
    }
  } catch {
    // Directory doesn't exist, which is good
  }

  console.log(colors.cyan(`Creating ${useReact ? 'React' : 'TypeScript'} app: ${projectName}`));

  // Create directory
  await Deno.mkdir(projectName, { recursive: true });

  // Create files based on template
  if (useReact) {
    await createReactTemplate(projectName);
  } else {
    await createBasicTemplate(projectName);
  }

  console.log(colors.green('\n✓ Project created successfully!\n'));
  console.log(`${colors.dim('Next steps:')}`);
  console.log(`  cd ${projectName}`);
  console.log(`  npm install`);
  console.log(`  ${colors.cyan('ultralight upload .')}`);
  console.log('');
}

async function createBasicTemplate(dir: string) {
  // index.ts
  const indexTs = `/// <reference types="@ultralightpro/types" />

/**
 * Hello World function
 * @param name - Name to greet
 * @returns Greeting message
 */
export function hello(name: string = 'World') {
  return \`Hello, \${name}!\`;
}

/**
 * Example using AI (requires BYOK setup in Settings)
 * @param question - Question to ask the AI
 * @returns AI response
 */
export async function ask(question: string) {
  const response = await ultralight.ai({
    messages: [{ role: 'user', content: question }],
  });
  return response.content;
}

/**
 * Example using data storage
 * @param title - Note title
 * @param content - Note content
 */
export async function saveNote(title: string, content: string) {
  await ultralight.store(\`notes/\${title}\`, {
    content,
    createdAt: new Date().toISOString(),
  });
  return { saved: true, title };
}

/**
 * Load a note by title
 * @param title - Note title to load
 */
export async function getNote(title: string) {
  return await ultralight.load(\`notes/\${title}\`);
}

/**
 * List all notes
 * @returns Array of note titles
 */
export async function listNotes() {
  const keys = await ultralight.list('notes/');
  return keys.map(k => k.replace('notes/', ''));
}
`;

  // package.json
  const packageJson = {
    name: dir,
    version: '1.0.0',
    type: 'module',
    devDependencies: {
      '@ultralightpro/types': '^1.0.0',
      'typescript': '^5.0.0',
    },
  };

  // tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      types: ['@ultralightpro/types'],
    },
    include: ['*.ts', '*.tsx'],
  };

  // README.md
  const readme = `# ${dir}

An Ultralight app.

## Development

\`\`\`bash
npm install
\`\`\`

## Deploy

\`\`\`bash
ultralight upload .
\`\`\`

## SDK Reference

The \`ultralight\` global is available in all functions:

\`\`\`typescript
// Data storage
await ultralight.store('key', value);
await ultralight.load('key');
await ultralight.list('prefix/');

// AI (requires BYOK in Settings)
await ultralight.ai({ messages: [{ role: 'user', content: 'Hi' }] });

// User context
if (ultralight.isAuthenticated()) {
  const user = ultralight.user;
}
\`\`\`

## Learn More

- [Ultralight Documentation](https://ultralight.dev/docs)
- [SDK Types](https://www.npmjs.com/package/@ultralightpro/types)
`;

  // Write files
  await Deno.writeTextFile(`${dir}/index.ts`, indexTs);
  await Deno.writeTextFile(`${dir}/package.json`, JSON.stringify(packageJson, null, 2));
  await Deno.writeTextFile(`${dir}/tsconfig.json`, JSON.stringify(tsConfig, null, 2));
  await Deno.writeTextFile(`${dir}/README.md`, readme);
  await Deno.writeTextFile(`${dir}/.gitignore`, 'node_modules/\n.ultralight/\n');

  console.log(colors.dim(`  Created ${dir}/index.ts`));
  console.log(colors.dim(`  Created ${dir}/package.json`));
  console.log(colors.dim(`  Created ${dir}/tsconfig.json`));
  console.log(colors.dim(`  Created ${dir}/README.md`));
  console.log(colors.dim(`  Created ${dir}/.gitignore`));
}

async function createReactTemplate(dir: string) {
  // index.tsx
  const indexTsx = `/// <reference types="@ultralightpro/types" />
import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';

/**
 * Main App Component
 */
function App({ sdk }: UltralightProps) {
  const [notes, setNotes] = useState<string[]>([]);
  const [newNote, setNewNote] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadNotes();
  }, []);

  async function loadNotes() {
    setLoading(true);
    const keys = await sdk.list('notes/');
    setNotes(keys.map(k => k.replace('notes/', '')));
    setLoading(false);
  }

  async function addNote() {
    if (!newNote.trim()) return;
    await sdk.store(\`notes/\${newNote}\`, {
      title: newNote,
      createdAt: new Date().toISOString(),
    });
    setNewNote('');
    await loadNotes();
  }

  return (
    <div style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>My Notes</h1>

      <div style={{ marginBottom: '1rem' }}>
        <input
          type="text"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="New note title..."
          style={{ padding: '0.5rem', marginRight: '0.5rem' }}
        />
        <button onClick={addNote} style={{ padding: '0.5rem 1rem' }}>
          Add Note
        </button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : notes.length === 0 ? (
        <p>No notes yet. Create your first note!</p>
      ) : (
        <ul>
          {notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Ultralight entry point
 * This function is called when the app loads
 */
const UltralightApp: UltralightApp = (container, sdk) => {
  const root = ReactDOM.createRoot(container);
  root.render(<App sdk={sdk} />);
};

export default UltralightApp;

// Also export server-side functions for MCP
export async function getNotes() {
  const keys = await ultralight.list('notes/');
  return keys.map(k => k.replace('notes/', ''));
}

export async function saveNote(title: string, content: string) {
  await ultralight.store(\`notes/\${title}\`, { title, content, createdAt: new Date().toISOString() });
  return { saved: true };
}
`;

  // package.json
  const packageJson = {
    name: dir,
    version: '1.0.0',
    type: 'module',
    devDependencies: {
      '@ultralightpro/types': '^1.0.0',
      '@types/react': '^18.0.0',
      '@types/react-dom': '^18.0.0',
      'typescript': '^5.0.0',
    },
    dependencies: {
      'react': '^18.0.0',
      'react-dom': '^18.0.0',
    },
  };

  // tsconfig.json
  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      jsx: 'react-jsx',
      types: ['@ultralightpro/types'],
    },
    include: ['*.ts', '*.tsx'],
  };

  // README.md
  const readme = `# ${dir}

A React app running on Ultralight.

## Development

\`\`\`bash
npm install
\`\`\`

## Deploy

\`\`\`bash
ultralight upload .
\`\`\`

## How It Works

This app exports a default function that receives:
- \`container\`: The DOM element to render into
- \`sdk\`: The Ultralight SDK (\`ultralight\` global)

\`\`\`tsx
const App: UltralightApp = (container, sdk) => {
  const root = ReactDOM.createRoot(container);
  root.render(<MyComponent sdk={sdk} />);
};
export default App;
\`\`\`

You can also export server-side functions for MCP:

\`\`\`typescript
export async function myServerFunction() {
  return await ultralight.load('data');
}
\`\`\`

## Learn More

- [Ultralight Documentation](https://ultralight.dev/docs)
- [SDK Types](https://www.npmjs.com/package/@ultralightpro/types)
`;

  // Write files
  await Deno.writeTextFile(`${dir}/index.tsx`, indexTsx);
  await Deno.writeTextFile(`${dir}/package.json`, JSON.stringify(packageJson, null, 2));
  await Deno.writeTextFile(`${dir}/tsconfig.json`, JSON.stringify(tsConfig, null, 2));
  await Deno.writeTextFile(`${dir}/README.md`, readme);
  await Deno.writeTextFile(`${dir}/.gitignore`, 'node_modules/\n.ultralight/\n');

  console.log(colors.dim(`  Created ${dir}/index.tsx`));
  console.log(colors.dim(`  Created ${dir}/package.json`));
  console.log(colors.dim(`  Created ${dir}/tsconfig.json`));
  console.log(colors.dim(`  Created ${dir}/README.md`));
  console.log(colors.dim(`  Created ${dir}/.gitignore`));
}

async function login(args: string[], client: ApiClient, config: Config) {
  const parsed = parseArgs(args, {
    string: ['token'],
    alias: { t: 'token' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight login')}

Authenticate with Ultralight using an API token.

${colors.dim('OPTIONS')}
  --token, -t <token>   Your API token (create one in User Settings → API Tokens)

${colors.dim('TOKEN TYPES')}
  API Token (ul_xxx)    Long-lived token for CLI/API access
  JWT Token             Short-lived session token (from browser)

${colors.dim('EXAMPLES')}
  ultralight login --token ul_abc123...   # Use API token (recommended)
  ultralight login                         # Show instructions
`);
    return;
  }

  if (parsed.token) {
    const token = parsed.token as string;
    const isApiToken = token.startsWith('ul_');

    // Token-based login
    config.auth = {
      token,
      is_api_token: isApiToken,
      // API tokens don't need client-side expiry tracking
      expires_at: isApiToken ? undefined : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    };
    await saveConfig(config);

    if (isApiToken) {
      console.log(colors.green('✓ Logged in with API token'));
      console.log(colors.dim('  Token starts with: ' + token.substring(0, 10) + '...'));
    } else {
      console.log(colors.green('✓ Logged in with session token'));
    }
    return;
  }

  // No token provided - show instructions
  console.log(`
${colors.bold('How to get an API token:')}

  1. Go to ${colors.cyan(config.api_url)}
  2. Sign in and click your profile icon
  3. Go to ${colors.cyan('Settings → API Tokens')}
  4. Create a new token and copy it
  5. Run: ${colors.cyan('ultralight login --token <your-token>')}

${colors.dim('API tokens start with ul_ and can be used for CLI and API access.')}
`);
}

async function logout(_args: string[], _client: ApiClient, _config: Config) {
  await clearConfig();
  console.log(colors.green('✓ Logged out successfully'));
}

async function whoami(_args: string[], client: ApiClient, _config: Config) {
  const user = await client.callTool('platform.user.profile', {});
  console.log(`
${colors.bold('Logged in as:')}
  Email: ${colors.cyan(user.email)}
  Name:  ${user.display_name || colors.dim('(not set)')}
  Tier:  ${user.tier}
  ID:    ${colors.dim(user.id)}
`);
}

async function upload(args: string[], client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    string: ['name', 'slug', 'description', 'visibility'],
    boolean: ['no-docs', 'draft'],
    alias: { n: 'name', s: 'slug', d: 'description', v: 'visibility' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight upload')} [directory]

Upload a new app or update an existing one.

${colors.dim('ARGUMENTS')}
  directory             Directory to upload (default: current directory)

${colors.dim('OPTIONS')}
  --name, -n <name>     App display name
  --slug, -s <slug>     URL slug (auto-generated if omitted)
  --description, -d     App description
  --visibility, -v      Visibility: private, unlisted, public (default: private)
  --draft               Upload as draft (requires existing app)
  --no-docs             Skip automatic documentation generation

${colors.dim('EXAMPLES')}
  ultralight upload                     # Upload current directory
  ultralight upload ./my-app            # Upload specific directory
  ultralight upload --name "My App"     # With custom name
  ultralight upload --draft             # Upload as draft
`);
    return;
  }

  const dir = parsed._[0] as string || '.';
  const files = await collectFiles(dir);

  if (files.length === 0) {
    throw new Error('No valid files found in directory');
  }

  console.log(colors.dim(`Found ${files.length} files to upload...`));

  // Check if this is an existing app (has .ultralightrc.json)
  let existingAppId: string | null = null;
  try {
    const rcPath = `${dir}/.ultralightrc.json`;
    const rc = JSON.parse(await Deno.readTextFile(rcPath));
    existingAppId = rc.app_id;
  } catch {
    // No existing app
  }

  if (parsed.draft && !existingAppId) {
    throw new Error('--draft requires an existing app. Run upload first without --draft.');
  }

  if (parsed.draft && existingAppId) {
    // Draft upload
    console.log(colors.dim('Uploading draft...'));
    const result = await client.callTool('platform.draft.upload', {
      app_id: existingAppId,
      files: files.map(f => ({
        path: f.name,
        content: f.content,
      })),
    });

    console.log();
    console.log(colors.green('✓ Draft uploaded successfully'));
    console.log(`  Version: ${result.draft_version}`);
    console.log(`  Exports: ${result.exports?.join(', ') || 'none'}`);
    console.log();
    console.log(`Run ${colors.cyan(`ultralight draft publish ${existingAppId}`)} to publish.`);
  } else {
    // New app or overwrite
    console.log(colors.dim('Creating app...'));
    const result = await client.callTool('platform.apps.create', {
      name: parsed.name,
      slug: parsed.slug,
      description: parsed.description,
      visibility: parsed.visibility || 'private',
      auto_generate_docs: !parsed['no-docs'],
      files: files.map(f => ({
        path: f.name,
        content: f.content,
      })),
    });

    // Save app ID to .ultralightrc.json
    const rc = {
      app_id: result.app_id,
      slug: result.slug,
      name: parsed.name || result.slug,
    };
    await Deno.writeTextFile(`${dir}/.ultralightrc.json`, JSON.stringify(rc, null, 2));

    console.log();
    console.log(colors.green('✓ App created successfully'));
    console.log(`  ID:      ${result.app_id}`);
    console.log(`  Slug:    ${result.slug}`);
    console.log(`  Version: ${result.version}`);
    console.log(`  URL:     ${colors.cyan(result.url)}`);
    console.log(`  Exports: ${result.exports?.join(', ') || 'none'}`);
    if (result.docs_generated) {
      console.log(`  Docs:    ${colors.green('generated')}`);
    }
  }
}

async function apps(args: string[], client: ApiClient, _config: Config) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'list':
    case 'ls': {
      const parsed = parseArgs(subArgs, {
        string: ['visibility'],
        boolean: ['drafts'],
        alias: { v: 'visibility', d: 'drafts' },
      });

      const result = await client.callTool('platform.apps.list', {
        visibility: parsed.visibility || 'all',
        include_drafts: parsed.drafts,
      });

      if (result.apps.length === 0) {
        console.log(colors.dim('No apps found.'));
        return;
      }

      console.log(`${colors.bold('Your Apps')} (${result.total} total)\n`);
      for (const app of result.apps) {
        const draft = app.has_draft ? colors.yellow(' [draft]') : '';
        const vis = app.visibility === 'public' ? colors.green('public') :
                    app.visibility === 'unlisted' ? colors.yellow('unlisted') :
                    colors.dim('private');
        console.log(`  ${colors.cyan(app.slug)}${draft}`);
        console.log(`    ${app.name} · ${vis} · v${app.current_version}`);
        console.log(`    ${colors.dim(`${app.runs_30d || 0} runs (30d) · ${app.id}`)}`);
        console.log();
      }
      break;
    }

    case 'get': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight apps get <app-id>');
      }

      const parsed = parseArgs(subArgs.slice(1), {
        boolean: ['code', 'skills'],
      });

      const result = await client.callTool('platform.apps.get', {
        app_id: appId,
        include_code: parsed.code,
        include_skills: parsed.skills,
      });

      console.log(`
${colors.bold(result.name)} (${result.slug})

  ID:          ${result.id}
  Version:     ${result.current_version}
  Visibility:  ${result.visibility}
  Exports:     ${result.exports?.join(', ') || 'none'}

  Runs (30d):  ${result.runs_30d || 0}
  Total runs:  ${result.total_runs || 0}

  MCP:         ${colors.cyan(result.mcp_endpoint)}
  URL:         ${colors.cyan(result.app_url)}

  Created:     ${new Date(result.created_at).toLocaleString()}
  Updated:     ${new Date(result.updated_at).toLocaleString()}
`);
      break;
    }

    case 'delete': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight apps delete <app-id>');
      }

      const parsed = parseArgs(subArgs.slice(1), {
        boolean: ['yes'],
        alias: { y: 'yes' },
      });

      if (!parsed.yes) {
        console.log(colors.yellow(`Warning: This will delete the app "${appId}"`));
        console.log('Run with --yes to confirm.');
        return;
      }

      await client.callTool('platform.apps.delete', {
        app_id: appId,
        confirm: true,
      });

      console.log(colors.green('✓ App deleted'));
      break;
    }

    case 'update': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight apps update <app-id> [options]');
      }

      const parsed = parseArgs(subArgs.slice(1), {
        string: ['name', 'description', 'visibility'],
        alias: { n: 'name', d: 'description', v: 'visibility' },
      });

      const updates: Record<string, unknown> = { app_id: appId };
      if (parsed.name) updates.name = parsed.name;
      if (parsed.description) updates.description = parsed.description;
      if (parsed.visibility) updates.visibility = parsed.visibility;

      await client.callTool('platform.apps.update', updates);
      console.log(colors.green('✓ App updated'));
      break;
    }

    default:
      console.log(`
${colors.bold('ultralight apps')} <command>

Manage your Ultralight apps.

${colors.dim('COMMANDS')}
  list, ls        List your apps
  get <app>       Get app details
  update <app>    Update app metadata
  delete <app>    Delete an app

${colors.dim('EXAMPLES')}
  ultralight apps list
  ultralight apps get my-app
  ultralight apps update my-app --name "New Name"
  ultralight apps delete my-app --yes
`);
  }
}

async function draft(args: string[], client: ApiClient, _config: Config) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'status': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight draft status <app-id>');
      }

      const result = await client.callTool('platform.draft.get', {
        app_id: appId,
        include_diff: true,
      });

      if (!result.has_draft) {
        console.log(colors.dim('No draft exists for this app.'));
        return;
      }

      console.log(`
${colors.bold('Draft Status')}

  App:         ${appId}
  Draft:       ${result.draft_version}
  Uploaded:    ${new Date(result.draft_uploaded_at).toLocaleString()}
  Production:  v${result.current_version}

${colors.dim('Exports diff:')}
  Added:       ${result.exports_diff?.added?.join(', ') || 'none'}
  Removed:     ${result.exports_diff?.removed?.join(', ') || 'none'}
`);
      break;
    }

    case 'publish': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight draft publish <app-id>');
      }

      const parsed = parseArgs(subArgs.slice(1), {
        string: ['bump'],
        boolean: ['no-docs'],
        alias: { b: 'bump' },
      });

      console.log(colors.dim('Publishing draft...'));

      const result = await client.callTool('platform.draft.publish', {
        app_id: appId,
        version_bump: parsed.bump || 'patch',
        regenerate_docs: !parsed['no-docs'],
      });

      console.log();
      console.log(colors.green('✓ Draft published'));
      console.log(`  Previous: v${result.previous_version}`);
      console.log(`  New:      v${result.new_version}`);
      if (result.docs_regenerated) {
        console.log(`  Docs:     ${colors.green('regenerated')}`);
      }
      break;
    }

    case 'discard': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight draft discard <app-id>');
      }

      await client.callTool('platform.draft.discard', { app_id: appId });
      console.log(colors.green('✓ Draft discarded'));
      break;
    }

    default:
      console.log(`
${colors.bold('ultralight draft')} <command>

Manage app drafts for safe deployments.

${colors.dim('COMMANDS')}
  status <app>    Show draft status
  publish <app>   Publish draft to production
  discard <app>   Discard draft without publishing

${colors.dim('OPTIONS')}
  --bump, -b      Version bump type: patch, minor, major (default: patch)
  --no-docs       Skip documentation regeneration on publish

${colors.dim('EXAMPLES')}
  ultralight draft status my-app
  ultralight draft publish my-app --bump minor
  ultralight draft discard my-app
`);
  }
}

async function docs(args: string[], client: ApiClient, _config: Config) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'generate': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight docs generate <app-id>');
      }

      console.log(colors.dim('Generating documentation...'));

      const result = await client.callTool('platform.docs.generate', {
        app_id: appId,
      });

      console.log();
      console.log(colors.green('✓ Documentation generated'));
      console.log(`  Functions: ${result.functions_found}`);
      console.log(`  Embedding: ${result.embedding_generated ? 'generated' : 'skipped'}`);
      break;
    }

    case 'get': {
      const appId = subArgs[0];
      if (!appId) {
        throw new Error('Usage: ultralight docs get <app-id>');
      }

      const parsed = parseArgs(subArgs.slice(1), {
        string: ['format'],
        alias: { f: 'format' },
      });

      const result = await client.callTool('platform.docs.get', {
        app_id: appId,
        format: parsed.format || 'markdown',
      });

      if (!result.exists) {
        console.log(colors.dim('No documentation generated yet.'));
        console.log(`Run ${colors.cyan(`ultralight docs generate ${appId}`)} to create.`);
        return;
      }

      if (parsed.format === 'json') {
        console.log(JSON.stringify(result.skills_parsed, null, 2));
      } else {
        console.log(result.skills_md);
      }
      break;
    }

    default:
      console.log(`
${colors.bold('ultralight docs')} <command>

Manage app documentation (Skills.md).

${colors.dim('COMMANDS')}
  generate <app>  Generate documentation from code
  get <app>       Get documentation content

${colors.dim('OPTIONS')}
  --format, -f    Output format: markdown, json, mcp (default: markdown)

${colors.dim('EXAMPLES')}
  ultralight docs generate my-app
  ultralight docs get my-app
  ultralight docs get my-app --format json
`);
  }
}

async function run(args: string[], client: ApiClient, _config: Config) {
  if (args.length < 2) {
    console.log(`
${colors.bold('ultralight run')} <app> <function> [args]

Execute a function exported by an app.

${colors.dim('ARGUMENTS')}
  app         App ID or slug
  function    Function name to execute
  args        JSON arguments (optional)

${colors.dim('OPTIONS')}
  --draft     Run against draft code instead of production
  --json      Output result as JSON

${colors.dim('EXAMPLES')}
  ultralight run my-app hello
  ultralight run my-app greet '{"name": "World"}'
  ultralight run my-app process --draft
`);
    return;
  }

  const appId = args[0];
  const fnName = args[1];
  const fnArgs = args[2] ? JSON.parse(args[2]) : undefined;

  const parsed = parseArgs(args.slice(3), {
    boolean: ['draft', 'json'],
  });

  const result = await client.callTool('platform.run', {
    app_id: appId,
    function: fnName,
    args: fnArgs,
    use_draft: parsed.draft,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    if (result.success) {
      console.log(colors.green('✓ Success') + ` (${result.duration_ms}ms)`);
      console.log();
      if (result.result !== undefined) {
        console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
      }
    } else {
      console.log(colors.red('✗ Error'));
      console.log(result.error);
    }

    if (result.logs?.length > 0) {
      console.log();
      console.log(colors.dim('--- Logs ---'));
      for (const log of result.logs) {
        console.log(log.message);
      }
    }
  }
}

// ============================================
// TEST COMMAND
// ============================================

async function testCmd(args: string[], client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    string: ['function'],
    boolean: ['help', 'json'],
    alias: { f: 'function', h: 'help' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight test')} [directory] [options]

Test your app functions without deploying. Builds and executes in the Ultralight sandbox.

${colors.dim('OPTIONS')}
  --function, -f <name>  Test a specific function (with optional JSON args after)
  --json                 Output raw JSON result

${colors.dim('EXAMPLES')}
  ultralight test .                                    # Build-check all exports
  ultralight test . --function hello '{"name":"World"}'  # Test one function
  ultralight test ./my-app -f process '{"data":[1,2]}'
`);
    return;
  }

  // Determine directory (first positional arg or current dir)
  let dir = '.';
  const positional = parsed._ as string[];
  if (positional.length > 0 && !positional[0].startsWith('{')) {
    dir = positional[0];
  }

  const files = await collectFiles(dir);
  if (files.length === 0) {
    throw new Error('No valid files found in directory');
  }

  const fnName = parsed.function as string | undefined;
  let fnArgs: Record<string, unknown> | undefined;

  // Parse function args — look for JSON in remaining positional args
  if (fnName) {
    const jsonArg = positional.find(a => a.startsWith('{'));
    if (jsonArg) {
      try {
        fnArgs = JSON.parse(jsonArg);
      } catch {
        throw new Error('Invalid JSON arguments. Must be valid JSON object.');
      }
    }
  }

  console.log(colors.dim(`Testing${fnName ? ` ${fnName}()` : ''} from ${dir}...`));
  console.log();

  const toolArgs: Record<string, unknown> = {
    files: files.map(f => ({ path: f.name, content: f.content })),
  };
  if (fnName) {
    toolArgs.function_name = fnName;
    if (fnArgs) toolArgs.args = fnArgs;
  }

  const result = await client.callTool('platform.test', toolArgs);

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.success) {
    console.log(colors.green('✓ Test passed') + ` (${result.duration_ms}ms)`);
    if (result.exports) {
      console.log(`  Exports: ${(result.exports as string[]).join(', ')}`);
    }
    if (result.result !== undefined) {
      console.log();
      console.log(colors.dim('Result:'));
      console.log(typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2));
    }
  } else {
    console.log(colors.red('✗ Test failed'));
    if (result.error_type) {
      console.log(`  Type: ${result.error_type}`);
    }
    console.log(`  ${result.error}`);
  }

  if (result.logs && (result.logs as unknown[]).length > 0) {
    console.log();
    console.log(colors.dim('--- Logs ---'));
    for (const log of result.logs as Array<{ message: string }>) {
      console.log(log.message);
    }
  }
}

// ============================================
// LINT COMMAND
// ============================================

async function lint(args: string[], client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    boolean: ['strict', 'help', 'json'],
    alias: { s: 'strict', h: 'help' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight lint')} [directory]

Validate source code and manifest against Ultralight conventions.
Checks: single-args-object, no-shorthand-return, function-count, manifest sync, permissions.

${colors.dim('OPTIONS')}
  --strict, -s    Treat warnings as errors
  --json          Output raw JSON result

${colors.dim('EXAMPLES')}
  ultralight lint .
  ultralight lint ./my-app --strict
`);
    return;
  }

  const dir = (parsed._[0] as string) || '.';
  const files = await collectFiles(dir);
  if (files.length === 0) {
    throw new Error('No valid files found in directory');
  }

  console.log(colors.dim(`Linting ${files.length} files from ${dir}...`));
  console.log();

  const result = await client.callTool('platform.lint', {
    files: files.map(f => ({ path: f.name, content: f.content })),
    strict: parsed.strict || false,
  });

  if (parsed.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const issues = result.issues as Array<{ severity: string; rule: string; message: string; suggestion?: string }> || [];

  if (result.valid) {
    console.log(colors.green('✓ All checks passed'));
  } else {
    console.log(colors.red(`✗ ${issues.length} issue(s) found`));
  }

  if (result.summary) {
    console.log(`  ${colors.dim(result.summary as string)}`);
  }

  console.log();
  for (const issue of issues) {
    const icon = issue.severity === 'error' ? colors.red('✗') : colors.yellow('⚠');
    console.log(`  ${icon} ${colors.bold(issue.rule)}: ${issue.message}`);
    if (issue.suggestion) {
      console.log(`    ${colors.dim(`→ ${issue.suggestion}`)}`);
    }
  }

  if (!result.valid) {
    console.log();
    console.log(colors.dim('Fix issues and run again before uploading.'));
    Deno.exit(1);
  }
}

// ============================================
// SCAFFOLD COMMAND
// ============================================

async function scaffold(args: string[], client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    string: ['description', 'storage'],
    boolean: ['help'],
    alias: { d: 'description', h: 'help' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight scaffold')} <name>

Generate a properly structured app skeleton following all Ultralight conventions.
Outputs index.ts + manifest.json + .ultralightrc.json with correct patterns.

${colors.dim('OPTIONS')}
  --description, -d <text>       App description
  --storage <none|kv|supabase>   Storage type (default: kv)

${colors.dim('EXAMPLES')}
  ultralight scaffold my-app
  ultralight scaffold weather-api -d "Get weather data" --storage none
  ultralight scaffold my-db-app --storage supabase
`);
    return;
  }

  const name = parsed._[0] as string;
  if (!name) {
    throw new Error('Usage: ultralight scaffold <name>');
  }

  // Check if directory exists
  try {
    const stat = await Deno.stat(name);
    if (stat.isDirectory) {
      throw new Error(`Directory '${name}' already exists`);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('already exists')) throw err;
    // Directory doesn't exist — good
  }

  console.log(colors.dim(`Scaffolding ${name}...`));

  const result = await client.callTool('platform.scaffold', {
    name: name,
    description: parsed.description || `${name} — an Ultralight MCP app`,
    storage: parsed.storage || 'kv',
  });

  const generatedFiles = result.files as Array<{ path: string; content: string }>;

  if (!generatedFiles || generatedFiles.length === 0) {
    throw new Error('No files generated. Check that ul.scaffold is available.');
  }

  // Create directory and write files
  await Deno.mkdir(name, { recursive: true });

  for (const file of generatedFiles) {
    const filePath = `${name}/${file.path}`;
    await Deno.writeTextFile(filePath, file.content);
    console.log(colors.dim(`  Created ${filePath}`));
  }

  console.log();
  console.log(colors.green('✓ Scaffold created'));

  if (result.next_steps) {
    console.log();
    console.log(colors.dim('Next steps:'));
    for (const step of result.next_steps as string[]) {
      console.log(`  ${step}`);
    }
  }

  if (result.tip) {
    console.log();
    console.log(colors.dim(`💡 ${result.tip}`));
  }

  console.log();
  console.log(colors.dim('Build workflow:'));
  console.log(`  cd ${name}`);
  console.log(`  ${colors.cyan('ultralight test .')}       # verify`);
  console.log(`  ${colors.cyan('ultralight lint .')}       # validate`);
  console.log(`  ${colors.cyan('ultralight upload .')}     # deploy`);
}

// ============================================
// DISCOVER COMMAND
// ============================================

async function discover(args: string[], client: ApiClient, _config: Config) {
  const parsed = parseArgs(args, {
    number: ['limit'],
    boolean: ['featured', 'help'],
    alias: { l: 'limit', f: 'featured', h: 'help' },
  });

  if (parsed.help) {
    console.log(`
${colors.bold('ultralight discover')} [query]

Search the App Store for MCP tools by natural language.
Uses semantic search with composite ranking (similarity + community signal + native capability).

${colors.dim('OPTIONS')}
  --limit, -l <n>     Max results (default: 10, max: 50)
  --featured, -f      Show top-ranked apps instead of searching

${colors.dim('EXAMPLES')}
  ultralight discover "weather API"
  ultralight discover "send email notifications" --limit 20
  ultralight discover --featured
`);
    return;
  }

  if (parsed.featured) {
    // Featured mode — top apps by community signal
    console.log(colors.dim('Fetching featured apps...'));
    console.log();

    const result = await client.callTool('platform.discover.appstore', {
      limit: parsed.limit || 10,
    });

    if (!result.results || result.results.length === 0) {
      console.log(colors.dim('No featured apps found.'));
      return;
    }

    console.log(`${colors.bold('Featured Apps')} (${result.total} apps)\n`);
    for (const app of result.results) {
      const likes = app.likes || 0;
      const owner = app.is_owner ? colors.cyan(' (yours)') : '';
      const native = app.fully_connected ? colors.green(' ★') : '';
      console.log(`  ${colors.cyan(app.slug)}${owner}${native} ${colors.dim(`${likes} likes`)}`);
      console.log(`    ${app.name}`);
      if (app.description) {
        console.log(`    ${colors.dim(app.description.substring(0, 80))}`);
      }
      console.log(`    ${colors.dim(app.mcp_endpoint)}`);
      console.log();
    }
    return;
  }

  const searchQuery = parsed._.join(' ');

  if (!searchQuery) {
    console.log(`
${colors.bold('ultralight discover')} [query]

Search the App Store for MCP tools by natural language.

${colors.dim('EXAMPLES')}
  ultralight discover "weather API"
  ultralight discover "send email notifications"
  ultralight discover --featured
`);
    return;
  }

  console.log(colors.dim(`Searching for "${searchQuery}"...`));
  console.log();

  const result = await client.callTool('platform.discover.appstore', {
    query: searchQuery,
    limit: parsed.limit || 10,
  });

  if (!result.results || result.results.length === 0) {
    console.log(colors.dim('No apps found matching your query.'));
    return;
  }

  console.log(`${colors.bold('Results')} (${result.total} apps)\n`);
  for (const app of result.results) {
    const score = app.final_score ? Math.round(app.final_score * 100) : Math.round((app.similarity || 0) * 100);
    const owner = app.is_owner ? colors.cyan(' (yours)') : '';
    const native = app.fully_connected ? colors.green(' ★') : '';
    console.log(`  ${colors.cyan(app.slug)}${owner}${native} ${colors.dim(`${score}% match`)}`);
    console.log(`    ${app.name}`);
    if (app.description) {
      console.log(`    ${colors.dim(app.description.substring(0, 80))}`);
    }
    console.log(`    ${colors.dim(app.mcp_endpoint)}`);
    console.log();
  }
}

async function configCmd(args: string[], _client: ApiClient, config: Config) {
  const subcommand = args[0];
  const subArgs = args.slice(1);

  switch (subcommand) {
    case 'get': {
      const key = subArgs[0];
      if (key) {
        const value = (config as Record<string, unknown>)[key];
        console.log(value !== undefined ? JSON.stringify(value, null, 2) : colors.dim('(not set)'));
      } else {
        throw new Error('Usage: ultralight config get <key>');
      }
      break;
    }

    case 'set': {
      const [key, value] = subArgs;
      if (!key || !value) {
        throw new Error('Usage: ultralight config set <key> <value>');
      }

      (config as Record<string, unknown>)[key] = value;
      await saveConfig(config);
      console.log(colors.green('✓ Config updated'));
      break;
    }

    case 'list': {
      console.log(JSON.stringify(config, null, 2));
      break;
    }

    default:
      console.log(`
${colors.bold('ultralight config')} <command>

Manage CLI configuration.

${colors.dim('COMMANDS')}
  get <key>         Get a config value
  set <key> <value> Set a config value
  list              Show all config

${colors.dim('EXAMPLES')}
  ultralight config get api_url
  ultralight config set api_url https://custom.ultralight.dev
  ultralight config list
`);
  }
}

// ============================================
// HELPERS
// ============================================

async function collectFiles(dir: string): Promise<Array<{ name: string; content: string; size: number }>> {
  const files: Array<{ name: string; content: string; size: number }> = [];
  const allowedExtensions = ['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css'];
  const ignoreDirs = ['node_modules', '.git', 'dist', 'build', '.ultralight'];

  async function walk(path: string, base: string) {
    for await (const entry of Deno.readDir(path)) {
      const fullPath = `${path}/${entry.name}`;
      const relativePath = base ? `${base}/${entry.name}` : entry.name;

      if (entry.isDirectory) {
        if (!ignoreDirs.includes(entry.name)) {
          await walk(fullPath, relativePath);
        }
      } else if (entry.isFile) {
        const ext = entry.name.substring(entry.name.lastIndexOf('.'));
        if (allowedExtensions.includes(ext)) {
          const content = await Deno.readTextFile(fullPath);
          files.push({
            name: relativePath,
            content,
            size: content.length,
          });
        }
      }
    }
  }

  await walk(dir, '');
  return files;
}

// Run main
main();
