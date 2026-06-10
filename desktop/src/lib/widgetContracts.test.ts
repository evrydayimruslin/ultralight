import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WIDGET_CONTRACT_INVENTORY_KEY,
  discoverWidgetSources,
  parseCanonicalWidgetUiToolName,
  parseLegacySingleFunctionWidgetToolName,
  recordLegacyWidgetContractObservations,
} from './widgetContracts';

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();

  return {
    get length() {
      return store.size;
    },
    clear: vi.fn(() => {
      store.clear();
    }),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(store.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      store.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, String(value));
    }),
  } as Storage;
}

describe('widget contract helpers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  it('parses canonical widget ui tools', () => {
    expect(parseCanonicalWidgetUiToolName('email-ops_widget_email_inbox_ui')).toEqual({
      appSlug: 'email-ops',
      widgetName: 'email_inbox',
    });
  });

  it('parses legacy single-function widget tools', () => {
    expect(parseLegacySingleFunctionWidgetToolName('email-ops_widget_approval_queue')).toEqual({
      appSlug: 'email-ops',
      widgetName: 'approval_queue',
      functionName: 'widget_approval_queue',
    });
    expect(parseLegacySingleFunctionWidgetToolName('email-ops_widget_email_inbox_ui')).toBeNull();
  });

  it('prefers canonical widget contracts while still inventorying legacy aliases', () => {
    const result = discoverWidgetSources({
      appUuid: 'app-123',
      appName: 'Email Ops',
      tools: [
        { name: 'email-ops_widget_email_inbox_ui' },
        { name: 'email-ops_widget_email_inbox_data' },
        { name: 'email-ops_widget_approval_queue', description: 'Legacy widget bridge for older desktop builds.' },
      ],
    });

    expect(result.sources).toEqual([
      {
        appUuid: 'app-123',
        appName: 'Email Ops',
        appSlug: 'email-ops',
        widgetName: 'email_inbox',
        uiFunction: 'widget_email_inbox_ui',
        dataFunction: 'widget_email_inbox_data',
      },
    ]);
    expect(result.legacyObservations).toEqual([
      {
        appUuid: 'app-123',
        appName: 'Email Ops',
        appSlug: 'email-ops',
        widgetName: 'approval_queue',
        legacyFunction: 'widget_approval_queue',
        source: 'widget-inbox-discovery',
      },
    ]);
  });

  it('still surfaces legacy widgets when an app has no canonical widget pair yet', () => {
    const result = discoverWidgetSources({
      appUuid: 'app-456',
      appName: 'Tasks',
      tools: [
        { name: 'tasks_widget_inbox' },
      ],
    });

    expect(result.sources).toEqual([
      {
        appUuid: 'app-456',
        appName: 'Tasks',
        appSlug: 'tasks',
        widgetName: 'inbox',
        uiFunction: 'widget_inbox',
        dataFunction: 'widget_inbox',
      },
    ]);
    expect(result.legacyObservations).toHaveLength(1);
  });

  it('records local inventory for legacy widget contracts', () => {
    recordLegacyWidgetContractObservations([
      {
        appUuid: 'app-123',
        appName: 'Email Ops',
        appSlug: 'email-ops',
        widgetName: 'approval_queue',
        legacyFunction: 'widget_approval_queue',
        source: 'widget-inbox-discovery',
      },
    ], 1_700_000_000_000);
    recordLegacyWidgetContractObservations([
      {
        appUuid: 'app-123',
        appName: 'Email Ops',
        appSlug: 'email-ops',
        widgetName: 'approval_queue',
        legacyFunction: 'widget_approval_queue',
        source: 'widget-inbox-discovery',
      },
    ], 1_700_000_000_500);

    const raw = localStorage.getItem(WIDGET_CONTRACT_INVENTORY_KEY);
    expect(raw).not.toBeNull();

    const parsed = JSON.parse(raw || '{}');
    expect(parsed['app-123:widget_approval_queue']).toEqual({
      appUuid: 'app-123',
      appName: 'Email Ops',
      appSlug: 'email-ops',
      widgetName: 'approval_queue',
      legacyFunction: 'widget_approval_queue',
      source: 'widget-inbox-discovery',
      firstSeenAt: 1_700_000_000_000,
      lastSeenAt: 1_700_000_000_500,
      seenCount: 2,
    });
  });
});
