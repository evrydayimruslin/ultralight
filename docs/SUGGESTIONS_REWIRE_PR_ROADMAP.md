# Suggestions Rewire PR Roadmap

This roadmap turns the `/suggestions-rewire` handoff into an implementation plan for the Command-native chat path. It assumes the current N-series work is present in the working tree: structured turn artifacts, interface-as-reply, Command sessions, generation cancel, and the descriptor cache in `command-interface-reply.ts`.

## Product Target

Suggestions becomes the system surface.

- One canonical chat engine remains `orchestrate()`.
- Tool Maker, Tool Dealer, and Platform Guide become suggestible platform primitives, not separate chat destinations.
- One `ambient_suggestions` set can carry platform primitives, installed-library actions, marketplace apps, and prompt suggestions.
- Accepting a suggestion routes by typed target:
  - `app`: install/add to library and rebuild the function index.
  - `system_agent`: run in the same conversation.
  - `function`: enter the existing plan-gate.
  - `prompt`: prefill or send through the current composer.
- The new Command UI is a bottom-right Suggestions circle with a grouped text popup and preview detail.
- Pinned or left-margin widgets from older mockups are out of scope for this rewire.

## Non-Goals

- No new chat engine.
- No new SSE event type.
- No new system-agent session table.
- No second confirmation path.
- No destructive migration.
- No model-authored UI for preview panels.

## Current Bottlenecks

1. `ambient_suggestions` is typed as marketplace app suggestions only.
2. `system_agent_spawn` is still a separate event path.
3. CommandHomescreen does not currently consume `ambient_suggestions` from `streamOrchestrate()`.
4. `recordCapabilitySuggestionEvent()` accepts and installs apps, but has no typed target routing.
5. `validateCapabilitySuggestionEventRequest()` requires `app_id` for accepted suggestions by default.
6. `DiscoverWidget` is search/install oriented, while the new design needs a sparse grouped text list with preview.
7. The N-4 descriptor cache exists, but is currently embedded in `command-interface-reply.ts` and only stores interface specs.

## Core Data Model

Add a shared suggestion contract in `shared/contracts/suggestions.ts`.

```ts
export type SuggestionSource =
  | "platform_primitive"
  | "library"
  | "marketplace";

export type SuggestionTarget =
  | {
      kind: "system_agent";
      agentType: "tool_builder" | "tool_marketer" | "platform_manager";
      task: string;
      originalPrompt?: string;
    }
  | {
      kind: "function";
      appId: string;
      appSlug?: string;
      fnName: string;
      args?: Record<string, unknown>;
      label?: string;
    }
  | {
      kind: "app";
      appId: string;
      appSlug?: string;
    }
  | {
      kind: "prompt";
      text: string;
    };
```

The persisted discriminator lives at `capability_suggestions.metadata.target`. `app_id` remains nullable for non-app suggestions. The first implementation should not add a migration; an additive `target_kind` generated column or index can follow if analytics needs query speed.

## PR N-5 - Shared Suggestion Contract And Compatibility Types

Goal: make suggestions a typed cross-package concept before changing behavior.

Files to add:

- `shared/contracts/suggestions.ts`
  - Define `SuggestionSource`, `SuggestionTarget`, `CommandSuggestion`, `SuggestionPreviewDescriptor`, `SuggestionAcceptResult`.
  - Add type guards: `isSuggestionTarget`, `isSuggestionSource`, `isCommandSuggestion`.
  - Add helpers:
    - `suggestionTargetKind(target)`.
    - `suggestionSourceGroupLabel(source)`.
    - `suggestionDefaultMeta(suggestion)`.

Files to update:

- `desktop/src/types/ambientSuggestion.ts`
  - Replace the marketplace-only shape with a client extension of `CommandSuggestion`.
  - Preserve trust-card and marketplace summary fields.
  - Keep backwards-compatible aliases for current marketplace app rows during rollout: `id`, `slug`, `name`, `description`, `connected`.

