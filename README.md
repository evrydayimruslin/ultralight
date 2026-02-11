# Ultralight

MCP-first serverless platform. Deploy TypeScript, get an MCP server. Every app is callable by AI agents.

## What is Ultralight?

Ultralight turns TypeScript files into MCP (Model Context Protocol) servers. Export functions, upload your code, and any AI agent can discover and call your app.

Built something with Cursor or Claude Code? Upload the folder. Your exported functions become MCP tools instantly — no config, no Docker, no infra.

```typescript
// index.ts — this becomes an MCP server
export function getWeather(city: string) {
  return { city, temp: 72, conditions: "Sunny" };
}

export function convertCurrency(amount: number, from: string, to: string) {
  return { amount, from, to, converted: amount * 1.1, rate: 1.1 };
}
```

```bash
ultralight upload ./my-app --name "Weather & Currency"
# Done. Your app is live at POST /mcp/{app-id}
```

---

## Core Concepts

### Every app is an MCP server

Your exported functions become MCP tools. Any MCP-compatible client (Claude Desktop, Cursor, custom agents) can connect to your app and call its functions via JSON-RPC 2.0.

### The platform is also an MCP server

Ultralight exposes 17 `ul.*` tools at `POST /mcp/platform` for managing apps, discovering the app store, and more. Agents can use these tools to find and install apps on behalf of users.

### Three-layer discovery

When an agent needs a capability, it searches in order:

1. **Desk** — Last 3 apps the user called. Fastest lookup.
2. **Library** — Apps the user owns + apps they've liked.
3. **App Store** — All published apps, ranked by relevancy + community signal + native capability.

### Apps can have superpowers

Every app gets access to the Ultralight SDK at runtime:

- **Storage** — Per-app key-value store (`ultralight.store`, `ultralight.load`)
- **Memory** — Cross-app user memory (`ultralight.remember`, `ultralight.recall`)
- **AI** — Call any LLM with BYOK support (`ultralight.ai`)
- **Cron** — Schedule recurring jobs (`ultralight.cron.register`)
- **Supabase** — Bring your own database (`BYOS`)
- **Environment variables** — Encrypted secrets, including per-user secrets via `ul.connect`

---

## Installation

### CLI

```bash
npm install -g ultralightpro
ultralight login
```

### SDK

```bash
npm install ultralightpro-sdk
```

```typescript
import { Ultralight } from 'ultralightpro-sdk';
const ul = new Ultralight({ token: process.env.ULTRALIGHT_TOKEN });
```

---

## Quick Start

### 1. Write an app

```typescript
// index.ts
export function hello(name: string = "World") {
  return `Hello, ${name}!`;
}

export function addTodo(text: string, priority: "low" | "medium" | "high" = "medium") {
  return { id: crypto.randomUUID(), text, priority, created: new Date().toISOString() };
}
```

### 2. Deploy

```bash
ultralight upload ./my-app --name "Todo Manager"
```

### 3. Call it

**MCP (JSON-RPC 2.0):**
```bash
curl -X POST https://ultralight.dev/mcp/{app-id} \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"addTodo","arguments":{"text":"Ship it","priority":"high"}}}'
```

**HTTP endpoint:**
```bash
curl -X POST https://ultralight.dev/http/{app-id}/addTodo \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"text":"Ship it","priority":"high"}'
```

**SDK:**
```typescript
const result = await ul.run('my-app-id', 'addTodo', { text: 'Ship it', priority: 'high' });
```

---

## Platform MCP Tools

The platform itself is an MCP server at `POST /mcp/platform` with 17 tools in the `ul.*` namespace.

### App Management
| Tool | Description |
|------|-------------|
| `ul.upload` | Upload code to create or update an app |
| `ul.download` | Download source code for a version |
| `ul.set.version` | Set the live version |
| `ul.set.visibility` | Change visibility (private/unlisted/published) |
| `ul.set.download` | Control source code access |
| `ul.set.supabase` | Assign a Supabase server |

### Permissions
| Tool | Description |
|------|-------------|
| `ul.permissions.grant` | Grant user access to a private app |
| `ul.permissions.revoke` | Revoke access |
| `ul.permissions.list` | List granted users |

### Discovery
| Tool | Description |
|------|-------------|
| `ul.discover.desk` | Last 3 apps the user called |
| `ul.discover.library` | Search owned + liked apps |
| `ul.discover.appstore` | Semantic search across all published apps |

### Social
| Tool | Description |
|------|-------------|
| `ul.like` | Like an app (saves to library, toggle) |
| `ul.dislike` | Dislike an app (hides from app store, toggle) |

