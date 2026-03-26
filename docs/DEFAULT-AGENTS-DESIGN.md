# Default Agents Design

## Overview

Six default agents ship with the Ultralight desktop app, turning it into a self-serve platform that can use itself most effectively. These agents cover functionality best served by agentic chat rather than by UI, API, or CLI.

**Design Principle:** Five defaults + infinite spawnable. The Agent Builder can create any specialized agent on demand. Default agents earn their slot by being high-frequency and solving a discovery problem (users wouldn't know to ask for them if they didn't exist).

---

## The Six Default Agents

| # | Agent | One-liner | Launch Mode |
|---|-------|-----------|-------------|
| 1 | **MCP Builder** | Build, test, deploy, publish apps | `discuss_first` |
| 2 | **Widget Designer** | Design widgets + in-chat UI components | `discuss_first` |
| 3 | **Agent Builder** | Interview → configure → spawn agents | `discuss_first` |
| 4 | **Debugger / Tester** | Connect an app, diagnose, trace, fix | `discuss_first` |
| 5 | **Platform Guide** | Docs, settings, account, how-to | `discuss_first` |
| 6 | **App Store** | Discover, evaluate, recommend, install recipes | `discuss_first` |

---

## 1. MCP Builder Agent

**Connected Platform Tools:** `ul.download`, `ul.test`, `ul.upload`, `ul.set`, `ul.discover`, `ul.marketplace`

**Directive:** Full app lifecycle — scaffold, implement, test, fix, deploy, publish. Enforces a build loop: scaffold → implement → test → fix → deploy.

**Key Conventions:**
- Always include proper error handling
- Generate JSON Schema for all parameters
- Use `ul.test` before every `ul.upload`
- Publisher functionality folded in — handles versioning, descriptions, pricing, permissions review, marketplace listing

**What makes it great:**
- Pre-loaded per-function conventions enforce quality
- Discuss-first to clarify requirements before coding
- Handles the full lifecycle including marketplace publishing (no separate publisher agent needed)

**Platform gaps to fill:**
- `ul.diff` — compare versions before deploying
- `ul.rollback` — guided revert to previous version
- Template library access — browse/fork existing apps as starting points (distinct from `ul.discover`)
- Schema validation tool — validate function signatures, widget declarations, manifest before upload

---

## 2. Widget Designer Agent

**Connected Platform Tools:** `ul.download`, `ul.upload`, `ul.test`, `ul.discover`, `ul.preview`

**Directive:** Design and build widgets for both dashboard display and in-chat rendering. Enforce widget response shape compliance and visual consistency.

**Key Conventions:**
- Always enforce widget response shape: `meta.title`, `meta.icon`, `meta.badge_count`, `app_html`, `version`
- Admin notes should include the `ulAction()` bridge API reference
- Build → preview → iterate loop
- Design for both dashboard and in-chat contexts

**In-Chat Widgets (Platform Capability):**
- Widgets are not just dashboard decorations — they are the agent's rich output format
- Any agent with a connected app can spawn that app's widget inline in conversation
- Hybrid approach: iframe-based widget UI templates as the standard rendering method, with structured cards as lightweight alternatives
- `ul.preview` serves dual purpose: builder agents use it to preview designs, operational agents use it to show users interactive views

**What makes it great:**
- Closes the feedback loop — agent can see what it built via `ul.preview`
- Understands both dashboard and in-chat widget contexts
- Enforces the `ulAction()` bridge pattern for widget-to-MCP communication

**Platform gaps to fill:**
- `ul.preview` — render widget in isolated frame, return screenshot/snapshot; also render in-chat
- Widget template library — prebuilt patterns (table view, form, dashboard card, inbox, chart) that can be forked
- Design token system / `ul.style` — shared color palette, typography, spacing for visual cohesion across widgets

---

## 3. Agent Builder Agent

**Connected Platform Tools:** `ul.discover`, `ul.agent.*` (CRUD + spawn)

**Directive:** Interview the user about what they need, then assemble the right agent configuration. Primary convention is deep discussion before building.

**Key Conventions:**
- Always interview first — understand the use case before configuring
- Recommend appropriate model, permission level, and connected apps
- Guide users through template selection from `.ultralight/agents/*.md`
- Test spawned agents to verify they work as intended

**What makes it great:**
- The most "meta" agent — its job is to understand what the user needs and build the right agent for it
- Has access to agent templates for quick-start patterns
- Can spawn and test agents it creates

**Platform gaps to fill (HIGHEST PRIORITY):**
- `ul.agent.create` / `ul.agent.update` / `ul.agent.list` — agent CRUD as platform tools (currently Tauri-side only)
- `ul.agent.spawn` — launch a configured agent and return its conversation ID
- `ul.agent.templates` — list/read available agent templates
- Without these, Agent Builder is advisory only — it can recommend but not act

---

## 4. Debugger / Tester Agent

**Connected Platform Tools:** `ul.test`, `ul.logs`