- `desktop/src/lib/api.ts`
  - Update `OrchestrateEvent.suggestions` to use the shared `CommandSuggestion` compatible client type.
  - Add API functions but leave them unused until later PRs:
    - `fetchSuggestionPreview(suggestionId)`.
    - `fetchSuggestionPreviewBatch(suggestionSetId)`.
    - `acceptSuggestion(suggestionId, payload)`.

- `api/services/capability-suggestion-validation.ts`
  - Allow accepted events without `app_id` when `install_on_accept === false` or when `metadata.target.kind !== "app"`.
  - Validate `metadata.target` if provided.
  - Keep the current app accept validation for legacy marketplace accepts.

- `api/services/capability-suggestion-validation.test.ts`
  - Add accepted system-agent, function, and prompt payload cases.
  - Keep the current "accepted app requires app_id" test.

Acceptance:

- Typecheck passes on API and desktop.
- Existing marketplace ambient suggestions still compile.
- No runtime behavior changes yet.

## PR N-6 - Server-Side Mixed Suggestion Assembly

Goal: add one backend assembler that can build typed suggestion rows from platform delegations and marketplace candidates.

Files to add:

- `api/services/command-suggestions.ts`
  - Own all conversion to `CommandSuggestion`.
  - Suggested functions:
    - `systemAgentDelegationToSuggestionSeed(delegation, rankBase)`.
    - `marketplaceCandidateToSuggestionSeed(candidate, rankBase)`.
    - `recordCommandSuggestionSet(input)`.
    - `serializeCommandSuggestion(seed, telemetryRecord)`.
    - `extractSuggestionTarget(metadata)`.
  - Rank order:
    1. platform primitive
    2. library
    3. marketplace
    4. prompt
  - Persist with `recordCapabilitySuggestionSet()`.
  - Store `metadata.target` on every row.
  - Store `metadata.display` with label, description, meta text, and grouping hints.

Files to update:

- `api/services/flash-broker.ts`
  - Stop treating marketplace candidates as the final ambient event.
  - Keep marketplace retrieval where it is, because Flash still benefits from candidate context.
  - Add marketplace suggestion seeds to `FlashBrokerResult`, or expose enough candidate data for `orchestrator.ts` to assemble the set.
  - Keep capability-gap shortcoming logic.
  - Keep no-match and weak-match metadata available to the assembler.

- `api/services/orchestrator.ts`
  - Import the new assembler.
  - Convert `brokerResult.systemAgentDelegations` to platform suggestion seeds.
  - Convert marketplace candidates/seeds to marketplace suggestion seeds.
  - Initially emit unified `ambient_suggestions` after the broker result is known.
  - Keep `system_agent_spawn` as a legacy fallback until accept routing lands, but do not auto-run Tool Dealer discovery for new Command-native suggestions.

- `api/services/capability-suggestion-telemetry.ts`
  - Type `CapabilitySuggestionCandidateInput.suggestionSource` as the shared source union where practical.
  - Do not require `appId`.
  - Preserve `appId` install behavior for app targets.

- `api/services/capability-suggestion-telemetry.test.ts`
  - Add a non-app suggestion row test:
    - `suggestion_source: "platform_primitive"`.
    - `app_id: null`.
    - `metadata.target.kind: "system_agent"`.

Acceptance:

- A prompt that triggers Tool Dealer produces a platform suggestion row instead of relying only on `system_agent_spawn`.
- Marketplace suggestions still persist and display as before.
- No new SSE event type exists.
- Empty suggestion sets remain valid.

## PR N-7 - Fold Command Next-Steps Into Suggestions

Goal: make the N-1 next-step artifact feed the same Suggestions surface.

Files to update:

- `api/services/command-next-steps.ts`
  - Export conversion helpers:
    - `nextStepToSuggestionSeed(step, brokerResult)`.
    - `actionNextStepToFunctionTarget(step)`.
    - `promptNextStepToPromptTarget(step)`.
  - Tool-backed steps become:
    - `suggestion_source: "library"`.
    - `metadata.target.kind: "function"`.
    - `metadata.target.appId`, `appSlug`, `fnName`, `args`.
  - Prompt steps become:
    - `suggestion_source: "library"` or `platform_primitive` only if platform-owned.
    - `metadata.target.kind: "prompt"`.

