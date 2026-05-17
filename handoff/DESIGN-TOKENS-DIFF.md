# Design Tokens — Diff & Decisions

**Source A:** `desktop/tailwind.config.ts` + `desktop/src/styles/globals.css` on
`evrydayimruslin/ultralight@main` (the current production theme).

**Source B:** All `.jsx` mockups in this design project — the values actually
used to build `Premium UI.html`, `Command Library Profile.html`, and
`Marketplace & Acquisition.html`.

Method: scraped every `#hex`, `rgba(…)`, `borderRadius:`, `fontSize:`,
`fontWeight:`, and `height:` literal across all mockup JSX. Counts in parens
are total occurrences.

---

## 1. Colors

### 1a. Already covered — no change

| Mockup literal | Existing token | Notes |
|---|---|---|
| `#fff` (×255) | `bg-ul-bg` | |
| `#fafafa` (×41) | `bg-ul-bg-raised` | |
| `#0a0a0a` (×23) | `text-ul-text` / `bg-ul-accent` | |
| `#555` (×1) | `text-ul-text-secondary` | |
| `#999` (×1), `#9a9a9a` | `text-ul-text-muted` | |
| `#22c55e` (×30) | `text-ul-success` / `bg-ul-success` | |
| `#ef4444` (×10) | `text-ul-error` | |
| `#f59e0b` (×3) | `text-ul-warning` | |
| `#3b82f6` (×19) | `text-ul-info` *(see §1d)* | |
| `#004225` (×8) | `text-ul-deep-green` *(see §1d)* | Tool Marketer system agent |
| `#722f37` (×8) | `text-ul-wine` *(see §1d)* | Platform Manager system agent |
| `rgba(0,0,0,0.04)` (×33) | `bg-ul-bg-hover` | |
| `rgba(0,0,0,0.06)` (×27) | `bg-ul-bg-active` / `bg-ul-accent-soft` | |
| `rgba(0,0,0,0.02)` (×13) | `bg-ul-bg-subtle` | |
| `rgba(0,0,0,0.08)` (×10) | `border-ul-border` | |
| `rgba(0,0,0,0.15)` (×3) | `border-ul-border-strong` | |

### 1b. Net-new colors — ADD as tokens

These appear often enough across multiple components that they belong in the
theme, not as literals.

| Add as | Value | Used by | Occurrences |
|---|---|---|---|
| `ul.violet` | `#7c3aed` | Story Builder, Home Inventory, marketplace category tag | 7 |
| `ul.violet-soft` | `rgba(124,58,237,0.10)` | violet badge bg | derived |
| `ul.copper` | `#c96442` | "Light" accent — marketplace CTA, Add Light flow, premium upgrade | 4 |
| `ul.copper-hover` | `#b5563a` | copper button :hover | 1 |
| `ul.copper-soft` | `rgba(201,100,66,0.12)` | copper chip bg | 1 |
| `ul.success-strong` | `#15803d` | credit-applied state, "success" body text on light bg | 13 |
| `ul.success-hover` | `#16a34a` | success button :hover | 12 |
| `ul.completed` | `#60a5fa` | tool call "completed" dot (already in `globals.css` as `.ul-dot-completed`, promote to token) | 1 |
| `ul.warm-paper` | `#f6f6f4` | marketplace canvas, acquisition modal | 4 |
| `ul.warm-ink` | `#29261b` | marketplace heading on warm paper | 2 |
| `ul.warm-ink-muted` | `rgba(41,38,27,0.55)` | marketplace secondary text | 1 |

### 1c. Per-app glyph tones — KEEP as inline data

`LB_TOOLS` in `library-screens.jsx` carries a `tone` color per app
(`#3b82f6`, `#22c55e`, `#722F37`, `#ef4444`, `#7c3aed`, `#004225`). This is
**data, not a design token** — it's a property of each app record, like its
icon URL. Port it as a `tone: string` field on the app object and apply via
`style={{ background: app.tone }}`.

Constrain the data layer to the existing palette: `accent`, `success`,
`error`, `warning`, `info`, `violet`, `copper`, `deep-green`, `wine`. Anything
else gets normalized at the type boundary.

### 1d. Promote from `globals.css` `:root` vars → Tailwind tokens

`colors_and_type.css` (the design-system snapshot) defines these CSS vars but
the Tailwind config in `tailwind.config.ts` doesn't expose them as utilities.
Add them so we can `text-ul-info` instead of `text-[#3b82f6]`:

- `info: '#3b82f6'`, `info-soft: 'rgba(59,130,246,0.10)'`
- `deep-green: '#004225'`
- `wine: '#722F37'`
- `bg-sidebar: '#f9fafb'` (already a CSS var; expose to Tailwind)

### 1e. Brand-icon literals — KEEP as inline `style`

These are third-party brand marks (OAuth icons, integration logos). They are
**not** part of our design system. Inline them where used.

| Color | Brand |
|---|---|
| `#4285f4`, `#ea4335`, `#1a73e8` | Google |
| `#611f69` | Slack |
| `#635bff` | Stripe |
| `#3ecf8e` | Supabase |
| `#34c759` | iOS / system green badge |
| `#d97757` | Anthropic mark |

