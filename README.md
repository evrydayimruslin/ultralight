# Ultralight

The deployment target for vibecoders. Zero-config serverless apps with AI integration.

## What is this?

Ultralight lets you deploy TypeScript/JavaScript apps instantly. No servers to configure, no Docker to learn, no AWS accounts to manage.

Built something cool with Cursor or Claude Code? Drag your folder, get a URL, done.

## Features

- **Instant Deployment** - Upload code, get a URL
- **AI Integration** - Built-in AI capabilities with BYOK support
- **MCP Protocol** - Every app is an MCP server
- **HTTP Endpoints** - Public APIs for webhooks and mobile backends
- **Supabase Integration** - BYOS (Bring Your Own Supabase) for real databases
- **Environment Variables** - Encrypted secrets management
- **NPM Support** - Import any npm package, bundled automatically
- **Skills.md** - Auto-generated documentation from code
- **Semantic Discovery** - Find apps by capability
- **Draft/Publish** - Safe deployments with version control

---

## Installation

### CLI (Recommended)

```bash
# Option 1: Using npm (requires Deno to be installed)
npm install -g ultralightpro
ultralight --help

# Option 2: Using Deno directly
deno install --allow-net --allow-read --allow-write --allow-env \
  -n ultralight https://ultralight.dev/cli/mod.ts

# Option 3: Run without installing
deno run --allow-net --allow-read --allow-write --allow-env \
  https://ultralight.dev/cli/mod.ts --help
```

### SDK (TypeScript/JavaScript)

```bash
# npm
npm install ultralightpro-sdk

# Deno
import { Ultralight } from 'https://ultralight.dev/sdk/mod.ts';
```

---

## Quick Start

### 1. Authenticate

```bash
ultralight login
```

### 2. Create an App

```typescript
// index.ts
export function hello(name: string = "World") {
  return `Hello, ${name}!`;
}

export function getWeather(city: string) {
  return {
    city,
    temp: 72,
    conditions: "Sunny"
  };
}
```

### 3. Deploy

```bash
ultralight upload ./my-app --name "My First App"
```

### 4. Use Your App

**Via MCP:**
```bash
# Your app is now available at:
# POST /mcp/{app-id}
```

**Via SDK:**
```typescript
import { Ultralight } from 'ultralightpro-sdk';

const ul = new Ultralight({ token: 'your-token' });
const result = await ul.run('my-app-id', 'hello', { name: 'Claude' });
// { result: "Hello, Claude!" }
```

---

## CLI Commands

```bash
ultralight login              # Authenticate with Ultralight
ultralight logout             # Clear credentials
ultralight whoami             # Show current user

ultralight upload [dir]       # Upload new app or update existing
  --name "App Name"           # Set display name
  --visibility public         # Set visibility (private/unlisted/public)
  --draft                     # Upload as draft

ultralight apps list          # List your apps
ultralight apps get <app>     # Get app details
ultralight apps delete <app>  # Delete an app

ultralight draft status <app> # Check draft status
ultralight draft publish <app># Publish draft to production
ultralight draft discard <app># Discard draft

ultralight docs generate <app># Generate Skills.md documentation
ultralight docs get <app>     # View documentation

ultralight run <app> <fn>     # Execute a function
  --draft                     # Run against draft code

ultralight discover "query"   # Search for apps by capability
```

---

## SDK Usage

```typescript
import { Ultralight } from 'ultralightpro-sdk';

const ul = new Ultralight({
  token: process.env.ULTRALIGHT_TOKEN
});

// List your apps
const { apps } = await ul.apps.list();

// Create an app
const app = await ul.apps.create({
  name: 'Weather API',
  files: [{
    path: 'index.ts',
    content: `
      export function getWeather(city: string) {
        return { city, temp: 72, conditions: "Sunny" };
      }
    `
  }]
});

// Run a function
const result = await ul.run(app.app_id, 'getWeather', { city: 'NYC' });

// Work with drafts
await ul.drafts.upload(app.app_id, {
  files: [{ path: 'index.ts', content: '...' }]
});
await ul.drafts.publish(app.app_id, { versionBump: 'minor' });

// Discover apps
const weatherApps = await ul.discover('weather API');

// Call any app's MCP tools
const mcp = ul.mcp('some-app-id');
const tools = await mcp.listTools();
const output = await mcp.callTool('functionName', { arg: 'value' });
```