- `shared/contracts/command-turn.ts`
  - Add optional linkage fields to `NextStep`:
    - `suggestion_id?: string`.
    - `suggestion_set_id?: string`.
  - Keep inline next-step artifacts working for compatibility.

- `api/services/orchestrator.ts`
  - Move the final `ambient_suggestions` emission to after `proposeNextStepsSafely()`.
  - Merge seeds from:
    - system-agent delegations.
    - next-step actions/prompts.
    - marketplace candidates.
  - Persist one set per turn and then emit one `ambient_suggestions` event.
  - Continue to emit `next_steps` as an inline artifact during transition, with linked suggestion ids when possible.

- `desktop/src/components/CommandHomescreen.tsx`
  - Add a `case "ambient_suggestions"` in the Command stream loop.
  - Dispatch suggestions through `dispatchAmbientSuggestions()` or a Command-local equivalent.

- `desktop/src/components/ChatView.tsx`
  - Confirm standard chat still dispatches typed suggestions.
  - Do not remove existing inline next-step click behavior yet.

Tests:

- `api/services/command-next-steps.test.ts`
  - Assert action next-step converts to a function target.
  - Assert prompt next-step converts to a prompt target.

- Add `api/services/command-suggestions.test.ts`
  - Assert mixed ordering: platform, library, marketplace.
  - Assert one set preserves stable ids and targets.

Acceptance:

- One emitted suggestion set can include Tool Dealer plus a verified function next-step plus marketplace apps.
- Inline next-step chips still render.
- CommandHomescreen receives ambient suggestions.

## PR N-8 - Suggestion Preview Descriptors

Goal: support click-to-preview without model-authored UI.

Files to add:

- `api/services/command-descriptor-cache.ts`
  - Extract and generalize the N-4 in-memory descriptor cache from `command-interface-reply.ts`.
  - Support namespaces:
    - `interface_reply`.
    - `suggestion_preview`.
  - Keep max-size eviction and pinned-after-hit behavior.

- `api/services/suggestion-preview.ts`
  - Build typed preview descriptors:
    - app descriptor: trust card, key functions, permissions, install state, marketplace metadata.
    - system-agent descriptor: product name, agent type, task, skills path, allowed surfaces.
    - function descriptor: signature, args, app name, cost estimate.
    - prompt descriptor: prompt text and effect.
  - Fetch persisted suggestion rows by `suggestion_id` and user id.
  - Fall back to client-sent target only in local/no-Supabase cases if safe.

- `api/services/system-agent-descriptors.ts`
  - Server-side definitions for Tool Maker, Tool Dealer, Platform Guide.
  - Keep names, persona summaries, skills path, and allowed touch surfaces in one backend place.
  - Avoid importing desktop-only `desktop/src/lib/systemAgents.ts`.

Files to update:

- `api/services/command-interface-reply.ts`
  - Use `command-descriptor-cache.ts` instead of its private `descriptorCache`.

- `api/handlers/chat.ts`
  - Add:
    - `GET /chat/suggestions/:suggestionId/preview`.
    - optional `POST /chat/suggestions/preview` for batch by ids or set id.

- `api/handlers/app.ts`
  - Route the preview endpoints.

- `desktop/src/lib/api.ts`
  - Implement preview fetchers.

Tests:

- `api/services/suggestion-preview.test.ts`
  - App descriptor includes functions/trust/cost.
  - System-agent descriptor includes skills and touch scope.
  - Function descriptor includes inferred args and function signature.
  - Cache hit returns same descriptor without rebuilding.

Acceptance:

- Selecting a row can fetch a preview descriptor for all target kinds.
- No HTML/JSX comes from the model.
- The descriptor cache is shared with the N-4 cache path.

## PR N-9 - Accept Routing And Same-Conversation Execution

