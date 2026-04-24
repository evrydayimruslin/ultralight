export interface WidgetToolDescriptor {
  name: string;
  description?: string;
}

export interface DiscoveredWidgetSource {
  appUuid: string;
  appName: string;
  appSlug: string;
  widgetName: string;
  uiFunction: string;
  dataFunction: string;
}

export interface LegacyWidgetContractObservation {
  appUuid: string;
  appName: string;
  appSlug: string;
  widgetName: string;
  legacyFunction: string;
  source: 'widget-inbox-discovery';
}

export interface LegacyWidgetContractInventoryEntry extends LegacyWidgetContractObservation {
  firstSeenAt: number;
  lastSeenAt: number;
  seenCount: number;
}

export interface WidgetDiscoveryResult {
  sources: DiscoveredWidgetSource[];
  legacyObservations: LegacyWidgetContractObservation[];
}

export const WIDGET_CONTRACT_INVENTORY_KEY = 'ul_widget_contract_inventory_v1';

export function parseCanonicalWidgetUiToolName(toolName: string): {
  appSlug: string;
  widgetName: string;
} | null {
  const match = toolName.match(/^(.+)_widget_(.+)_ui$/);
  if (!match) return null;
  return { appSlug: match[1], widgetName: match[2] };
}

export function parseLegacySingleFunctionWidgetToolName(toolName: string): {
  appSlug: string;
  widgetName: string;
  functionName: string;
} | null {
  if (toolName.endsWith('_ui') || toolName.endsWith('_data')) {
    return null;
  }

  const match = toolName.match(/^(.+)_widget_(.+)$/);
  if (!match) return null;
  return {
    appSlug: match[1],
    widgetName: match[2],
    functionName: `widget_${match[2]}`,
  };
}

export function discoverWidgetSources(input: {
  appUuid: string;
  appName: string;
  tools: WidgetToolDescriptor[];
}): WidgetDiscoveryResult {
  const canonicalSources = new Map<string, DiscoveredWidgetSource>();

  for (const tool of input.tools) {
    const parsed = parseCanonicalWidgetUiToolName(tool.name);
    if (!parsed) continue;

    canonicalSources.set(parsed.widgetName, {
      appUuid: input.appUuid,
      appName: input.appName,
      appSlug: parsed.appSlug,
      widgetName: parsed.widgetName,
      uiFunction: `widget_${parsed.widgetName}_ui`,
      dataFunction: `widget_${parsed.widgetName}_data`,
    });
  }

  const legacySources = new Map<string, DiscoveredWidgetSource>();
  const legacyObservations: LegacyWidgetContractObservation[] = [];

  for (const tool of input.tools) {
    const parsed = parseLegacySingleFunctionWidgetToolName(tool.name);
    if (!parsed) continue;
    const isCompatibilityAlias = typeof tool.description === 'string'
      && /\b(legacy|compat|older desktop)\b/i.test(tool.description);

    legacyObservations.push({
      appUuid: input.appUuid,
      appName: input.appName,
      appSlug: parsed.appSlug,
      widgetName: parsed.widgetName,
      legacyFunction: parsed.functionName,
      source: 'widget-inbox-discovery',
    });

    if (
      canonicalSources.has(parsed.widgetName)
      || legacySources.has(parsed.widgetName)
      || (canonicalSources.size > 0 && isCompatibilityAlias)
    ) {
      continue;
    }

    legacySources.set(parsed.widgetName, {
      appUuid: input.appUuid,
      appName: input.appName,
      appSlug: parsed.appSlug,
      widgetName: parsed.widgetName,
      uiFunction: parsed.functionName,
      dataFunction: parsed.functionName,
    });
  }

  return {
    sources: [...canonicalSources.values(), ...legacySources.values()],
    legacyObservations,
  };
}

function hasLocalStorage(): boolean {
  return typeof globalThis !== 'undefined' && 'localStorage' in globalThis;
}

function readLegacyWidgetContractInventory(): Record<string, LegacyWidgetContractInventoryEntry> {
  if (!hasLocalStorage()) return {};

  try {
    const raw = globalThis.localStorage.getItem(WIDGET_CONTRACT_INVENTORY_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, LegacyWidgetContractInventoryEntry> : {};
  } catch {
    return {};
  }
}

export function recordLegacyWidgetContractObservations(
  observations: LegacyWidgetContractObservation[],
  now = Date.now(),
): void {
  if (!hasLocalStorage() || observations.length === 0) return;

  const inventory = readLegacyWidgetContractInventory();

  for (const observation of observations) {
    const key = `${observation.appUuid}:${observation.legacyFunction}`;
    const existing = inventory[key];

    inventory[key] = {
      ...observation,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
      seenCount: (existing?.seenCount ?? 0) + 1,
    };
  }

  globalThis.localStorage.setItem(WIDGET_CONTRACT_INVENTORY_KEY, JSON.stringify(inventory));
}
