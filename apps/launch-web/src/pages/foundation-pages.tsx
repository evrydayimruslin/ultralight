import type { ReactElement, ReactNode } from "react";

import {
  LAUNCH_SCOPE_CONTRACT,
  type LaunchDeferredCapability,
  type LaunchIncludedCapability,
} from "../../../../shared/contracts/launch.ts";
import type { LaunchPageProps } from "../App";
import {
  Avatar,
  Button,
  Card,
  CodeBlock,
  EmptyState,
  Icon,
  Metric,
  Mono,
  PageHeader,
  Pill,
  RouteButton,
  RouteLink,
  Section,
} from "../components/launch-chrome";

const agentLogos = ["Claude Code", "Cursor", "Codex", "OpenAI MCP", "Generic MCP", "CLI", "API"];
const featuredTools = [
  {
    author: "@kepler",
    color: "#7c3aed",
    installs: "24.8k",
    name: "get_weather",
    price: "Free install",
    summary: "Hyper-local weather, forecasts, and alert widgets.",
    widgets: "2 widgets",
  },
  {
    author: "@anchor",
    color: "#0891b2",
    installs: "19.4k",
    name: "currency_convert",
    price: "0.002/call",
    summary: "Live FX across 180+ pairs with historical rates.",
    widgets: "Functions only",
  },
  {
    author: "stripe",
    color: "#635bff",
    installs: "18.2k",
    name: "stripe.subscribe",
    price: "Receipts on",
    summary: "Create subscriptions and return billing receipts.",
    widgets: "1 widget",
  },
];
const primitives = [
  ["Install", "Connect the MCP/API layer to existing agents."],
  ["Discover", "Find tools and platform primitives semantically."],
  ["Wallet", "Spendable Light, receipts, earnings, payouts."],
  ["Widgets", "Open optional UI for tools when UI matters."],
] as const;
const flow = ["Install", "Discover", "Inspect", "Call", "Open widget", "Show receipt"];