Goal: make accepting a suggestion do the right thing without creating a new chat surface.

Implementation decision:

Keep telemetry and execution separate. `recordCapabilitySuggestionEvent()` should continue to record funnel events and perform the existing app install when asked, but the orchestration decision should live in a new acceptance service.

Files to add:

- `api/services/suggestion-acceptance.ts`
  - Resolve suggestion row and target.
  - Record the accepted event.
  - Return a typed `SuggestionAcceptResult`.
  - Result kinds:
    - `installed_app`.
    - `start_orchestrate`.
    - `inline_discover`.
    - `prefill_prompt`.
    - `noop`.
  - For `app`, call existing install path and rebuild function index.
  - For `system_agent`:
    - Tool Dealer can return `inline_discover` using the existing `{{discover:query}}` behavior.
    - Tool Maker and Platform Guide return `start_orchestrate` with `SystemAgentContext`.
  - For `function`, return `start_orchestrate` using the same verified-action prompt shape as current Command next-step clicks, so the normal `plan_ready` path is reused.
  - For `prompt`, return `prefill_prompt`.

Files to update:

- `api/services/capability-suggestion-telemetry.ts`
  - Add a lower-level install helper export or accept an option so `suggestion-acceptance.ts` can install app targets without double-recording.
  - Keep legacy `recordCapabilitySuggestionEvent({ eventType: "accepted", appId })` working.

- `api/handlers/chat.ts`
  - Add `POST /chat/suggestions/:suggestionId/accept`.
  - Authenticate, validate, call `acceptSuggestion()`, return `SuggestionAcceptResult`.

- `api/handlers/app.ts`
  - Route the accept endpoint.

- `desktop/src/lib/api.ts`
  - Add `acceptSuggestionById()`.

- `desktop/src/components/CommandHomescreen.tsx`
  - Add a `handleSuggestionAccept(result)` dispatcher:
    - `installed_app`: show completed state and refresh function/widget indexes.
    - `inline_discover`: append or stream a same-conversation assistant message containing `{{discover:...}}`.
    - `start_orchestrate`: call `runCommandTurn()` with system agent context support or an accepted-suggestion option.
    - `prefill_prompt`: set `commandDraft`.
  - Extend `runCommandTurn()` options to accept:
    - `systemAgentContext?: SystemAgentContext`.
    - `autoConfirmFirstPlan?: boolean`.
    - `acceptedSuggestionId?: string`.

- `desktop/src/components/ChatView.tsx`
  - Mirror accept result handling enough for standard chat compatibility.
  - Stop assuming accept only injects app scope.

Tests:

- `api/services/suggestion-acceptance.test.ts`
  - App target installs and rebuilds.
  - System-agent target returns same-conversation orchestration/discover result.
  - Function target returns a plan-gated orchestration request.
  - Prompt target returns prefill.

Acceptance:

- Accepting marketplace app still installs.
- Accepting Tool Dealer renders discover in the same conversation.
- Accepting a function suggestion produces a `plan_ready` card through the existing plan-gate.
- No new confirmation path exists.

## PR N-10 - Command Suggestions Surface

Goal: implement the new Command-native UI from `/suggestions-rewire`.

Files to add:

- `desktop/src/components/command/CommandSuggestionsSurface.tsx`
  - Bottom-right white circle button.
  - Grouped popup:
    - `platform`.
    - `library - installed`.
    - `marketplace`.
  - Text-only rows, no per-row icons.
  - Right meta text:
    - `one-click`.
    - tool/app name.
    - `install`.
  - Sparse empty state.
  - Master-detail preview region after row selection.

- `desktop/src/components/command/SuggestionPreviewPanel.tsx`
  - Render `SuggestionPreviewDescriptor`.
  - App/function/system-agent/prompt variants.
  - Actions:
    - Preview run where applicable.
    - Install.
    - Run.
    - Prefill.

- `desktop/src/hooks/useCommandSuggestions.ts`
  - Wrap `useAmbientSuggestions()` for Command.
  - Fetch preview lazily on selected row.
  - Track accept state per suggestion.

