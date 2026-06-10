# Plan: Unified Content Permissions, Publishing & Discovery

## The Core Insight

Right now Ultralight has three separate content systems that don't talk to each other:

1. **Apps** — have embeddings, discovery, permissions, visibility (`public`/`private`/`unlisted`)
2. **Pages** — R2-only, always public, no embeddings, no discovery, no permissions
3. **Memory** — R2 + KV table, private-only, no sharing, no embeddings

The 10x move: **unify all content into a single content layer** with shared permissions, shared discovery, and shared embedding search. One `search_content` RPC replaces siloed lookups. One permission model governs everything.

---

## Architecture: The Content Table

Instead of scattered R2 indexes and separate tables, introduce a single `content` table that indexes ALL user content alongside apps:

```sql
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Identity
  type TEXT NOT NULL,               -- 'page' | 'memory_md' | 'library_md'
  slug TEXT NOT NULL,               -- page slug, or '_memory' / '_library' sentinel
  title TEXT,
  description TEXT,                 -- short summary for search results

  -- Visibility & Access
  visibility TEXT NOT NULL DEFAULT 'private',  -- 'public' | 'private' | 'shared'
  access_token TEXT,                -- for shared link access (?token=...)

  -- Search
  embedding vector(1536),          -- same pgvector as apps
  embedding_text TEXT,              -- the text that was embedded (for debugging)

  -- Metadata
  size INTEGER,
  tags TEXT[],                      -- optional tags for filtering
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(owner_id, type, slug)
);

-- Indexes for fast lookup
CREATE INDEX idx_content_owner ON content(owner_id);
CREATE INDEX idx_content_type ON content(type);
CREATE INDEX idx_content_visibility ON content(visibility);
CREATE INDEX idx_content_embedding ON content USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
```

**Content lives in R2 (unchanged), metadata + embeddings live in the table.** The content table is an *index*, not the storage. R2 remains the source of truth for actual markdown content.

### Sharing

```sql
CREATE TABLE IF NOT EXISTS content_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  shared_with_user_id UUID REFERENCES users(id),  -- null if not signed up
  access_level TEXT NOT NULL DEFAULT 'read',       -- 'read' | 'readwrite'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(content_id, shared_with_email)
);
```

### Unified Search RPC