### Monitoring & Connections
| Tool | Description |
|------|-------------|
| `ul.logs` | View MCP call logs for your app |
| `ul.connect` | Store per-user secrets for an app |
| `ul.connections` | View your connected apps |

Full tool documentation: [`skills.md`](skills.md)

---

## App Store Search Algorithm

App store results are ranked by a composite score, not just embedding similarity:

```
final_score = (similarity × 0.7) + (native_boost × 0.15) + (like_signal × 0.15)
```

**Similarity (70%)** — Cosine distance between query embedding and app's skills embedding (pgvector).

**Native boost (15%)** — Apps that need no user configuration rank higher:
- `1.0` — No per-user env vars (fully native)
- `0.8` — Required env vars, user has connected
- `0.3` — Optional env vars only
- `0.0` — Required env vars, user hasn't connected

**Like signal (15%)** — Community signal from paid-tier likes only. Free users can like/dislike (for library management), but their likes don't influence search ranking.

**Luck shuffle** — Among the top 5 results, scores are slightly randomized so closely-ranked apps take turns in position #1. Prevents winner-take-all dynamics.

All queries are logged anonymously for demand analysis.

---

## Tiers

| | Free | Fun | Pro | Scale | Enterprise |
|---|---|---|---|---|---|
| **Price** | $0 | $8/mo | $25/mo | $99/mo | $599/mo |
| **Apps** | 5 | 25 | Unlimited | Unlimited | Unlimited |
| **Calls/week** | 1K | 100K | 1M | 10M | 100M |
| **Publish to App Store** | No | No | Yes | Yes | Yes |
| **Visibility** | Private | Private | All | All | All |
| **Execution timeout** | 30s | 30s | 60s | 2min | 5min |
| **Log retention** | 7 days | 14 days | 30 days | 90 days | 365 days |

Pro+ tiers support overage billing for calls beyond the weekly limit.

---

## CLI Commands

```bash
ultralight login                    # Authenticate via Google OAuth
ultralight logout                   # Clear credentials
ultralight whoami                   # Show current user and tier

ultralight upload [dir]             # Upload code (new app or new version)
  --name "App Name"                 #   Set display name (new apps only)
  --visibility private|unlisted|published

ultralight apps list                # List your apps
ultralight apps get <app>           # Get app details
ultralight apps delete <app>        # Delete an app

ultralight draft status <app>       # Check draft status
ultralight draft publish <app>      # Publish draft as new version
ultralight draft discard <app>      # Discard draft

ultralight docs generate <app>      # Generate Skills.md
ultralight docs get <app>           # View documentation

ultralight run <app> <fn> [args]    # Execute a function
ultralight discover "query"         # Search the app store
```

---

## In-App SDK

Every app has access to the `ultralight` global at runtime:

```typescript
// Storage (per-app, scoped to your app)
await ultralight.store("key", { any: "value" });
const data = await ultralight.load("key");
const keys = await ultralight.query("prefix/", { limit: 10 });

// Memory (cross-app, scoped to the calling user)
await ultralight.remember("preference", "dark-mode");
const pref = await ultralight.recall("preference");

// AI (BYOK or platform credits)
const response = await ultralight.ai({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "Summarize this" }],
});

// Cron
await ultralight.cron.register("daily-report", "0 9 * * *", async () => {
  // runs every day at 9am
});

// Environment variables
const apiKey = ultralight.env.MY_API_KEY;

// User context
const user = ultralight.user; // { email, name, ... }
```

---

## Per-User Secrets

Apps can declare per-user environment variables via `env_schema`. Users connect their own API keys without the app developer ever seeing them.

**App developer declares the schema:**
```typescript
// In app settings or manifest
env_schema: {
  GITHUB_TOKEN: { scope: "per_user", description: "Your GitHub PAT", required: true },
  SLACK_WEBHOOK: { scope: "per_user", description: "Slack webhook URL", required: false }
}
```

**Users connect via MCP:**
```
ul.connect(app_id: "github-bot", secrets: { GITHUB_TOKEN: "ghp_xxx" })
```

Secrets are AES-256-GCM encrypted at rest. The app accesses them as regular env vars at runtime.

---

## Project Structure

