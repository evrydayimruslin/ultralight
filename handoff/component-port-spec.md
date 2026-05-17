# Component port — spec sheet

This is the per-batch implementation plan. Each batch is one PR. Work top-down;
later batches depend on primitives landed earlier.

For every component below:
- **Mockup source** lives in this design project at `premium_ui/<file>.jsx`.
  Snapshots are bundled in `handoff/mockups/`.
- **Target file** is the path inside `desktop/src/` in the production repo.
- **Lookup**: use `tokens-mapping.md` for every literal style value.
- **Data**: replace mockup hardcoded arrays/strings with the listed hook or
  SDK call. If a hook doesn't exist yet, stub it with `TODO(data)` and flag in
  the PR — do not invent a new endpoint.

---

## Batch 0 — Token reconciliation (PR 1, blocking)

Files:
- Replace `desktop/tailwind.config.ts` with `handoff/tailwind.config.proposed.ts`.
- Append the contents of `handoff/globals.proposed.css` to
  `desktop/src/styles/globals.css`, immediately below the existing
  `Brand animations` section.
- Run `pnpm typecheck`, `pnpm dev`, `deno task verify` to confirm zero
  visual change.

**Visual change should be zero in this PR.** Anything that shifts is a bug.

---

## Batch 1 — Shell & primitives (foundation)

**Actual scope (revised after auditing mockup contents):**

| Mockup file | Target | Notes |
|---|---|---|
| `primitives.jsx` (Spark + Wordmark only) | `desktop/src/components/ui/Spark.tsx`, `Wordmark.tsx` | The mockup's `primitives.jsx` only defines `Spark`, `Wordmark`, and a `SYS_AGENTS` data array. The Button/Input/Badge/Chip/Glyph/StatusDot primitives listed in the original spec **do not exist in the mockup** — they were spec-by-filename. Defer to Batches 2-4 (see notes below). |
| `primitives.jsx` (`SYS_AGENTS` data) | `desktop/src/lib/systemAgents.ts` (extend) | Already exists with richer schema. Adds an `accent: string` field carrying the mockup's per-agent tone (`#3b82f6` tool_builder, `#004225` tool_marketer, `#722F37` platform_manager). Names stay as-is (production: "Tool Maker"/"Tool Dealer"/"Platform Guide"). |
| `icons.jsx` | `desktop/src/components/ui/icons.tsx` | All 26 mockup icons map 1:1 to `lucide-react`. Re-exported under mockup names with an inline mapping table. `Spark` is the only custom-drawn glyph. |
| `shell.jsx` (empty placeholder) + in-place refactor of `NavSidebar.tsx` + `TopToolbar.tsx` + `AgentHeader.tsx` | Same files | `shell.jsx` is a one-line `window.PUI_ShellPlaceholder = true` — no shell layout reference. The refactor is a **tokenization pass only** (exact-hex / exact-value swaps to `ul-*` tokens). No structural changes. Values without an exact token equivalent stay raw with a `// TODO(token): ...` comment. |

**Tauri**: the draggable region in `TopToolbar.tsx` uses `data-tauri-drag-region`.
Preserved by the in-place refactor.

**Skipped intentionally**: the four "before-state" components in
`primitives.jsx` (`PUI_BasicComposer`, `PUI_BasicToolCall`,
`PUI_BasicEmptyState`, `PUI_BasicLightFooter`). They're contrast demos for the
side-by-side comparison frames in the design HTML, not target designs.

---

## Batch 2 — Composer & chat

| Mockup file | Target | Data wiring |
|---|---|---|
| `composer.jsx` | `ChatInput.tsx` (refactor) | Already wired to `useChat` / `useAgent`. Visual upgrade only. |
| `toolcall.jsx` | `ToolCallCard.tsx` (refactor) | The mockup defines three states: pending / executing / completed / errored. Map to existing `ToolCall` discriminated union. |
| message bubble + typing + msg-rise animation | `MessageBubble.tsx`, `MessageList.tsx` | Apply `animate-msg-rise` to newly appended bubble nodes only (use `useRef` + `useEffect` to skip on initial paint). |

**Gotchas**:
- `ChatView.tsx` is 60KB. **Do not rewrite from scratch.** Land the
  composer + ToolCallCard refactor as small commits within it.
- The mockup's `executing` ring (`animate-ring-resolve`) is a transient
  animation. Trigger it on the transition `executing → completed` using a
  `useEffect` that watches `toolCall.status`.
- **Primitives deferred from Batch 1**: extract `Button`, `Input` here once 2-3
  callsites in this batch reveal the API surface. The composer alone uses both
  shapes inline; once you see them next to `ToolCallCard`'s buttons, the right
  abstraction will be obvious.

---

## Batch 3 — Library / Command screens