```sql
CREATE OR REPLACE FUNCTION search_content(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_types TEXT[] DEFAULT NULL,       -- filter: ['page', 'memory_md'] or NULL for all
  p_visibility TEXT DEFAULT NULL,    -- filter: 'public' or NULL for all accessible
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID,
  type TEXT,
  slug TEXT,
  title TEXT,
  description TEXT,
  owner_id UUID,
  visibility TEXT,
  similarity FLOAT,
  tags TEXT[],
  updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.type, c.slug, c.title, c.description,
    c.owner_id, c.visibility,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    c.tags, c.updated_at
  FROM content c
  LEFT JOIN content_shares cs ON cs.content_id = c.id AND cs.shared_with_user_id = p_user_id
  WHERE
    c.embedding IS NOT NULL
    AND (p_types IS NULL OR c.type = ANY(p_types))
    AND (
      c.visibility = 'public'                              -- public to all
      OR c.owner_id = p_user_id                           -- own content
      OR cs.id IS NOT NULL                                 -- shared with me
    )
    AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

This single function replaces the need for separate page/memory/library search — and it composes with the existing `search_apps` for a unified discovery experience.

---

## How Discovery Changes

### Current: Siloed

```
ul.discover.library  → searches apps only (owned + liked)
ul.discover.appstore → searches apps only (public)
ul.pages             → lists pages (no search)
ul.memory.query      → lists KV keys (no semantic search)
```

### New: Unified with `type` filter

**`ul.discover.library`** gains a `types` filter parameter:

```typescript
ul.discover.library({
  query: "project notes",
  types: ["page", "memory_md"]  // optional filter
})
```

Without `types`: searches apps + pages + memory (everything the user owns/has access to).
With `types`: filters to specific content types.

**Internally**, the handler:
1. Calls `search_apps()` for app results (existing)
2. Calls `search_content()` for content results (new)
3. Merges and re-ranks by similarity
4. Returns unified results with a `source` field: `"app"`, `"page"`, `"memory_md"`, `"library_md"`, `"shared"`

**`ul.discover.appstore`** gains `types` too:

```typescript
ul.discover.appstore({
  query: "weekly report template",
  types: ["page"]  // only search published pages
})
```

Without `types`: searches apps only (existing behavior, backward compatible).
With `types: ["page"]` or `types: ["app", "page"]`: includes public pages in results.

The composite re-ranking formula extends naturally:
```
final_score = (similarity * 0.7) + (type_boost * 0.15) + (like_signal * 0.15)
```

Where `type_boost` for pages = 0.5 (no env vars concept), and for apps = existing `native_boost`.

---

## How Publishing Changes

### `ul.markdown` — Updated

```typescript
ul.markdown({
  content: "# My Report\n...",
  slug: "weekly-report",
  title: "Weekly Report",
  visibility: "public",          // NEW: 'public' | 'private' | 'shared'
  shared_with: ["bob@co.com"],   // NEW: emails for 'shared' visibility
  tags: ["report", "weekly"],    // NEW: optional tags
  published: true                // NEW: if true AND public, index in appstore results
})
```

**Flow:**
1. Write markdown to R2 at `users/{userId}/pages/{slug}.md` (unchanged)
2. Upsert into `content` table with visibility, tags
3. If `published: true` and `visibility: 'public'`:
   - Generate embedding from title + content summary
   - Store embedding in `content.embedding`
   - Now discoverable via `ul.discover.appstore({ types: ["page"] })`
4. If `visibility: 'shared'`:
   - Generate `access_token`
   - Insert `content_shares` rows
   - Return URL with `?token=...`
5. Update R2 `_index.json` (backward compat)

### `ul.page.share` — New Tool

```typescript
ul.page.share({
  slug: "weekly-report",
  add_emails: ["alice@co.com"],
  remove_emails: ["old@co.com"],
  regenerate_token: false
})
```

### `ul.pages` — Updated

Now returns visibility and share info:

```typescript
{
  pages: [
    { slug, title, visibility: "public", published: true, url, size, updated_at },
    { slug, title, visibility: "shared", shared_with: ["bob@co.com"], url: "/p/.../...?token=...", size, updated_at },
    { slug, title, visibility: "private", url, size, updated_at }
  ]
}
```

---

## How Page Serving Changes

**`handlePublishedPage()` in `app.ts`:**

```
GET /p/{userId}/{slug}
  │
  ├─ Fetch content row from DB (owner_id + slug, type='page')
  │
  ├─ visibility = 'public'?  → serve (existing behavior)
  │
  ├─ visibility = 'private'? → check auth, must be owner
  │
  └─ visibility = 'shared'?
       ├─ ?token=... matches access_token? → serve
       ├─ auth user email in content_shares? → serve
       └─ else → 401
```

Fast path: if no content row exists in DB, assume public (backward compat with existing pages that predate this feature).

---

## How Memory Fits In

### memory.md → Content Table

When `ul.memory.write` or `ul.memory.append` is called:
1. Write to R2 as before
2. Upsert `content` row: `type='memory_md'`, `slug='_memory'`, `visibility='private'`
3. Generate embedding from memory.md content (truncated to first ~2000 tokens)
4. Memory.md is now **semantically searchable** via `ul.discover.library`

### Memory Sharing

```typescript
ul.memory.share({
  key: "_memory_md",              // share entire memory.md
  email: "alice@co.com",
  access: "read"
})
```

Or share specific KV keys:
```typescript
ul.memory.share({
  key: "project_*",              // share all keys matching pattern
  email: "alice@co.com",
  access: "readwrite"
})
```

**Implementation:** For memory.md sharing, create a `content_shares` row on the `type='memory_md'` content entry. For KV sharing, use the existing `memory_shares` table from the original plan (pattern-based).

### Cross-User Memory Access

Extend `ul.memory.recall` and `ul.memory.read`:

```typescript
// Read someone's shared memory.md
ul.memory.read({ owner_email: "alice@co.com" })