export function HomeFoundationPage({ navigate }: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        actions={
          <>
            <RouteButton icon="copy" navigate={navigate} size="lg" to="/install">
              Add to agent
            </RouteButton>
            <RouteButton navigate={navigate} size="lg" to="/store" variant="secondary">
              Browse Store
            </RouteButton>
          </>
        }
        eyebrow="External-agent tool layer"
        intro="One endpoint lets existing agents discover tools, run functions, open widgets, and settle usage in Light."
        title="Many agents? One tool layer."
      />

      <section className="orbit-band" aria-label="Agent-native platform loop">
        <div className="orbit-copy">
          <p>
            Deploy tools any existing agent can install, run, compose, and pay for.
          </p>
          <div className="agent-wall">
            {agentLogos.map((logo) => <span key={logo}>{logo}</span>)}
          </div>
        </div>
        <div className="orbit-system" aria-hidden="true">
          <span className="orbit-core"><Icon name="spark" size={36} /></span>
          <span className="orbit-dot dot-one">Tools</span>
          <span className="orbit-dot dot-two">Auth</span>
          <span className="orbit-dot dot-three">Pay</span>
          <span className="orbit-dot dot-four">UI</span>
        </div>
      </section>

      <Section title="The external agent loop">
        <div className="flow-strip">
          {flow.map((step, index) => (
            <div className="flow-step" key={step}>
              <Mono>{index + 1}</Mono>
              <span>{step}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section
        action={<RouteLink navigate={navigate} to="/store">Browse all</RouteLink>}
        title="Tools shipping now"
      >
        <div className="tool-grid">
          {featuredTools.map((tool) => <ToolCard key={tool.name} tool={tool} />)}
        </div>
      </Section>

      <Section title="One endpoint. Every capability.">
        <div className="two-column">
          <Card>
            <h3>Agent config preview</h3>
            <p>
              The production install page will copy the right MCP, CLI, or API
              instructions for the selected agent.
            </p>
            <CodeBlock>{`{
  "mcpServers": {
    "ultralight": {
      "url": "https://api.ultralight.dev/mcp/platform",
      "headers": { "Authorization": "Bearer $KEY" }
    }
  }
}`}</CodeBlock>
          </Card>
          <div className="primitive-grid">
            {primitives.map(([title, body]) => (
              <Card key={title} tone="subtle">
                <h3>{title}</h3>
                <p>{body}</p>
              </Card>
            ))}
          </div>
        </div>
      </Section>
    </>
  );
}

export function InstallFoundationPage({ navigate }: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        actions={<RouteButton icon="key" navigate={navigate} size="lg" to="/settings">Create key</RouteButton>}
        eyebrow="Install"
        intro="Connect Ultralight to the agents your team already uses. API keys are revealed once and scoped for tool calls."
        title="Add Ultralight to an existing agent."
      />
      <Section title="Supported launch targets">
        <div className="target-grid">
          {agentLogos.map((target) => (
            <Card key={target}>
              <div className="card-row">
                <span className="target-icon"><Icon name="terminal" /></span>
                <div>
                  <h3>{target}</h3>
                  <p>MCP or direct API setup with bearer token auth.</p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </Section>
      <Section title="Single key launch UX">
        <Card>
          <div className="split-card">
            <div>
              <Pill tone="green">Reveal once</Pill>
              <h3>Provision once, pass scoped tokens to agents.</h3>
              <p>
                The launch implementation keeps provisioning keys out of widget
                HTML. Tool widgets receive temporary execution context from the
                platform render path.
              </p>
            </div>
            <CodeBlock>{`ULTRALIGHT_API_KEY=ulk_live_...
ultralight mcp install --target codex
ultralight tools search "weather"`}</CodeBlock>
          </div>
        </Card>
      </Section>
    </>
  );
}

export function StoreFoundationPage({ navigate }: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        actions={<Button icon="search" size="lg" variant="secondary">Search tools</Button>}
        eyebrow="Store"
        intro="Public discovery for tools, widgets, platform primitives, builders, and fee-credit leaders."
        title="Find the right callable surface."
      />
      <Section title="Semantic discovery">
        <div className="search-panel">
          <Icon name="search" />
          <span>Try deploy, wallet, pricing, install, publish, or weather.</span>
        </div>
        <div className="tool-grid">
          {featuredTools.map((tool) => (
            <button
              className="tool-card-button"
              key={tool.name}
              onClick={() => navigate(`/tools/${tool.name}`)}
              type="button"
            >
              <ToolCard tool={tool} />
            </button>
          ))}
        </div>
      </Section>
      <Section title="Leaderboards">
        <div className="two-column">
          <Leaderboard title="Builders" valueLabel="earned" />
          <Leaderboard title="Fee credit" valueLabel="waived" />
        </div>
      </Section>
    </>
  );
}

export function ToolFoundationPage({ navigate, route }: LaunchPageProps): ReactElement {
  const slug = route.params.slug || "get_weather";
  return (
    <>
      <PageHeader
        actions={
          <>
            <Button icon="check" size="lg">Install</Button>
            <RouteButton navigate={navigate} size="lg" to="/store" variant="secondary">
              Back to Store
            </RouteButton>
          </>
        }
        eyebrow="Public tool page"
        intro="Public pages show trust, pricing, functions, widgets, and install state before an agent calls anything."
        title={slug}
      />
      <div className="tool-layout">
        <Section title="Widget preview">
          <Card className="widget-preview">
            <div className="widget-toolbar">
              <Pill tone="green">Public</Pill>
              <Mono>forecast_card</Mono>
            </div>
            <div className="weather-widget">
              <strong>72 F</strong>
              <span>Clear, light wind</span>
              <div className="weather-bars">
                {[64, 70, 73, 69, 66].map((value) => (
                  <span key={value} style={{ height: `${value - 38}px` }} />
                ))}
              </div>
            </div>
          </Card>
        </Section>
        <Section title="Trust + functions">
          <div className="stack">
            <Card>
              <h3>Signed manifest</h3>
              <p>Runtime, capabilities, setup requirements, receipts, and signer details sit here.</p>
              <div className="pill-row">
                <Pill tone="green">Receipts</Pill>
                <Pill>Read</Pill>
                <Pill>Network</Pill>
              </div>
            </Card>
            <Card>
              <h3>forecast</h3>
              <p>Manual website runs bypass external-agent prompts and still return receipts.</p>
              <div className="card-row spaced">
                <Mono>0.012/call</Mono>
                <Button size="sm" variant="secondary">Run</Button>
              </div>
            </Card>
          </div>
        </Section>
      </div>
    </>
  );
}

export function LibraryFoundationPage({ navigate }: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        actions={<RouteButton icon="grid" navigate={navigate} size="lg" to="/store">Open Store</RouteButton>}
        eyebrow="Library"
        intro="Installed tools and owned tools live together, with owner admin one click away."
        title="Your launch tool library."
      />
      <Section title="Installed">
        <div className="tool-grid">
          {featuredTools.slice(0, 2).map((tool) => <ToolCard key={tool.name} tool={tool} />)}
        </div>
      </Section>
      <Section title="Owned">
        <Card>
          <div className="card-row spaced">
            <div>
              <h3>get_weather</h3>
              <p>Public, 2 widgets, 4 functions, receipts enabled.</p>
            </div>
            <RouteButton navigate={navigate} to="/admin/tools/tool_8fa21c" variant="secondary">
              Admin
            </RouteButton>
          </div>
        </Card>
      </Section>
    </>
  );
}

export function AdminFoundationPage(_props: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        eyebrow="Owner admin"
        intro="Owner-only management for tool details, pricing, widgets, secrets, trust, receipts, and logs."
        title="Manage get_weather."
      />
      <Section title="Admin surface">
        <div className="admin-grid">
          {["Details", "Pricing", "Widgets", "Secrets", "Trust", "Receipts"].map((item) => (
            <Card key={item}>
              <h3>{item}</h3>
              <p>Production controls will wire into the existing app/admin endpoints.</p>
            </Card>
          ))}
        </div>
      </Section>
    </>
  );
}

export function WalletFoundationPage(_props: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        actions={<Button icon="wallet" size="lg">Add Light</Button>}
        eyebrow="Wallet"
        intro="Spendable balance, top-ups, transactions, receipts, earnings, and payouts."
        title="Light balance and creator earnings."
      />
      <Section title="Balance">
        <div className="wallet-metrics">
          <Metric label="Spendable" value="1,240 Light" />
          <Metric label="Purchased" value="1,000 Light" />
          <Metric label="Earned" value="240 Light" />
          <Metric label="Escrow" value="0 Light" />
        </div>
      </Section>
      <Section title="Top-up quote">
        <Card>
          <div className="split-card">
            <div>
              <Pill>100:1</Pill>
              <h3>Users choose Light amount.</h3>
              <p>Stripe processing fees are passed through with true gross-up for card or Bank (ACH).</p>
            </div>
            <div className="quote-box">
              <span>10,000 Light</span>
              <strong>$103.30 card</strong>
              <small>$100.00 base + $3.30 processing</small>
            </div>
          </div>
        </Card>
      </Section>
    </>
  );
}