| Mockup file | Target | Data |
|---|---|---|
| `library-screens.jsx` | new `LibraryView.tsx` + sub-views `LibraryGrid.tsx`, `LibraryTable.tsx`, `LibraryShared.tsx` | `ul.discover({ scope: 'library', query? })` |
| `command-screens.jsx` | new `CommandPalette.tsx` (or fold into `palette-and-empty.jsx` work) | Local state + library hits |
| `tool-page.jsx` | new `ToolDetailView.tsx` | `ul.discover({ scope: 'library' })` per-app lookup; functions list from app manifest |

Add a new route entry to `App.tsx` for `/library`. If there's no router today,
extend the existing conditional-render pattern — don't introduce
`react-router` in this batch.

The `LB_TOOLS` array in the mockup is **placeholder data only**. Real shape
comes from the existing `App` type in `desktop/src/types/`.

**Primitives deferred from Batch 1**: extract `Badge`, `Chip`, `Glyph`,
`StatusDot` here. Library cards have category chips, library table rows have
status dots, and tool detail pages have per-app glyph tones — three concrete
callsites that should pin the right APIs.

---

## Batch 4 — Marketplace & acquisition

| Mockup file | Target | Data |
|---|---|---|
| `discover.jsx` | refactor `DiscoverWidget.tsx` | `ul.discover({ scope: 'appstore', query?, task? })` — already wired |
| `market.jsx` + `market-data.jsx` | new `MarketplaceView.tsx` (+ data type module) | `/api/discover/featured` + `ul.discover({ scope: 'appstore' })` |
| `acquisition.jsx` | new `AcquisitionFlow.tsx` (modal-step flow) | New SDK calls — flag in PR; check `cli/` and `api/` for the actual endpoint |
| `acquisition-handoff.jsx` | sub-step of `AcquisitionFlow.tsx` | Same |

This batch introduces the **warm-paper theme** (`bg-ul-warm-paper`,
`text-ul-warm-ink`, `bg-ul-copper` CTAs). Use it only on the marketplace
canvas and the acquisition modal — the rest of the app stays on the white
theme.

**Routing**: add `/marketplace` route. Acquisition modal opens from a button
in `MarketplaceView` and from any app detail page.

---

## Batch 5 — Profile & Light (credit/billing)

| Mockup file | Target | Data |
|---|---|---|
| `profile-screens.jsx` | new `ProfileView.tsx` + sub `BillingHistory.tsx`, `UsageGraph.tsx` | `ultralight.user`, plus new endpoints for usage/receipts — flag in PR |
| `light-and-receipts.jsx` | new `LightLedger.tsx` (inside ProfileView) | Same |
| `add-light-flows.jsx` | refactor `BalanceIndicator.tsx` to open this flow; new `AddLightModal.tsx` | Stripe Checkout link — check `api/` for current pattern |

`BalanceIndicator.tsx` already exists at 1.4KB — minimal; safe to enrich.

The "credit applied" success animation (`animate-credit-rise`) fires from the
flash overlay on the balance pill after a successful purchase.

---

## Batch 6 — Onboarding & empty/palette states

| Mockup file | Target |
|---|---|
| `onboarding.jsx` | refactor `OnboardingWizard.tsx` + `AuthGate.tsx` |
| `palette-and-empty.jsx` | empty states across `LibraryView`, `MarketplaceView`, `ChatView` |

**Gotcha**: the auth flow already exists and is wired to the API. **Don't
break the OAuth callback**. Visual-only changes in this batch.

---

## Files NOT to touch in any phase

These are operational / build artifacts. Leave alone unless the spec
explicitly says otherwise:

- `desktop/src-tauri/` — Rust side, no design changes
- `desktop/analysis-*.json` — analyzer baselines; updated by their own scripts
- `desktop/vite.config.ts`, `tsconfig.json`, `postcss.config.js`
- `desktop/knip.json` — keep `lucide-react`, `react-markdown` etc. in the
  baseline unless you're genuinely removing a dependency

---

## PR template (paste into description)

```md
## Batch N — <name>

### Mockups
- premium_ui/<file>.jsx
- (screenshot: drag from design project)

### Implementation
- (screenshot of localhost:1420)

### Token discipline
- [ ] No new colors invented (vs. `tailwind.config.proposed.ts`)
- [ ] No inline `style={{ ... }}` except per-app glyph tones
- [ ] Brand-icon literals only on brand SVGs
- [ ] No new dependencies

### Verification
- [ ] `pnpm typecheck` passes
- [ ] `pnpm dev` runs and screen matches mockup
- [ ] `deno task verify` passes
- [ ] Spot-check both themes (default + warm-paper, if marketplace)

### Divergences from mockup
- (none) OR (list, with rationale)
```

---

## Sanity checks before merging Batch 0

Before any component batch, confirm these are still true after the token
PR lands:

1. `desktop/src/styles/globals.css` defines: `--ul-text`, `--ul-bg`,
   `--ul-border`, `--ul-accent`, plus everything in `colors_and_type.css` §
   ROOT.
2. `pnpm dev` renders `App.tsx` without visible regression.
3. `pnpm typecheck` reports zero errors.
4. `deno task verify` is green.

If any of those fail, fix Batch 0 before moving to Batch 1.