---

## MCP Protocol

Every Ultralight app is automatically an MCP (Model Context Protocol) server.

### Discovery

```bash
# Platform discovery
GET /.well-known/mcp.json

# App-specific discovery
GET /a/{appId}/.well-known/mcp.json
```

### Platform MCP

```bash
POST /mcp/platform

# Available tools:
# - platform.apps.list
# - platform.apps.get
# - platform.apps.create
# - platform.apps.update
# - platform.apps.delete
# - platform.draft.upload
# - platform.draft.publish
# - platform.docs.generate
# - platform.discover
# - platform.run
# ... and more
```

### App MCP

```bash
POST /mcp/{appId}

# Your exported functions + SDK tools:
# - ultralight.store
# - ultralight.load
# - ultralight.ai
# - ultralight.env
# - ultralight.cron.*
```

### HTTP Endpoints

```bash
# Call any exported function via HTTP
POST /http/{appId}/{functionName}

# Example: POST /http/abc123/createUser
# Body: { "name": "John", "email": "john@example.com" }
```

---

## Project Structure

```
ultralight/
├── api/                    # Deno Deploy API
│   ├── handlers/
│   │   ├── app.ts          # Router
│   │   ├── platform-mcp.ts # Platform MCP server
│   │   ├── mcp.ts          # Per-app MCP server
│   │   ├── upload.ts       # File upload
│   │   ├── apps.ts         # App management
│   │   └── auth.ts         # Authentication
│   ├── runtime/
│   │   └── sandbox.ts      # Deno sandbox execution
│   ├── services/
│   │   ├── storage.ts      # Cloudflare R2
│   │   ├── docgen.ts       # Skills.md generation
│   │   ├── embedding.ts    # Vector embeddings
│   │   └── apps.ts         # App CRUD
│   └── main.ts             # Entry point
├── cli/                    # CLI tool
│   ├── mod.ts              # CLI entry point
│   ├── api.ts              # API client
│   └── config.ts           # Configuration
├── sdk/                    # TypeScript SDK
│   └── src/index.ts        # SDK implementation
├── shared/                 # Shared types
│   └── types/index.ts
└── docs/                   # Documentation
    ├── PLATFORM-MCP-CLI-DESIGN.md
    └── IN-APP-SDK-DESIGN.md
```

---

## Self-Hosting

### Prerequisites

- Deno 2.0+
- Supabase account
- Cloudflare R2 bucket
- OpenRouter API key (for embeddings)

### Environment Variables

```bash
export SUPABASE_URL="https://xxx.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export R2_ACCOUNT_ID="your-cloudflare-account"
export R2_ACCESS_KEY_ID="your-r2-key"
export R2_SECRET_ACCESS_KEY="your-r2-secret"
export R2_BUCKET_NAME="ultralight-apps"
export OPENROUTER_API_KEY="your-openrouter-key"
export BYOK_ENCRYPTION_KEY="your-32-byte-encryption-key"  # For encrypting secrets
```

### Database Setup

```bash
# Run migrations in Supabase SQL Editor
# 1. migration.sql (base schema)
# 2. migration-mcp-skills.sql (MCP + docs features)
# 3. migration-phase1.sql (env vars + HTTP endpoints)
# 4. migration-supabase.sql (Supabase integration)

# Important: After migrations, reload PostgREST schema:
# Supabase Dashboard → Settings → API → Reload Schema
```

### Run Locally

```bash
deno task dev
```

### Deploy

```bash
# DigitalOcean App Platform (via GitHub auto-deploy)
# Push to main branch triggers automatic deployment

# Or Docker locally
docker build -t ultralight .
docker run -p 8000:8000 ultralight
```

---

## Architecture

- **Runtime**: DigitalOcean App Platform (Docker)
- **Storage**: Cloudflare R2 (code + app data)
- **Database**: Supabase PostgreSQL + pgvector
- **Auth**: Supabase Auth (Google OAuth)
- **AI**: OpenRouter API (embeddings + BYOK)

---

## License

MIT

## Credits

Built by Russell & Corin for vibecoders everywhere.
