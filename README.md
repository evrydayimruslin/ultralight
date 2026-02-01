# Ultralight

The deployment target for vibecoders.

## What is this?

Ultralight lets you deploy TypeScript/JavaScript apps instantly. No servers to configure, no Docker to learn, no AWS accounts to manage.

Built something cool with Cursor or Claude Code? Drag your folder, get a URL, done.

## Quick Start

```bash
# Install dependencies (Deno)
deno --version  # Need 2.0+

# Set environment variables
export SUPABASE_URL="your-supabase-url"
export SUPABASE_SERVICE_ROLE_KEY="your-key"
export R2_ACCOUNT_ID="your-cloudflare-account"
export R2_ACCESS_KEY_ID="your-r2-key"
export R2_SECRET_ACCESS_KEY="your-r2-secret"
export R2_BUCKET_NAME="ultralight-apps"
export OPENROUTER_API_KEY="your-openrouter-key"

# Run locally
cd api
deno run --allow-all main.ts

# Or deploy to Deno Deploy
deno deploy --prod main.ts
```

## Project Structure

```
ultralight/
├── api/                  # Deno Deploy API
│   ├── handlers/         # HTTP route handlers
│   │   ├── app.ts       # Router
│   │   ├── upload.ts    # File upload
│   │   ├── run.ts       # Code execution
│   │   ├── auth.ts      # Authentication
│   │   └── apps.ts      # App listing
│   ├── runtime/         # Sandbox execution
│   │   └── sandbox.ts   # Deno isolate wrapper
│   ├── services/        # External integrations
│   │   ├── storage.ts   # Cloudflare R2
│   │   ├── memory.ts    # Supabase memory
│   │   └── ai.ts        # OpenRouter AI
│   └── main.ts          # Entry point
├── web/                 # Frontend components
│   └── upload-page.ts   # Upload UI
├── shared/              # Shared types/utils
│   └── types/
│       └── index.ts     # TypeScript definitions
└── memory/              # Project documentation
    ├── ultralight-mvp-spec.md
    ├── ultralight-schema-final.sql
    └── ...
```

## How it Works

1. **Upload**: User drags code folder → validated → stored in R2
2. **Parse**: Entry file analyzed → exports extracted → metadata saved
3. **Run**: HTTP request → code fetched from R2 → executed in Deno sandbox
4. **SDK**: Injected `remember()`, `recall()`, `ai()` available to user code

## Architecture

- **Runtime**: DigitalOcean App Platform (Docker) or any container host
  - Note: Deno Deploy blocks dynamic code execution (`new Function()`), so use Docker deployment
- **Storage**: Cloudflare R2 (zero egress)
- **Database**: Supabase PostgreSQL
- **Auth**: Supabase Auth (Google OAuth)
- **AI**: OpenRouter API

## Database Setup

1. Run `migration.sql` in Supabase SQL Editor
2. **Important**: After running migrations, go to Supabase Dashboard → Settings → API → Click "Reload Schema"
   - This refreshes PostgREST's schema cache so it recognizes new tables and RPC functions

## Development

### Milestone 1: Hello Vibe

- [x] Project scaffolding
- [x] Type definitions
- [x] Sandbox runtime
- [ ] Database setup
- [ ] R2 integration
- [ ] Upload endpoint
- [ ] Run endpoint
- [ ] Frontend UI

### Milestone 2: Smart Memory

- [ ] `remember()` implementation
- [ ] `recall()` implementation
- [ ] Unified memory model

### Milestone 3: AI Powered

- [ ] OpenRouter integration
- [ ] Credit tracking
- [ ] BYOK support

### Milestone 4: Permissions & Polish

- [ ] iOS-style permissions
- [ ] Tier enforcement
- [ ] App visibility

### Milestone 5: App Store

- [ ] Discovery page
- [ ] Search
- [ ] Popular rankings

## Environment Variables

| Variable                    | Description               |
| --------------------------- | ------------------------- |
| `SUPABASE_URL`              | Supabase project URL      |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key |
| `R2_ACCOUNT_ID`             | Cloudflare account ID     |
| `R2_ACCESS_KEY_ID`          | R2 API token key          |
| `R2_SECRET_ACCESS_KEY`      | R2 API token secret       |
| `R2_BUCKET_NAME`            | R2 bucket name            |
| `OPENROUTER_API_KEY`        | OpenRouter API key        |
| `DENO_DEPLOY_TOKEN`         | For CLI deployment        |

## License

MIT

## Credits

Built by Russell & Corin for vibecoders everywhere.