// Read someone's shared KV key
ul.memory.recall({ key: "project_status", owner_email: "alice@co.com" })
```

---

## How library.md Fits In

When `rebuildUserLibrary()` runs:
1. Write compiled library.md to R2 as before
2. Upsert `content` row: `type='library_md'`, `slug='_library'`, `visibility='private'`
3. Generate embedding from library.md content

Library sharing works the same as memory sharing — share your compiled library with collaborators.

---

## Embedding Strategy for Pages

**App embeddings** use structured text: name + description + function signatures.

**Page embeddings** use: title + first ~500 words of content + tags.

```typescript
function generatePageEmbeddingText(title: string, content: string, tags?: string[]): string {
  const parts: string[] = [];
  parts.push(title);
  if (tags?.length) parts.push(`Tags: ${tags.join(', ')}`);
  // Truncate content to ~500 words for embedding
  const words = content.split(/\s+/).slice(0, 500);
  parts.push(words.join(' '));
  return parts.join('\n');
}
```

**Memory.md embeddings** use: `"User memory and preferences: " + first ~500 words`.

---

## Tool Changes Summary

### Modified Tools
| Tool | Change |
|------|--------|
| `ul.markdown` | Add `visibility`, `shared_with`, `tags`, `published` params |
| `ul.pages` | Return `visibility`, `shared_with`, `published` per page |
| `ul.discover.library` | Add `types` filter param; merge content results with app results |
| `ul.discover.appstore` | Add `types` filter param; include published pages in results |
| `ul.memory.write` | Upsert content row + generate embedding |
| `ul.memory.append` | Same |
| `ul.memory.read` | Add `owner_email` for cross-user access |
| `ul.memory.recall` | Add `owner_email` for cross-user access |
| `ul.memory.query` | Add `owner_email` for cross-user access |

### New Tools
| Tool | Purpose |
|------|---------|
| `ul.page.share` | Add/remove email access to shared pages, regenerate tokens |
| `ul.memory.share` | Share memory keys/patterns with another user |
| `ul.memory.unshare` | Revoke memory sharing |
| `ul.memory.shared` | List what others have shared with you |

---

## Migration File

```sql
-- migration-content-layer.sql

-- 1. Content index table
CREATE TABLE IF NOT EXISTS content (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  slug TEXT NOT NULL,
  title TEXT,
  description TEXT,
  visibility TEXT NOT NULL DEFAULT 'private',
  access_token TEXT,
  embedding vector(1536),
  embedding_text TEXT,
  size INTEGER,
  tags TEXT[],
  published BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id, type, slug)
);

CREATE INDEX IF NOT EXISTS idx_content_owner ON content(owner_id);
CREATE INDEX IF NOT EXISTS idx_content_type_vis ON content(type, visibility);
CREATE INDEX IF NOT EXISTS idx_content_published ON content(published) WHERE published = true;

-- 2. Content sharing
CREATE TABLE IF NOT EXISTS content_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  shared_with_email TEXT NOT NULL,
  shared_with_user_id UUID REFERENCES users(id),
  access_level TEXT NOT NULL DEFAULT 'read',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(content_id, shared_with_email)
);

CREATE INDEX IF NOT EXISTS idx_content_shares_user ON content_shares(shared_with_user_id);
CREATE INDEX IF NOT EXISTS idx_content_shares_email ON content_shares(shared_with_email);