export function SettingsFoundationPage(_props: LaunchPageProps): ReactElement {
  return (
    <>
      <PageHeader
        eyebrow="Profile"
        intro="Account settings, API key lifecycle, and external-agent permission defaults."
        title="Launch-safe preferences."
      />
      <Section title="Agent access">
        <div className="two-column">
          <Card>
            <h3>API key</h3>
            <p>Create, copy once, rotate, or revoke scoped launch tokens.</p>
            <CodeBlock>{"ulk_live_••••••••••••4xN4"}</CodeBlock>
          </Card>
          <Card>
            <h3>Default permission</h3>
            <p>New external-agent function calls default to ask until explicitly allowed.</p>
            <div className="segmented">
              <span>Always</span>
              <span className="active">Ask</span>
              <span>Never</span>
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}

function ToolCard({
  tool,
}: {
  tool: typeof featuredTools[number];
}): ReactElement {
  return (
    <Card className="tool-card">
      <div className="tool-title">
        <Avatar color={tool.color} name={tool.author} />
        <div>
          <h3>{tool.name}</h3>
          <span>{tool.author}</span>
        </div>
      </div>
      <p>{tool.summary}</p>
      <div className="tool-meta">
        <Mono>{tool.installs} installs</Mono>
        <span>{tool.widgets}</span>
      </div>
      <div className="tool-meta">
        <Pill tone={tool.price === "Free install" ? "green" : "default"}>{tool.price}</Pill>
        <Pill>Signed</Pill>
      </div>
    </Card>
  );
}

function Leaderboard({
  title,
  valueLabel,
}: {
  title: string;
  valueLabel: string;
}): ReactElement {
  const rows = [
    ["@kepler", "4.8k"],
    ["stripe", "3.9k"],
    ["@anchor", "2.7k"],
  ];
  return (
    <Card>
      <h3>{title}</h3>
      <div className="leaderboard-list">
        {rows.map(([name, value], index) => (
          <div className="leader-row" key={name}>
            <Mono>{index + 1}</Mono>
            <span>{name}</span>
            <strong>{value} {valueLabel}</strong>
          </div>
        ))}
      </div>
    </Card>
  );
}

export function CapabilityTags(): ReactElement {
  return (
    <div className="capability-tags">
      {LAUNCH_SCOPE_CONTRACT.includedCapabilities.map((capability) => (
        <CapabilityTag capability={capability} key={capability} />
      ))}
    </div>
  );
}

export function DeferredTags(): ReactElement {
  return (
    <div className="capability-tags">
      {LAUNCH_SCOPE_CONTRACT.deferredCapabilities.map((capability) => (
        <CapabilityTag capability={capability} deferred key={capability} />
      ))}
    </div>
  );
}

function CapabilityTag({
  capability,
  deferred = false,
}: {
  capability: LaunchDeferredCapability | LaunchIncludedCapability;
  deferred?: boolean;
}): ReactElement {
  return (
    <Pill tone={deferred ? "amber" : "green"}>
      {capability.replaceAll("_", " ")}
    </Pill>
  );
}

export function FoundationNotice({ children }: { children: ReactNode }): ReactElement {
  return <EmptyState title="Ready for page port">{children}</EmptyState>;
}