Files to update:

- `desktop/src/components/CommandHomescreen.tsx`
  - Mount `CommandSuggestionsSurface` in session view.
  - Place it bottom-right, aligned with future Home chrome.
  - Use `ambientHasNew` pulse state.
  - Wire preview and accept callbacks.

- `desktop/src/components/command/CommandComposer.tsx`
  - No major visual change; ensure prompt-prefill from suggestions works.

- `desktop/src/components/DiscoverWidget.tsx`
  - Keep for explicit `{{discover:...}}` widgets.
  - Do not stretch it into the new Suggestions UI.

- `desktop/src/components/composer/ToolSelectionPopover.tsx`
  - Rename copy from "Tool Dealer suggestions" to generic "Suggestions" only after Command surface is active.
  - Ensure it handles non-app suggestions gracefully or hides them in standard chat until standard chat surface catches up.

- `desktop/src/components/ChatInput.tsx`
  - Standard chat can keep the current tool-selection entry point as compatibility.

Acceptance:

- Command session has a bottom-right Suggestions circle.
- Popup groups mixed-source suggestions.
- Row click loads preview.
- Accept dispatches by target kind.
- No pixel-perfect pass required yet; layout should be functional and non-overlapping.

## PR N-11 - Collapse Separate System-Agent Chat Surface

Goal: make the one chat primitive explicit in the desktop navigation.

Files to update:

- `desktop/src/components/NavSidebar.tsx`
  - Hide or remove the sticky "Agents" section for canonical system agents.
  - Keep non-canonical historical system-agent sessions in Chats only if they exist.
  - Keep search from breaking on older system-agent records.

- `desktop/src/lib/systemAgents.ts`
  - Keep the definitions as local UI/config support.
  - Do not delete `SYSTEM_AGENTS`; they still describe names, personas, and starters.
  - Consider exporting a "suggestible" descriptor mapping for desktop labels only.

- `desktop/src/components/ChatView.tsx`
  - Keep legacy system-agent handling as a fallback for old conversations.
  - Remove proactive "pick system agent" paths from new empty states where they conflict with Suggestions.

- `desktop/src/components/MessageList.tsx`
  - If starter prompts still include system-agent cards, route them into Command/Suggestions rather than opening a dedicated agent chat.

- `api/services/orchestrator.ts`
  - Stop emitting `system_agent_spawn` for new Command-native paths once accept routing is live.
  - Keep parsing/telemetry for legacy clients until safe to remove.

Acceptance:

- New users see Command plus Suggestions, not three separate system-agent chats.
- Existing users do not lose historical conversations.
- PR description states that system agents are delegation mechanisms inside `orchestrate()`.

## PR N-12 - Smoke Tests, Visual Pass, And Cleanup

Goal: prove the rewire works end to end and polish the Command surface.

Backend verification:

- `cd api && npm run typecheck`
- Targeted Deno tests:
  - `api/services/capability-suggestion-validation.test.ts`
  - `api/services/capability-suggestion-telemetry.test.ts`
  - `api/services/command-suggestions.test.ts`
  - `api/services/command-next-steps.test.ts`
  - `api/services/suggestion-preview.test.ts`
  - `api/services/suggestion-acceptance.test.ts`

Desktop verification:

- `cd desktop && npm run build`
- `cd desktop/src-tauri && cargo check`
- Manual Command smoke:
  - Ask for a capability with no installed tool.
  - Confirm Tool Dealer suggestion appears under platform.
  - Open preview.
  - Accept Tool Dealer.
  - Confirm discover renders in same conversation.
  - Install a marketplace app.
  - Confirm function index refreshes.
  - Ask for a follow-up action.
  - Confirm library suggestion appears.
  - Accept library suggestion.
  - Confirm existing plan-gate renders.

Visual pass:

- Compare against:
  - `suggestions-rewire/DESIGN.md`.
  - `suggestions-rewire/Ambient Widgets - Concepts.html`, section 3.
  - `suggestions-rewire/Command - C1 & C3.html`.