```
ultralight/
├── api/
│   ├── handlers/
│   │   ├── app.ts              # Router + caching
│   │   ├── platform-mcp.ts     # Platform MCP (17 ul.* tools)
│   │   ├── mcp.ts              # Per-app MCP server
│   │   ├── upload.ts           # File upload + bundling
│   │   ├── apps.ts             # App CRUD
│   │   ├── http.ts             # HTTP endpoints
│   │   ├── auth.ts             # Google OAuth + API tokens
│   │   ├── user.ts             # User profile + permissions
│   │   └── tier.ts             # Tier management
│   ├── runtime/
│   │   └── sandbox.ts          # Isolated code execution
│   ├── services/
│   │   ├── apps.ts             # App service layer
│   │   ├── storage.ts          # Cloudflare R2 interface
│   │   ├── embedding.ts        # Vector embeddings (OpenRouter)
│   │   ├── docgen.ts           # Skills.md generation
│   │   ├── library.ts          # Library + desk management
│   │   ├── parser.ts           # TypeScript export extraction
│   │   ├── bundler.ts          # esbuild code bundling
│   │   ├── ai.ts               # AI provider integration
│   │   ├── cron.ts             # Cron job scheduler
│   │   ├── call-logger.ts      # MCP call audit log
│   │   ├── envvars.ts          # Secret encryption
│   │   ├── memory.ts           # Cross-app user memory
│   │   ├── appdata.ts          # Per-app data storage
│   │   ├── ratelimit.ts        # Rate limiting
│   │   ├── weekly-calls.ts     # Weekly call tracking
│   │   └── tier-enforcement.ts # Tier limit checks
│   └── main.ts                 # Deno server entry point
├── cli/                        # CLI tool (ultralightpro)
├── sdk/                        # TypeScript SDK (ultralightpro-sdk)
├── shared/types/               # Shared TypeScript types
├── skills.md                   # Platform tool documentation
└── migration*.sql              # Database migrations (13 files)
```

---

## Architecture

```
                    ┌─────────────────┐
                    │   AI Agents /   │
                    │   MCP Clients   │
                    └────────┬────────┘
                             │ JSON-RPC 2.0
                    ┌────────▼────────┐
                    │   Ultralight    │
                    │   Deno Server   │
                    └──┬──────┬───┬───┘
                       │      │   │
           ┌───────────┤      │   ├───────────┐
           │           │      │   │           │
    ┌──────▼──────┐ ┌──▼──────▼┐ ┌▼───────────▼┐
    │ Cloudflare  │ │ Supabase │ │  OpenRouter  │
    │     R2      │ │ Postgres │ │    (AI)      │
    │  (storage)  │ │+pgvector │ │  embeddings  │
    └─────────────┘ └──────────┘ └──────────────┘
```

- **Runtime**: Deno on DigitalOcean App Platform (Docker)
- **Database**: Supabase PostgreSQL + pgvector for semantic search
- **Storage**: Cloudflare R2 for code, app data, and user libraries
- **AI**: OpenRouter API for embeddings + multi-provider BYOK
- **Auth**: Supabase Auth (Google OAuth) + API tokens

---

## Self-Hosting

### Prerequisites

- Deno 2.0+
- Supabase project
- Cloudflare R2 bucket
- OpenRouter API key

### Environment Variables

```bash
# Supabase
SUPABASE_URL="https://xxx.supabase.co"
SUPABASE_SERVICE_ROLE_KEY="your-service-role-key"
SUPABASE_ANON_KEY="your-anon-key"

# Cloudflare R2
R2_ACCOUNT_ID="your-cloudflare-account-id"
R2_ACCESS_KEY_ID="your-r2-access-key"
R2_SECRET_ACCESS_KEY="your-r2-secret-key"
R2_BUCKET_NAME="ultralight-apps"

# AI (embeddings + discovery)
OPENROUTER_API_KEY="your-openrouter-key"

# Encryption (32-byte key for AES-256-GCM)
BYOK_ENCRYPTION_KEY="your-32-byte-encryption-key"
```

### Database Setup

Run migrations in order in the Supabase SQL Editor:

```
1.  migration.sql                  # Base schema (users, apps)
2.  migration-mcp-skills.sql       # MCP tools + skills docs
3.  migration-phase1.sql           # Env vars + HTTP endpoints
4.  migration-supabase.sql         # Supabase integration (BYOS)
5.  migration-api-tokens.sql       # API token management
6.  migration-byok.sql             # BYOK provider configs
7.  migration-permissions.sql      # User access controls
8.  migration-storage-tiers.sql    # Storage limits
9.  migration-tier-v2.sql          # 5-tier system + call logging
10. migration-supabase-servers.sql # Saved server configs
11. migration-platform-mcp-v2.sql  # Platform MCP v2 (likes, search_apps)
12. migration-discovery-layers.sql # Desk, library, blocks
13. migration-search-algo.sql      # Search ranking + demand logging
```

After running migrations, reload PostgREST schema cache in Supabase Dashboard.

### Run

```bash
# Development (with hot reload)
deno task dev

# Production
deno task start

# Docker
docker build -t ultralight .
docker run -p 8000:8000 --env-file .env ultralight
```

---

## License

MIT

## Credits

Built by Russell & Corin.
