# Mockup → Tailwind cheat sheet

For every value the mockup `.jsx` files inline, here is the Tailwind class
to use in the production port. **Use this table mechanically.** If a value
isn't here, flag it in the PR — don't invent.

Assumes `tailwind.config.proposed.ts` is already merged.

---

## Colors → Tailwind

### Backgrounds

| Mockup | Class |
|---|---|
| `background: '#fff'` | `bg-ul-bg` (or omit — it's the default body) |
| `background: '#fafafa'` | `bg-ul-bg-raised` |
| `background: '#f9fafb'` | `bg-ul-bg-sidebar` |
| `background: 'rgba(0,0,0,0.02)'` | `bg-ul-bg-subtle` |
| `background: 'rgba(0,0,0,0.04)'` | `bg-ul-bg-hover` |
| `background: 'rgba(0,0,0,0.06)'` | `bg-ul-bg-active` (or `bg-ul-accent-soft`) |
| `background: '#0a0a0a'` | `bg-ul-accent` (or `bg-ul-text`) |
| `background: '#22c55e'` | `bg-ul-success` |
| `background: 'rgba(34,197,94,0.1)'` | `bg-ul-success-soft` |
| `background: '#ef4444'` | `bg-ul-error` |
| `background: 'rgba(239,68,68,0.08)'` | `bg-ul-error-soft` |
| `background: '#3b82f6'` | `bg-ul-info` |
| `background: 'rgba(59,130,246,0.10)'` | `bg-ul-info-soft` |
| `background: '#7c3aed'` | `bg-ul-violet` |
| `background: 'rgba(124,58,237,0.10)'` | `bg-ul-violet-soft` |
| `background: '#c96442'` | `bg-ul-copper` |
| `background: '#b5563a'` | `bg-ul-copper-hover` |
| `background: 'rgba(201,100,66,0.12)'` | `bg-ul-copper-soft` |
| `background: '#f6f6f4'` | `bg-ul-warm-paper` |
| `background: '#29261b'` | `bg-ul-warm-ink` |
| `background: '#004225'` | `bg-ul-deep-green` |
| `background: '#722F37'` | `bg-ul-wine` |
| Hover state `:hover { background: '#fafafa' }` | `hover:bg-ul-bg-raised` |
| Hover state `:hover { background: 'rgba(0,0,0,0.04)' }` | `hover:bg-ul-bg-hover` |

### Text

| Mockup | Class |
|---|---|
| `color: '#0a0a0a'` / `color: '#000'` / `color: '#1f1f1f'` | `text-ul-text` |
| `color: '#555'` / `color: '#777'` | `text-ul-text-secondary` |
| `color: '#999'` / `#a1a1a1` / `#9a9a9a` / `#888` / `#bbb` | `text-ul-text-muted` |
| `color: '#fff'` | `text-white` |
| `color: '#15803d'` | `text-ul-success-strong` |
| `color: '#22c55e'` | `text-ul-success` |
| `color: '#ef4444'` / `#dc2626` / `#b91c1c` | `text-ul-error` |
| `color: '#3b82f6'` | `text-ul-info` |
| `color: '#7c3aed'` / `#8b5cf6` / `#7e22ce` | `text-ul-violet` |
| `color: '#c96442'` | `text-ul-copper` |
| `color: '#29261b'` | `text-ul-warm-ink` |
| `color: 'rgba(41,38,27,0.55)'` | `text-ul-warm-ink-muted` |

### Borders

| Mockup | Class |
|---|---|
| `border: '1px solid rgba(0,0,0,0.08)'` | `border border-ul-border` |
| `border: '1px solid rgba(0,0,0,0.06)'` | `border border-ul-accent-soft` |
| `border: '1px solid rgba(0,0,0,0.15)'` | `border border-ul-border-strong` |
| `borderBottom: '1px solid rgba(0,0,0,0.08)'` | `border-b border-ul-border` |
| `border: '2px solid #fff'` (avatar stack) | `border-2 border-white` |
| `boxShadow: '0 0 0 1px rgba(0,0,0,0.08)'` | `ring-1 ring-ul-border` |

### Brand-icon colors (DO NOT TOKENIZE)

Only allowed inline on a brand icon's `path fill=` or as `bg-[#hex]` on a
brand chip. Never on body text or container chrome.

| Hex | Brand |
|---|---|
| `#4285f4` `#ea4335` `#1a73e8` | Google |
| `#611f69` | Slack |
| `#635bff` | Stripe |
| `#3ecf8e` | Supabase |
| `#34c759` | iOS system green |
| `#d97757` | Anthropic |

---

## Font size → Tailwind

| Mockup `fontSize:` | Class | When |
|---|---|---|
| `48` | `text-display` | hero numerals (e.g. balance "✦ 2,500") |
| `32` | `text-h1` | screen titles |
| `28` `26` `24` | `text-h2` | section headers; collapse the 2px jitter |
| `22` | `text-h2` | same as above; flag if hierarchy needs strict 22 |
| `20` `18` | `text-h3` | sub-section titles |
| `16` | `text-body-lg` | emphasized body |
| `14` `15` | `text-body` | default body |
| `13` | `text-small` | dense UI labels, button text |
| `12` | `text-caption` | metadata, badge text |
| `11` | `text-micro` | mono badges (version, call counts), table column data |
| `10` | `text-nano` | uppercase eyebrow labels, table headers, category tags |
| `9` | `text-[9px]` | avatar count overlays only — arbitrary OK here |
| `8` | `text-[8px]` | flag in PR — almost certainly should be 9 or 10 |

## Font weight → Tailwind

`400` → `font-normal` · `500` → `font-medium` · `600` → `font-semibold` · `700` → `font-bold`.

## Letter spacing

| Mockup | Class |
|---|---|
| `letterSpacing: '-0.03em'` | `tracking-tight` *(close enough; built into `text-display`)* |
| `letterSpacing: '-0.02em'` | built into `text-h1` |
| `letterSpacing: '-0.015em'` | built into `text-h2` |
| `letterSpacing: '0.04em'` | `tracking-wide` *(close enough; or built into `text-nano`)* |
| `letterSpacing: '0.05em'` | `tracking-wider` |

Prefer the type-scale defaults; only override when adjacent text uses the
*same* size but different tracking.

## Font family

| Mockup | Class |
|---|---|
| `fontFamily: 'var(--ul-font-mono)'` / `'JetBrains Mono, monospace'` | `font-mono` |
| `fontFamily: 'var(--ul-font-sans)'` / `'Inter, …'` / `'inherit'` | `font-sans` (or omit — it's the default) |

---

## Border radius → Tailwind

| Mockup `borderRadius:` | Class |
|---|---|
| `2` | `rounded-[2px]` *(rare; flag if frequent)* |
| `4` | `rounded-xs` |
| `6` | `rounded-sm` |
| `8` | `rounded-md` |
| `10` | `rounded-pill` |
| `12` | `rounded-lg` |
| `14` | `rounded-card` |
| `16` | `rounded-xl` |
| `9999` / `999` | `rounded-full` |
| `22` on a 22px element | `rounded-full` (radius = side / 2) |

---

## Shadow → Tailwind

| Mockup `boxShadow:` | Class |
|---|---|
| `0 1px 2px rgba(0,0,0,0.05)` | `shadow-sm` |
| `0 4px 12px rgba(0,0,0,0.08)`, `0 6px 18px rgba(0,0,0,0.06)`, `0 10px 28px rgba(0,0,0,0.08)`, `0 8px 24px rgba(0,0,0,0.06)` | `shadow-md` |
| `0 8px 30px rgba(0,0,0,0.10)`, `0 1px 0 …, 0 8px 30px …` composites | `shadow-lg` |
| `0 12px 32px …, 0 16px 50px …, 0 20px 60px …, 0 24px 80px …` | `shadow-xl` |
| `0 0 0 3px rgba(0,0,0,0.06)` (focus halo) | `shadow-glow` |
| `0 0 0 1px rgba(0,0,0,0.08)` (hairline) | `ring-1 ring-ul-border` (NOT a shadow) |
| `inset 0 0 0 1px …` | `ring-1 ring-inset ring-ul-border` |
| Keyframed shadows (`0 0 0 0 rgba(34,197,94,0.6)` etc.) | Reach for `animate-ring-resolve` / `animate-dealt-added` instead. |

---

## Spacing → Tailwind

Tailwind defaults already cover everything the mockups use:

| px | Class | px | Class |
|---|---|---|---|
| 2 | `2px / p-0.5` | 16 | `p-4` |
| 4 | `p-1` | 18 | `p-[18px]` |
| 6 | `p-1.5` | 20 | `p-5` |
| 8 | `p-2` | 22 | `p-5.5` |
| 10 | `p-2.5` | 24 | `p-6` |
| 12 | `p-3` | 32 | `p-8` |
| 14 | `p-3.5` | 40 | `p-10` |

For odd directional padding like `padding: '6px 14px'`, use `px-3.5 py-1.5`.

---

## Size → Tailwind

For square elements (glyphs, dots, avatars) use `size-N`:

| Mockup | Class |
|---|---|
| `width: 8, height: 8` | `size-2` |
| `width: 12, height: 12` | `size-3` |
| `width: 22, height: 22` | `size-5.5` |
| `width: 32, height: 32` | `size-8` |
| `width: 36, height: 36` | `size-9` |
| `width: 40, height: 40` | `size-10` |
| `width: 56, height: 56` | `size-14` |

For the toolbar height (28px): `h-toolbar`.
For top nav height (64px): `h-nav`.

---

## Animation → Tailwind

| Mockup `animation:` (under `pui-*`) | Class |
|---|---|
| `pui-msg-rise 220ms …` | `animate-msg-rise` |
| `pui-toolpop 240ms …` | `animate-toolpop` |
| `pui-pop 240ms …` | `animate-pop` |
| `pui-fade-up 260ms …` | `animate-fade-up` |
| `pui-fade-in 200ms …` | `animate-fade-in` |
| `pui-pulse 1.4s …` | `animate-pulse-slow` |
| `pui-typing 1.2s …` | `animate-typing` |
| `pui-credit-rise 1.4s …` | `animate-credit-rise` |
| `pui-ring-resolve 700ms ease` | `animate-ring-resolve` |
| `pui-dealt-added-flash 700ms ease` | `animate-dealt-added` |
| `pui-shimmer 1.6s linear infinite` | `animate-shimmer` |
| `pui-breathe 3s ease-in-out infinite` | `animate-breathe` |

For one-off keyframes not in the table (e.g. `pui-orbit`, `pui-spark-pulse`,
`pui-halo`, `pui-cursor`), use the raw class `[animation:ul-orbit_8s_linear_infinite]`
or, if used by more than one component, add it to `theme.animation` and
follow up.

---

## Two transitions

Replace inline `transition: 'all 200ms cubic-bezier(0.4,0,0.2,1)'` etc. with:

| Mockup | Class |
|---|---|
| `transition: 'all 120ms …'` | `transition duration-fast` |
| `transition: 'all 200ms …'` | `transition duration-base` |
| `transition: 'all 300ms …'` | `transition duration-slow` |

For property-specific: `transition-colors duration-base`,
`transition-shadow duration-base`, `transition-transform duration-fast`.

---

## A few specific patterns from the mockups

### Tool glyph (square colored badge with mono initials)

Mockup:
```jsx
<div style={{ width: 36, height: 36, borderRadius: 10, background: tone,
  color: '#fff', display:'flex', alignItems:'center', justifyContent:'center',
  fontFamily: 'var(--ul-font-mono)', fontWeight: 600, fontSize: 13 }}>
  {glyph}
</div>
```

Port:
```tsx
<div
  className="flex size-9 items-center justify-center rounded-pill text-small font-semibold font-mono text-white"
  style={{ background: tone }}
>
  {glyph}
</div>
```

The `tone` stays inline — it's per-app data, not a token.

### Running status pulse dot

Mockup:
```jsx
<span style={{ position:'absolute', right: -2, bottom: -2, width: 12, height: 12,
  borderRadius: 9999, background: '#22c55e', border: '2px solid #fff',
  animation: 'pui-pulse 1.4s ease-in-out infinite' }}/>
```

Port:
```tsx
<span className="absolute -right-0.5 -bottom-0.5 size-3 rounded-full bg-ul-success border-2 border-white animate-pulse-slow" />
```

### Mono badge (version / count chip)

Mockup:
```jsx
<span style={{ fontSize: 10, color: '#999', padding: '1px 6px',
  border: '1px solid rgba(0,0,0,0.08)', borderRadius: 4,
  fontFamily: 'var(--ul-font-mono)' }}>
  v1.0.45
</span>
```

Port:
```tsx
<span className="px-1.5 py-px text-nano font-mono text-ul-text-muted border border-ul-border rounded-xs">
  v1.0.45
</span>
```

### Library row (hover lift)

Mockup pairs `onMouseEnter` + `onMouseLeave` setting `boxShadow` and
`transform`. Port to:

```tsx
<div className="rounded-pill border border-ul-border bg-ul-bg p-4 cursor-pointer transition duration-base hover:-translate-y-px hover:shadow-md">
  …
</div>
```
