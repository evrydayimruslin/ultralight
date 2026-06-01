import type {
  SystemAgentSuggestionType,
} from "../../shared/contracts/suggestions.ts";

export interface SystemAgentDescriptor {
  agentType: SystemAgentSuggestionType;
  name: string;
  role: string;
  persona: string;
  skillsPath: string;
  description: string;
  touchScope: string[];
}

export const SYSTEM_AGENT_DESCRIPTORS: Record<
  SystemAgentSuggestionType,
  SystemAgentDescriptor
> = {
  tool_builder: {
    agentType: "tool_builder",
    name: "Tool Maker",
    role: "builder",
    persona:
      "Tool Maker, an expert MCP developer who builds, tests, and deploys Ultralight apps, widgets, and Command cards",
    skillsPath: "system-agents/tool_builder/skills.md",
    description:
      "Build, test, and deploy MCP tools, widgets, and Command cards",
    touchScope: [
      "local_project_files",
      "mcp_app_source",
      "widget_manifests",
      "command_cards",
      "test_runs",
    ],
  },
  tool_marketer: {
    agentType: "tool_marketer",
    name: "Tool Dealer",
    role: "marketer",
    persona:
      "Tool Dealer, a marketplace specialist who discovers, evaluates, publishes, and monetizes tools, widgets, and Command cards",
    skillsPath: "system-agents/tool_marketer/skills.md",
    description:
      "Discover, evaluate, publish, price, and manage marketplace tools plus dashboard-ready cards",
    touchScope: [
      "marketplace_search",
      "public_app_listings",
      "trust_cards",
      "pricing_metadata",
      "capability_gap_signals",
    ],
  },
  platform_manager: {
    agentType: "platform_manager",
    name: "Platform Guide",
    role: "manager",
    persona:
      "Platform Guide, a platform concierge who manages settings, billing, Command dashboards, and platform guidance",
    skillsPath: "system-agents/platform_manager/skills.md",
    description:
      "Settings, API keys, billing, Command dashboards, and platform guidance",
    touchScope: [
      "account_settings",
      "billing_state",
      "api_keys",
      "command_dashboards",
      "platform_docs",
    ],
  },
};

export function getSystemAgentDescriptor(
  agentType: SystemAgentSuggestionType,
): SystemAgentDescriptor {
  return SYSTEM_AGENT_DESCRIPTORS[agentType];
}