- Check desktop and narrow widths.
- Ensure text rows do not overflow.
- Ensure preview panel does not occlude composer controls.

Cleanup:

- Remove dead Tool Dealer-only copy in the composer popover.
- Remove old auto-spawn behavior where no longer used.
- Keep DiscoverWidget for explicit marketplace discovery.
- Keep legacy route compatibility until release confidence is high.

## File Impact Matrix

Shared contracts:

- `shared/contracts/suggestions.ts`: new canonical suggestion contract.
- `shared/contracts/command-turn.ts`: optional linkage from inline next-steps to suggestions.
- `shared/types/index.ts`: existing `getCallPriceLight()` reused by preview and plan-gate.

Backend:

- `api/services/flash-broker.ts`: produce suggestion seeds and stop finalizing marketplace-only events.
- `api/services/orchestrator.ts`: merge producers, emit one set, keep plan-gate and same-conversation execution.
- `api/services/command-suggestions.ts`: new set assembler and serializer.
- `api/services/command-next-steps.ts`: convert next-step artifacts into suggestion targets.
- `api/services/command-interface-reply.ts`: use shared descriptor cache after extraction.
- `api/services/command-descriptor-cache.ts`: new shared descriptor cache.
- `api/services/suggestion-preview.ts`: new preview descriptor service.
- `api/services/suggestion-acceptance.ts`: new accept dispatcher.
- `api/services/system-agent-descriptors.ts`: new backend system-agent metadata.
- `api/services/capability-suggestion-telemetry.ts`: allow non-app target rows and preserve app install.
- `api/services/capability-suggestion-validation.ts`: validate non-app accepts.
- `api/handlers/chat.ts`: preview and accept endpoints.
- `api/handlers/app.ts`: route preview and accept endpoints.

Desktop:

- `desktop/src/types/ambientSuggestion.ts`: typed mixed-target suggestions.
- `desktop/src/hooks/useAmbientSuggestions.ts`: lifecycle telemetry should send target metadata and avoid assuming `appId === suggestion.id`.
- `desktop/src/hooks/useCommandSuggestions.ts`: new Command-specific preview/accept state.
- `desktop/src/lib/api.ts`: typed endpoints and stream event updates.
- `desktop/src/components/CommandHomescreen.tsx`: receive suggestions, mount UI, route accepts.
- `desktop/src/components/command/CommandSuggestionsSurface.tsx`: new popup surface.
- `desktop/src/components/command/SuggestionPreviewPanel.tsx`: new descriptor renderer.
- `desktop/src/components/command/CommandComposer.tsx`: prompt prefill compatibility.
- `desktop/src/components/DiscoverWidget.tsx`: keep explicit discovery, avoid overloading.
- `desktop/src/components/composer/ToolSelectionPopover.tsx`: standard-chat compatibility and copy cleanup.
- `desktop/src/components/ChatView.tsx`: typed accept compatibility for standard chat.
- `desktop/src/components/NavSidebar.tsx`: collapse canonical system agents after accept routing works.
- `desktop/src/lib/systemAgents.ts`: retain metadata, possibly expose labels for suggestions.

## Recommended Sequencing

1. Land N-5 first. It is low risk and prevents local type forks.
2. Land N-6 and N-7 together only if review bandwidth is high; otherwise keep them separate.
3. Do not build the final UI before N-8 and N-9 are at least stubbed, because preview and accept determine the component state machine.
4. Collapse system-agent chats only after same-conversation accept has been manually verified.
5. Save pixel polish for N-12 after the functional loop is complete.

## Open Decisions

No blocking product decisions remain. Implementation defaults:

- No migration in the first pass.
- Store all target discriminators in `metadata.target`.
- Keep inline next-step artifacts until the Suggestions surface is stable.
- Keep DiscoverWidget for explicit discovery results.
- Add batch preview if it is cheap, but single-item preview is enough for the first functional PR.
- Hide system-agent navigation after accept routing, not before.