**Directive:** Investigative — when a user reports a problem, check logs first, reproduce with `ul.test`, identify root cause, suggest fix.

**Key Conventions:**
- Always check health events first, then filter recent calls for the reported function
- If no apps are connected, ask the user which app they need help with and guide them to connect it
- `permission_level: "preview_only"` — diagnoses but doesn't auto-fix

**Scoping:** Better to manually connect the app(s) you want debugged each session rather than connecting everything. Avoids context bloat from 200+ function signatures. The directive handles the empty state gracefully.

**What makes it great:**
- Right there when users are frustrated — no need to think about spawning a debug agent
- Investigative workflow: logs → reproduce → root cause → fix suggestion
- Scoped per session to stay focused

**Platform gaps to fill:**
- `ul.trace` — detailed execution trace for a specific call (input → each step → output → timing)
- `ul.test` with assertions — define expected outputs and check pass/fail
- `ul.health.dashboard` — aggregate error rates, latency, call volumes across all apps
- `ul.replay` — re-execute a logged call with the same inputs to reproduce issues

---

## 5. Platform Guide Agent

**Connected Platform Tools:** `ul.discover`, `ul.docs`, `ul.settings`, `ul.account`, `ul.memory`

**Directive:** Help users understand the platform. Answer by showing real examples from their library or the marketplace. Guide, don't build.

**Key Conventions:**
- Use `ul.memory` to remember what the user has learned, struggled with, and built
- `launch_mode: "discuss_first"` always
- Platform tools schema baked into system prompt via admin notes

**Scope includes:**
- Guides for using all six system agents
- What the platform is capable of, what it's ideally used for
- What is free and what is not (pricing, tiers)
- User settings: API keys, payment methods, transaction history
- Hosting storage, usage storage, quotas
- Docs delivered via markdown files connected to the agent

**What makes it great:**
- Entry point for new users who don't know what to ask the Agent Builder to build
- Persistent memory of user's learning journey
- Direct access to account/settings management alongside guidance

**Platform gaps to fill:**
- `ul.docs` — structured access to platform documentation
- `ul.examples` — curated reference implementations tagged by pattern
- `ul.settings` — read/write user settings (API keys, payment, storage quotas)
- `ul.account` — transaction history, usage stats, billing

---

## 6. App Store Agent

**Connected Platform Tools:** `ul.discover` (appstore scope), `ul.rate`, `ul.marketplace`, `ul.call`

**Directive:** Discover, evaluate, recommend, and install app recipes. Deep discussion first to understand what the user needs, then investigate marketplace tools to find the exact combination / recipe.

**Key Conventions:**
- Always interview the user about their use case before searching
- Evaluate multiple apps, compare capabilities, compose a stack
- Like apps to add to user's library
- Recommend "recipes" — bundles of apps + configuration that solve a use case together
- Inspired by Cloudflare codemode pattern — investigative, compositional

**What makes it great:**
- Highest-value default for new users — they open the app, don't know what to build, and this agent assembles the right stack
- Different from Platform Guide: this is investigative and compositional, not Q&A
- Benefits from long, exploratory conversations

**Platform gaps to fill:**
- `ul.recipe` — a higher-level construct: a named bundle of apps + agent config + widget layout that can be installed as a unit
- Recipe sharing — users can share composed recipes with others

---

## Platform Gaps Priority Summary

| Priority | Gap | Benefits | Effort |
|----------|-----|----------|--------|
| **P0** | `ul.agent.*` (CRUD + spawn) | Unlocks Agent Builder entirely | High |
| **P0** | In-chat widgets (rendering primitive) | Rich agent output, unlocks Widget Designer value | High |
| **P1** | `ul.docs` / `ul.examples` | Makes Platform Guide actually useful | Medium |
| **P1** | `ul.preview` (widget render + in-chat) | Closes Widget Designer feedback loop | Medium |
| **P1** | `ul.settings` / `ul.account` | Platform Guide can manage user settings | Medium |
| **P2** | `ul.trace` / `ul.replay` | Makes Debugger production-grade | Medium |
| **P2** | `ul.recipe` | App Store can compose and share bundles | Medium |
| **P3** | `ul.diff` / `ul.rollback` | Safety net for MCP Builder | Low |
| **P3** | Design token system | Widget visual consistency | Low |
| **P3** | Widget template library | Faster widget development | Low |

---

## Architecture Notes

### What earns a default slot
1. **High frequency** — used by nearly every user, regularly
2. **Discovery** — users wouldn't know to ask for it if it didn't exist

### What gets spawned on demand
- Workflow / orchestration agents
- Data explorer agents
- Domain-specific agents (email, budget, etc.)
- Any specialized tool created by Agent Builder

### Avoided anti-pattern
Agents that just wrap a single API call or CRUD operation — those are better as buttons. Default agents handle tasks that are multi-step, require judgment, or benefit from back-and-forth clarification.