-- 3. Memory key sharing (pattern-based, separate from content_shares)
CREATE TABLE IF NOT EXISTS memory_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope TEXT NOT NULL DEFAULT 'user',
  key_pattern TEXT NOT NULL,
  shared_with_email TEXT NOT NULL,
  shared_with_user_id UUID REFERENCES users(id),
  access_level TEXT NOT NULL DEFAULT 'read',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  UNIQUE(owner_user_id, scope, key_pattern, shared_with_email)
);

-- 4. Unified search RPC
CREATE OR REPLACE FUNCTION search_content(
  p_query_embedding vector(1536),
  p_user_id UUID,
  p_types TEXT[] DEFAULT NULL,
  p_visibility TEXT DEFAULT NULL,
  p_limit INTEGER DEFAULT 20
) RETURNS TABLE (
  id UUID, type TEXT, slug TEXT, title TEXT, description TEXT,
  owner_id UUID, visibility TEXT, similarity FLOAT,
  tags TEXT[], updated_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id, c.type, c.slug, c.title, c.description,
    c.owner_id, c.visibility,
    1 - (c.embedding <=> p_query_embedding) as similarity,
    c.tags, c.updated_at
  FROM content c
  LEFT JOIN content_shares cs
    ON cs.content_id = c.id AND cs.shared_with_user_id = p_user_id
  WHERE
    c.embedding IS NOT NULL
    AND (p_types IS NULL OR c.type = ANY(p_types))
    AND (
      c.visibility = 'public'
      OR c.owner_id = p_user_id
      OR cs.id IS NOT NULL
    )
    AND (p_visibility IS NULL OR c.visibility = p_visibility)
  ORDER BY similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

## Implementation Order

### Step 1: Migration + Content Table + search_content RPC
- Create migration file
- Run migration

### Step 2: ul.markdown — visibility, sharing, embedding, publishing
- Update `executeMarkdown()`: visibility, shared_with, tags, published
- On publish with `published: true`: generate embedding, insert content row
- Update `executePages()`: return visibility/sharing info
- Add `ul.page.share` tool

### Step 3: Page serving auth
- Update `handlePublishedPage()`: check visibility, token, shares
- Backward compat: no content row = public

### Step 4: Unified discovery
- Update `executeDiscoverLibrary()`: add `types` param, call `search_content`, merge results
- Update `executeDiscoverAppstore()`: add `types` param, include published pages
- Update tool schemas with `types` filter

### Step 5: Memory integration
- Update `writeUserMemory()`/`appendUserMemory()`: upsert content row + embedding
- `rebuildUserLibrary()`: upsert content row + embedding
- Add `ul.memory.share`, `ul.memory.unshare`, `ul.memory.shared` tools
- Extend `ul.memory.read/recall/query` with `owner_email`

### Step 6: UI updates
- Show visibility controls in pages listing
- Show shared-with info

---

## Key Design Decisions

1. **Content table is an index, not storage** — R2 remains the source of truth for actual content. The content table stores metadata, embeddings, and access control. This avoids migrating existing R2 data.

2. **Published pages join the appstore** — `published: true` + `visibility: 'public'` makes a page discoverable via `ul.discover.appstore`. This is opt-in, not automatic. Private/shared pages never appear in appstore.

3. **`types` filter is additive** — existing discover calls without `types` behave exactly as before (apps only in appstore, apps+memory in library). Adding `types` *expands* what's searched, never narrows the default.

4. **Two sharing systems** — `content_shares` for whole-content sharing (pages, memory.md, library.md) and `memory_shares` for KV key pattern sharing. They serve different access patterns. content_shares uses the content table FK; memory_shares uses pattern matching on the memory KV table.

5. **Embedding on write, not read** — page/memory embeddings are generated when content is written, not when someone searches. This makes search fast (just vector comparison) at the cost of a slight write-time latency.

6. **Backward compatibility** — pages with no content row in DB are treated as public. Existing discovery calls without `types` return existing results. No breaking changes.
