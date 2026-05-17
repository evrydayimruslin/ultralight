# Ultralight Premium UI — Implementation Handoff

This package is the source of truth for porting the premium UI mockups
(`Premium UI.html`, `Command Library Profile.html`, `Marketplace & Acquisition.html`)
into the production codebase at `evrydayimruslin/ultralight` → `desktop/`.

## Who this is for

A coding agent (Claude Code) running in the repo, with one human reviewer.

## Order of operations

Do these in order. Each step lands as its own PR so review stays sane.

1. **PR 1 — Token reconciliation.** Apply `tailwind.config.proposed.ts` and
   `globals.proposed.css`. Verify `pnpm dev`, `pnpm typecheck`,
   `deno task verify`. No visual changes yet. See `DESIGN-TOKENS-DIFF.md` for
   rationale.

2. **PR 2-N — Component ports.** Work batch-by-batch through
   `component-port-spec.md`. For each batch:
   - Open the listed mockup `.jsx` file in the design project for visual reference.
   - Map every inline style to a Tailwind class using `tokens-mapping.md`.
   - Replace mock data with the existing hook / SDK call listed.
   - Run `pnpm dev` and screenshot the result alongside the mockup.
   - Run `deno task verify` before pushing.

## What's in this package

| File | Purpose |
|------|---------|
| `DESIGN-TOKENS-DIFF.md` | Empirical diff: what the mockups use vs. what `tailwind.config.ts` defines. Decisions for each gap. |
| `tailwind.config.proposed.ts` | Drop-in replacement for `desktop/tailwind.config.ts`. |
| `globals.proposed.css` | Additions for `desktop/src/styles/globals.css` (keyframes + helper classes). |
| `tokens-mapping.md` | Lookup table: mockup inline value → Tailwind class. The porting agent's main cheat sheet. |
| `component-port-spec.md` | Per-component spec: mockup file → target file, batches, data wiring, gotchas. |
| `mockups/` | Snapshot of the mockup `.jsx` files at handoff time. Read-only reference — do not import. |

## Hard rules for the porting agent

1. **No new tokens.** If a mockup value isn't covered by
   `tailwind.config.proposed.ts`, flag it in the PR description and ask. Don't
   invent.
2. **No inline styles in production code.** Convert every `style={{…}}` to
   Tailwind classes. The one exception: dynamic per-app glyph tones (`tone:
   '#7c3aed'`) — those are *data*, not design tokens, and stay as inline
   `style={{ background: tone }}`.
3. **No new dependencies.** Stick to `react`, `react-dom`, `lucide-react`,
   `react-markdown`, `remark-gfm`, `gpt-tokenizer`, and the Tauri plugins
   already in `package.json`.
4. **Tauri-specific affordances** (window controls, native menu, file dialogs,
   deep links) are flagged in `component-port-spec.md`. Don't reinvent — call
   the existing wrappers in `src/lib/` and `src/hooks/`.
5. **Speaker the design** in the PR description: paste the mockup screenshot,
   the implementation screenshot, and call out any intentional divergence.