Document the rule in `tokens-mapping.md`: brand colors live as `bg-[#hex]`
arbitrary values *only* on the brand icon SVG; never on text, button, or
container styling.

### 1f. Drop / dedupe

These appeared once or twice and should be normalized to an existing token:

| Literal | Replace with |
|---|---|
| `#000`, `#000000`, `#1f1f1f` | `bg-ul-text` (`#0a0a0a`) |
| `#a1a1a1`, `#888`, `#bbb`, `#cbd5e1` | `text-ul-text-muted` |
| `#e5e5e5`, `#e5e7eb`, `#f3f4f6` | `border-ul-border` or `bg-ul-bg-hover` |
| `#dc2626`, `#b91c1c` | `text-ul-error` (one shade) |
| `#10b981`, `#3ecf8e` (when not Supabase) | `text-ul-success` |
| `#0ea5e9`, `#0891b2` | `text-ul-info` |
| `#14b8a6`, `#a7f3d0`, `#ec4899`, `#ea580c`, `#e8590c`, `#c04d2e` | Flag in PR — these are one-off accents and probably should not survive the port unless tied to a specific named feature. |

The mixed-case `rgba(0,0,0,.06)` vs `rgba(0,0,0,0.06)` and varying digit
widths (`rgba(0,0,0,0.10)` vs `rgba(0,0,0,0.1)`) all collapse to the same
opacity tokens.

---

## 2. Type scale

The current `tailwind.config.ts` defines: `display 48` / `h1 32` / `h2 24` /
`h3 18` / `body-lg 16` / `body 14` / `small 13` / `caption 12`.

The mockups use:

| Mockup px | Occurrences | Current scale covers? | Decision |
|---|---|---|---|
| **11** | **220** | ❌ | **ADD `micro: 11px / 1.4 / 500 / 0.02em`** — used for mono badges, version chips, table column headers. Non-negotiable. |
| 12 | 157 | ✓ `caption` | |
| 10 | 153 | ❌ | **ADD `nano: 10px / 1.3 / 500 / 0.04em uppercase`** — eyebrow labels, mono category tags. Slightly tighter letter-spacing than `caption`. |
| 13 | 153 | ✓ `small` | |
| 14 | 62 | ✓ `body` | |
| 22 | 37 | ❌ | **Use `h2` (24)**. The 2px difference is noise; collapse it. (Exception: if a screen actually needs 22 next to a 24 for hierarchy, allow `text-[22px]`; flag in PR.) |
| 18 | 26 | ✓ `h3` | |
| 16 | 17 | ✓ `body-lg` | |
| 26 | 11 | ❌ | **Use `h2` (24)** for consistency; the 2px is again noise. |
| 24 | 10 | ✓ `h2` | |
| 9 | 64 | ❌ | Allow `text-[9px]` for avatar count overlays only. Don't tokenize — it's a one-pattern hack. |

**Net additions to `theme.fontSize`:**

```ts
'nano':  ['10px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.04em' }],
'micro': ['11px', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.02em' }],
```

`micro` is what every monospace metadata badge ("v1.0.45", "19 fns",
"installed 2d ago") will use. `nano` is for mono category tags / table column
headers.

---

## 3. Border radius

Current scale: `sm 6` / `md 8` / `lg 12` / `xl 16`. Plus implicit
`rounded-full` (9999).

| Mockup px | Occurrences | Current scale covers? | Decision |
|---|---|---|---|
| 9999 | 103 | ✓ `rounded-full` | |
| 8 | 73 | ✓ `md` | |
| **10** | **56** | ❌ | **ADD `pill: 10px`** — tool cards, library row items. Subtler than `lg 12`. |
| 12 | 39 | ✓ `lg` | |
| 6 | 39 | ✓ `sm` | |
| **14** | **23** | ❌ | **ADD `card: 14px`** — premium tool cards in marketplace grid. |
| 4 | 23 | ❌ | **ADD `xs: 4px`** — micro chips ("19 fns"). |
| 16 | 7 | ✓ `xl` | |
| 5, 7, 3, 2, 18, 22, 1 | each ≤7 | ❌ | Use nearest token. 22 specifically is for 22px avatars — that's `rounded-full` since `width === radius × 2`. |

**Net additions to `theme.borderRadius`:**

```ts
'xs':   '4px',
'pill': '10px',
'card': '14px',
```

---

## 4. Shadow scale

Current: `sm`, `md`, `lg`, `xl`, `glow`. The mockup uses **22 distinct
boxShadow values**. Audit shows they all collapse cleanly:

| Mockup shadow | Existing token |
|---|---|
| `0 1px 2px rgba(0,0,0,0.05)` | `shadow-sm` |
| `0 4px 12px rgba(0,0,0,0.08)` and `0 6px 18px rgba(0,0,0,0.06)`, `0 10px 28px rgba(0,0,0,0.08)` | `shadow-md` |
| `0 8px 30px rgba(0,0,0,0.10)`, `0 8px 24px rgba(0,0,0,0.06)` | `shadow-lg` |
| `0 12px 32px …`, `0 16px 50px …`, `0 20px 60px …`, `0 24px 80px …` | `shadow-xl` |
| `0 0 0 1px rgba(0,0,0,0.08)`, `inset 0 0 0 1px …` | use `ring-1 ring-ul-border` instead |
| `0 0 0 0 rgba(34,197,94,0.6)` etc. | These are keyframe shadows; live in `pui-ring-resolve` / `pui-dealt-added-flash` keyframes. Keep in CSS, not Tailwind. |

**No additions.** Tighten in the port: 22 shadows → 5 tokens.

---

## 5. Spacing

Spacing in mockups is on the Tailwind 4px grid except for a few one-offs (`6px`,
`14px`, `22px`). The current Tailwind scale already includes `1.5` (6px),
`3.5` (14px), and `5.5` (22px) as defaults — and the desktop config doesn't
override them. **No changes needed.**

---

## 6. Heights

`28px` (×12) → already declared as `--ul-h-toolbar` in `globals.css`. Expose
to Tailwind as `h-toolbar`. `64px` is already `h-nav`. Everything else
(`32`, `36`, `40`, `48`, `56`) is on the 4px grid.

**Net addition to `theme.height`:**

```ts
'toolbar': '28px',
```

---

## 7. Motion

`premium.css` defines 18 named keyframes (`pui-halo`, `pui-shimmer`,
`pui-breathe`, `pui-pop`, `pui-toolpop`, `pui-spin`, `pui-cursor`,
`pui-pulse`, `pui-fade-in`, `pui-fade-up`, `pui-msg-rise`, `pui-typing`,
`pui-credit-rise`, `pui-orbit`, `pui-spark-pulse`, `pui-dot-arrive`,
`pui-caret`, `pui-ring-resolve`, `pui-dealt-added-flash`).

**Decision:** copy these into `globals.proposed.css` under the `ul-` prefix
(matching the existing `ul-orbit-spin`, `ul-fade-in`, etc. already in
`globals.css`). Drop the `pui-` prefix entirely. Add `theme.animation` entries
for the most-used ones so they're consumable as `animate-…` utilities.

| Animation | Used by |
|---|---|
| `ul-msg-rise` | new message bubble entry |
| `ul-toolpop` | tool call card appear |
| `ul-fade-up` | inline widget mount |
| `ul-pulse` | running status dot |
| `ul-typing` | typing indicator dots |
| `ul-credit-rise` | credit-applied flash overlay |
| `ul-ring-resolve` | tool call resolved success ring |
| `ul-dealt-added-flash` | new card added to deck |

The rest stay as CSS-only keyframes.

---

## 8. Things NOT in scope for Phase 1

- Dark mode. None of the mockups are dark-themed. If the user wants dark mode,
  spec it separately.
- A11y contrast audit on the new tokens (specifically `#7c3aed` and `#c96442`
  on white — both should pass 4.5:1 for body text, but the porting agent
  should re-check with axe in PR 1).
- Replacing the existing `globals.css` button helper classes
  (`.btn`/`.btn-primary`/etc). Phase 2 components keep using them.

---

## Net token additions, in one place

```ts
// colors
violet:           '#7c3aed',
'violet-soft':    'rgba(124,58,237,0.10)',
copper:           '#c96442',
'copper-hover':   '#b5563a',
'copper-soft':    'rgba(201,100,66,0.12)',
'success-strong': '#15803d',
'success-hover':  '#16a34a',
completed:        '#60a5fa',
'warm-paper':     '#f6f6f4',
'warm-ink':       '#29261b',
'warm-ink-muted': 'rgba(41,38,27,0.55)',
info:             '#3b82f6',
'info-soft':      'rgba(59,130,246,0.10)',
'deep-green':     '#004225',
wine:             '#722F37',
'bg-sidebar':     '#f9fafb',

// fontSize
nano:  ['10px', { lineHeight: '1.3', fontWeight: '500', letterSpacing: '0.04em' }],
micro: ['11px', { lineHeight: '1.4', fontWeight: '500', letterSpacing: '0.02em' }],

// borderRadius
xs:   '4px',
pill: '10px',
card: '14px',

// height
toolbar: '28px',

// animation (12 entries, see globals.proposed.css for keyframes)
'msg-rise':         'ul-msg-rise 220ms cubic-bezier(0.4,0,0.2,1)',
'toolpop':          'ul-toolpop 240ms cubic-bezier(0.4,0,0.2,1)',
'fade-up':          'ul-fade-up 260ms cubic-bezier(0.4,0,0.2,1)',
'pulse-slow':       'ul-pulse 1.4s ease-in-out infinite',
'typing':           'ul-typing 1.2s infinite',
'credit-rise':      'ul-credit-rise 1.4s ease forwards',
'ring-resolve':     'ul-ring-resolve 700ms ease',
'dealt-added':      'ul-dealt-added-flash 700ms ease',
```

That is the entire diff. 11 new color tokens, 2 fontSize entries, 3 radii, 1
height, 8 animations. Everything else folds onto what `tailwind.config.ts`
already has.
