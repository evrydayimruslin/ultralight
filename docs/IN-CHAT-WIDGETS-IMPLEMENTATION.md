# In-Chat Widgets — Implementation Plan

## Overview

Widgets render as interactive iframes inside tool call cards in the conversation view. When a tool call result contains `app_html`, the tool call card auto-expands to show the widget — giving users a rich, interactive view of the result.

The **agent decides** which widget to show based on user intent. Widget functions are described in the app manifest with clear guidance on when to invoke them. No auto-mapping or discovery needed — the LLM understands context better than any keyword matcher.

## Architecture

```
MessageBubble
  └── ToolCallCard (parses result JSON, detects app_html field)
      └── InChatWidget (iframe with ulAction bridge)
```

## Files Changed / Created

### New Files

| File | Purpose |
|------|---------|
| `desktop/src/components/InChatWidget.tsx` | Inline iframe widget component with bridge SDK injection and auto-resize |

### Modified Files

| File | Change |
|------|--------|
| `desktop/src/components/ToolCallCard.tsx` | Detects `app_html` in result JSON, auto-expands with widget |
| `api/handlers/mcp.ts` | Accepts unprefixed function names (for in-chat widget bridge calls) |
| `apps/mcps/email-ops/manifest.json` | Agent-facing descriptions for widget functions |

### Unchanged Files

| File | Notes |
|------|-------|
| `desktop/src/components/MessageList.tsx` | No changes needed — no context provider |
| `desktop/src/components/ChatView.tsx` | No changes needed — no app ID plumbing |

## How It Works

### 1. Agent Decides (via manifest descriptions)

Widget functions like `widget_email_inbox_ui` are included in the agent's system prompt with clear descriptions:
> "Call this when the user wants to visually browse, review, approve, edit, or manage email conversations and their AI-generated draft responses."

The agent reads user intent and decides which widget (if any) to invoke. No auto-mapping needed.

### 2. Widget Detection (in `ToolCallCard`)

When any tool call result arrives:
1. Parse result as JSON
2. Check if it contains an `app_html` field (string, non-empty)
3. If yes: auto-expand the card, render `InChatWidget` with the HTML
4. If no: render as before (text or rich renderer)

Detection is just: `typeof parsed.app_html === 'string'`. No discovery, no mapping, no context.

### 3. Widget Rendering (`InChatWidget`)

- Injects the `ulAction()` bridge SDK into the widget HTML (same pattern as `WidgetAppView`)
- Also injects `window.ulInitialData` with the parsed function result
- Renders in a sandboxed iframe (`allow-scripts allow-same-origin`)
- Auto-resizes height via `postMessage` from iframe (using `ResizeObserver` + `MutationObserver`)
- Height clamped between 80px and 600px (configurable via `maxHeight` prop)
- Full interactivity: widget can call any app function via `ulAction()`

### 4. Bridge SDK

Same as existing `WidgetAppView` bridge, plus:
- `window.ulInitialData`: the tool call result, so the widget can render immediately without a data fetch
- Height auto-reporting: `parent.postMessage({ type: 'ul-widget-resize', height }, '*')`
- Ready signal: `parent.postMessage({ type: 'ul-widget-ready' }, '*')`

## Visual Behavior

### Collapsed (default for non-widget tool calls)
```
┌─────────────────────────────────────────┐
│ ✓  Checking billing for 502    36ms  ▼  │
└─────────────────────────────────────────┘
```

### Expanded with widget (auto-expanded)
```
┌─────────────────────────────────────────────────────┐
│ ✓  Checking billing for 502    36ms  widget    ▲    │
├─────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────┐ │
│ │  [Interactive widget iframe - full width]        │ │
│ │                                                  │ │
│ │  Room 502 · Billing Summary                      │ │
│ │  Item             Qty    Rate       Total        │ │
│ │  Room (3 nights)   3    ¥12,000    ¥36,000       │ │
│ │  Minibar           1    ¥2,400     ¥2,400        │ │
│ │                                                  │ │
│ │  [Send Invoice]  [Add Charge]                    │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### Key UX Details
- Widget cards have no max-height constraint — the iframe auto-sizes up to 600px
- "widget" label shows in collapsed header when a widget is available
- Loading spinner shows while widget HTML is being fetched
- Clicking header toggles expanded/collapsed (same as today)
- Widget is fully interactive — buttons, forms, tables all work
- Widget actions hit the MCP backend directly via `ulAction()`

## Caching Strategy

Widget HTML is cached in `localStorage` under key `widget_app:{appUuid}:{widgetName}`:
```json
{
  "html": "<!DOCTYPE html>...",
  "version": "4.0",
  "cachedAt": 1711468800000
}
```

This is the same cache used by `useWidgetInbox` for dashboard widgets — in-chat and dashboard share the cache.

## Widget Routing: Agent-Driven

### How the agent knows about widgets

Widget functions appear in the connected apps schema (system prompt) with descriptions written for the agent:

```json
{
  "widget_email_inbox_ui": {
    "description": "Renders an interactive email approvals dashboard as a rich widget. Call this when the user wants to visually browse, review, approve, edit, or manage email conversations and their AI-generated draft responses."
  },
  "widget_email_faqs_ui": {
    "description": "Renders an interactive knowledge base editor as a rich widget. Call this when the user wants to view or manage FAQ entries and business conventions."
  }
}
```

### Why agent-driven beats auto-mapping

- "Show me unread emails" → agent knows to call `widget_email_inbox_ui` (semantic understanding)
- "Check the FAQs" → agent knows to call `widget_email_faqs_ui`
- "List conversations" → agent may call `conversations_list` for raw data OR `widget_email_inbox_ui` for visual view, depending on context
- No keyword matcher can make these decisions — only the LLM understands user intent

### Per-function conventions (optional enhancement)

The agent config UI supports per-function convention strings that get injected into the system prompt. These can further guide widget usage:

```
widget_email_inbox_ui → "Prefer this over conversations_list when the user wants to review or act on drafts"
```

## What This Does NOT Change

- Dashboard widgets (`WidgetAppView`, `WidgetInbox`, `WidgetHomescreen`) — untouched
- The agent loop / tool execution — untouched
- How tool results are returned to the model — untouched (the model still gets the text result)
- Non-widget tool calls — render exactly as before

## Server-Side Change: Unprefixed Function Names

The MCP endpoint (`api/handlers/mcp.ts`) now accepts unprefixed function names in addition to the existing `{slug}_{functionName}` format. This enables the in-chat widget bridge to call functions without knowing the app slug.

Before: only `email_ops_widget_email_inbox_data` worked
After: both `email_ops_widget_email_inbox_data` and `widget_email_inbox_data` work

This is backward-compatible — prefixed names still work exactly as before.

## Next Steps

1. **Deploy manifest update**: Upload the updated email-ops manifest with agent-facing widget descriptions
2. **Test with email-ops**: Connect email-ops to an agent, ask "show me my email drafts" — agent should call `widget_email_inbox_ui`
3. **Widget templates**: Build reusable HTML templates (table, form, card-list, chart) for rapid widget development
4. **Expand-to-panel**: Add a button to pop the widget out into a larger side panel
5. **Design tokens**: Shared CSS variables for consistent widget styling across apps
6. **Widget Designer agent**: Now that the rendering infrastructure exists, build the Widget Designer default agent
