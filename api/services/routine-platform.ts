import { getEnv } from "../lib/env.ts";
import type { App } from "../../shared/types/index.ts";
import {
  type RoutineApprovalPolicy,
  type RoutineBudgetDefaults,
  type RoutineCapabilityDeclaration,
  type RoutineScheduleDeclaration,
} from "../../shared/contracts/routine.ts";
import { parseAppManifest } from "./app-settings.ts";
import {
  buildRoutineIndexForApp,
  type RoutineIndexEntry,
} from "./codemode-tools.ts";
import {
  createRoutine,
  createRoutineRun,
  deleteRoutine,
  getRoutine,
  listRoutines,
  pauseRoutine,
  resumeRoutine,
  routineCapabilitiesFromManifest,
  type RoutineCapabilityInput,
  type RoutineCreateInput,
  type RoutineDashboardBindingInput,
  type RoutineStatus,
  updateRoutine,
} from "./routines.ts";

export const ROUTINE_PLATFORM_ACTIONS = [
  "templates",
  "plan",
  "create",
  "list",
  "get",
  "update",
  "pause",
  "resume",
  "delete",
  "run_now",
] as const;

export type RoutinePlatformAction = typeof ROUTINE_PLATFORM_ACTIONS[number];

export const ROUTINE_PLATFORM_INVALID_PARAMS = -32602;
export const ROUTINE_PLATFORM_NOT_FOUND = -32002;
export const ROUTINE_PLATFORM_FORBIDDEN = -32003;

const APP_SELECT =
  "id,owner_id,slug,name,description,visibility,manifest,current_version,updated_at";

export class RoutinePlatformError extends Error {
  code: number;
  data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "RoutinePlatformError";
    this.code = code;
    this.data = data;
  }
}

interface RoutineTemplateApp {
  id: string;
  owner_id: string;
  slug: string;
  name: string;
  description?: string | null;
  visibility: App["visibility"] | string;
  manifest?: unknown;
  current_version?: string | null;
  updated_at?: string | null;
}

export interface RoutineTemplateSummary extends RoutineIndexEntry {
  templateKey: string;
  appDescription?: string | null;
  appVisibility?: string;
  appVersion?: string | null;
  appUpdatedAt?: string | null;
  createExample: {
    action: "create";
    app_id: string;
    template_id: string;
    approve_capabilities: true;
  };
}

interface PlannedRoutine {
  template: RoutineTemplateSummary;
  routine: RoutineCreateInput;
  pendingCapabilities: RoutineCapabilityInput[];
  approvedCapabilities: RoutineCapabilityInput[];
  createArgs: Record<string, unknown>;
}

function serviceHeaders(): Record<string, string> {
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  return {
    "apikey": key,
    "Authorization": `Bearer ${key}`,
    "Content-Type": "application/json",
  };
}

function restUrl(path: string, params: Record<string, string>): string {
  const url = new URL(`${getEnv("SUPABASE_URL")}/rest/v1/${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

async function readRows<T>(res: Response, label: string): Promise<T[]> {
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText);
    throw new Error(`${label} (${res.status}): ${message}`);
  }
  const value = await res.json();
  return Array.isArray(value) ? value as T[] : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function requiredString(value: unknown, field: string): string {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_INVALID_PARAMS,
      `${field} is required`,
    );
  }
  return normalized;
}

function isAction(value: string): value is RoutinePlatformAction {
  return ROUTINE_PLATFORM_ACTIONS.includes(value as RoutinePlatformAction);
}

function numericLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(max, Math.floor(value)));
}

function objectOrUndefined(
  value: unknown,
): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

function templateSearchText(template: RoutineTemplateSummary): string {
  const capabilityText = (template.capabilities || [])
    .flatMap((capability) => [
      capability.app,
      ...(capability.functions || []),
      capability.purpose || "",
    ])
    .join(" ");
  return [
    template.id,
    template.templateKey,
    template.label,
    template.description || "",
    template.appName,
    template.appSlug,
    capabilityText,
  ].join(" ").toLowerCase();
}

function buildTemplatesForApp(
  app: RoutineTemplateApp,
): RoutineTemplateSummary[] {
  const manifest = parseAppManifest(app.manifest);
  if (!manifest?.routines?.length) return [];

  return buildRoutineIndexForApp({
    id: app.id,
    name: app.name,
    slug: app.slug,
    manifest: {
      functions: manifest.functions,
      widgets: manifest.widgets,
      routines: manifest.routines,
    },
  }).map((template) => ({
    ...template,
    templateKey: `${app.slug}/${template.id}`,
    appDescription: app.description ?? null,
    appVisibility: app.visibility,
    appVersion: app.current_version ?? null,
    appUpdatedAt: app.updated_at ?? null,
    createExample: {
      action: "create",
      app_id: app.id,
      template_id: template.id,
      approve_capabilities: true,
    },
  }));
}

function dedupeApps(apps: RoutineTemplateApp[]): RoutineTemplateApp[] {
  const byId = new Map<string, RoutineTemplateApp>();
  for (const app of apps) {
    if (!app?.id || byId.has(app.id)) continue;
    byId.set(app.id, app);
  }
  return Array.from(byId.values());
}

async function fetchApps(
  params: Record<string, string>,
): Promise<RoutineTemplateApp[]> {
  return await readRows<RoutineTemplateApp>(
    await fetch(restUrl("apps", { ...params, select: APP_SELECT }), {
      headers: serviceHeaders(),
    }),
    "Failed to load routine template apps",
  );
}

async function appIsAccessible(
  userId: string,
  app: RoutineTemplateApp,
): Promise<boolean> {
  if (app.owner_id === userId) return true;
  if (app.visibility === "public" || app.visibility === "unlisted") {
    return true;
  }

  const rows = await readRows<{ id: string }>(
    await fetch(
      restUrl("user_app_permissions", {
        app_id: `eq.${app.id}`,
        granted_to_user_id: `eq.${userId}`,
        allowed: "eq.true",
        select: "id",
        limit: "1",
      }),
      { headers: serviceHeaders() },
    ),
    "Failed to check routine template app permissions",
  );
  return rows.length > 0;
}

async function loadAccessibleApp(
  userId: string,
  appIdOrSlug: string,
): Promise<RoutineTemplateApp> {
  const candidates: RoutineTemplateApp[] = [];

  if (isUuid(appIdOrSlug)) {
    candidates.push(
      ...await fetchApps({
        id: `eq.${appIdOrSlug}`,
        deleted_at: "is.null",
        limit: "1",
      }),
    );
  }

  candidates.push(
    ...await fetchApps({
      slug: `eq.${appIdOrSlug}`,
      deleted_at: "is.null",
      limit: "10",
    }),
  );

  for (const app of dedupeApps(candidates)) {
    if (await appIsAccessible(userId, app)) return app;
  }

  if (candidates.length > 0) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_FORBIDDEN,
      "This routine template app is private and you do not have access",
    );
  }
  throw new RoutinePlatformError(
    ROUTINE_PLATFORM_NOT_FOUND,
    `Routine template app not found: ${appIdOrSlug}`,
  );
}

async function listTemplateApps(
  userId: string,
  limit: number,
): Promise<RoutineTemplateApp[]> {
  const [ownedApps, publicApps, savedRows] = await Promise.all([
    fetchApps({
      owner_id: `eq.${userId}`,
      deleted_at: "is.null",
      order: "updated_at.desc",
      limit: String(limit),
    }),
    fetchApps({
      visibility: "eq.public",
      deleted_at: "is.null",
      order: "updated_at.desc",
      limit: String(limit * 2),
    }),
    readRows<{ app_id: string }>(
      await fetch(
        restUrl("user_app_library", {
          user_id: `eq.${userId}`,
          select: "app_id",
          limit: String(limit),
        }),
        { headers: serviceHeaders() },
      ),
      "Failed to load saved routine template apps",
    ).catch(() => []),
  ]);

  let savedApps: RoutineTemplateApp[] = [];
  const savedIds = savedRows
    .map((row) => row.app_id)
    .filter((id) => !!id && /^[a-zA-Z0-9-]+$/.test(id));
  if (savedIds.length > 0) {
    savedApps = await fetchApps({
      id: `in.(${savedIds.join(",")})`,
      deleted_at: "is.null",
      limit: String(limit),
    }).catch(() => []);
  }

  return dedupeApps([...ownedApps, ...savedApps, ...publicApps]);
}

async function listRoutineTemplates(
  userId: string,
  args: Record<string, unknown>,
): Promise<{
  query?: string;
  templates: RoutineTemplateSummary[];
  count: number;
}> {
  const limit = numericLimit(args.limit, 50, 100);
  const query = optionalString(args.query);
  const appId = optionalString(args.app_id);
  const apps = appId
    ? [await loadAccessibleApp(userId, appId)]
    : await listTemplateApps(userId, limit);
  let templates = apps.flatMap(buildTemplatesForApp);

  if (query) {
    const normalizedQuery = query.toLowerCase();
    templates = templates.filter((template) =>
      templateSearchText(template).includes(normalizedQuery)
    );
  }

  templates = templates.slice(0, limit);
  return { ...(query ? { query } : {}), templates, count: templates.length };
}

function templateMatchesReference(
  template: RoutineTemplateSummary,
  templateId: string,
): boolean {
  return template.id === templateId ||
    template.templateKey === templateId ||
    `${template.appId}/${template.id}` === templateId ||
    `${template.appSlug}:${template.id}` === templateId ||
    `${template.appId}:${template.id}` === templateId;
}

async function resolveRoutineTemplate(
  userId: string,
  args: Record<string, unknown>,
): Promise<RoutineTemplateSummary> {
  const templateId = requiredString(args.template_id, "template_id");
  const appId = optionalString(args.app_id);

  if (appId) {
    const app = await loadAccessibleApp(userId, appId);
    const template = buildTemplatesForApp(app).find((candidate) =>
      templateMatchesReference(candidate, templateId)
    );
    if (!template) {
      throw new RoutinePlatformError(
        ROUTINE_PLATFORM_NOT_FOUND,
        `Routine template not found: ${templateId}`,
      );
    }
    return template;
  }

  const { templates } = await listRoutineTemplates(userId, { limit: 100 });
  const matches = templates.filter((template) =>
    templateMatchesReference(template, templateId)
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_INVALID_PARAMS,
      `Multiple routine templates match "${templateId}". Provide app_id.`,
      { matches: matches.map((template) => template.templateKey) },
    );
  }
  throw new RoutinePlatformError(
    ROUTINE_PLATFORM_NOT_FOUND,
    `Routine template not found: ${templateId}`,
  );
}

function bindingsFromTemplateSurfaces(
  template: RoutineTemplateSummary,
): RoutineDashboardBindingInput[] {
  const dashboardKey = template.surfaces?.dashboard_key || "command_home";
  const widgetBindings = (template.surfaces?.widgets || []).map((widgetId) => ({
    dashboard_key: dashboardKey,
    app_id: template.appId,
    app_ref: template.appSlug,
    widget_id: widgetId,
  }));
  const cardBindings = (template.surfaces?.command_cards || []).map((card) => ({
    dashboard_key: dashboardKey,
    app_id: template.appId,
    app_ref: template.appSlug,
    widget_id: card.widget_id,
    card_id: card.card_id,
  }));
  return [...widgetBindings, ...cardBindings];
}

function capabilityInputsFromArgs(
  template: RoutineTemplateSummary,
  args: Record<string, unknown>,
): RoutineCapabilityInput[] {
  const baseCapabilities = Array.isArray(args.capabilities)
    ? args.capabilities as RoutineCapabilityInput[]
    : routineCapabilitiesFromManifest(
      template.capabilities as RoutineCapabilityDeclaration[] | undefined,
    );
  const extraCapabilities = Array.isArray(args.extra_capabilities)
    ? args.extra_capabilities as RoutineCapabilityInput[]
    : [];
  const approveCapabilities = args.approve_capabilities === true;

  return [...baseCapabilities, ...extraCapabilities].map((capability) => ({
    ...capability,
    approved: approveCapabilities || capability.approved === true,
  }));
}

function scheduleFromArgs(
  template: RoutineTemplateSummary,
  args: Record<string, unknown>,
): RoutineScheduleDeclaration | undefined {
  return args.schedule !== undefined
    ? args.schedule as RoutineScheduleDeclaration
    : template.defaultSchedule;
}

function buildRoutinePlan(
  template: RoutineTemplateSummary,
  args: Record<string, unknown>,
): PlannedRoutine {
  const capabilities = capabilityInputsFromArgs(template, args);
  const pendingCapabilities = capabilities.filter((capability) =>
    capability.approved !== true
  );
  const approvedCapabilities = capabilities.filter((capability) =>
    capability.approved === true
  );
  const defaultConfig = template.defaultConfig || {};
  const config = {
    ...defaultConfig,
    ...(objectOrUndefined(args.config) || {}),
  };
  const dashboardBindings = Array.isArray(args.dashboard_bindings)
    ? args.dashboard_bindings as RoutineDashboardBindingInput[]
    : bindingsFromTemplateSurfaces(template);
  const budgetPolicy =
    (args.budget_policy !== undefined
      ? args.budget_policy
      : template.budgetDefaults || {}) as RoutineBudgetDefaults;
  const approvalPolicy =
    (args.approval_policy !== undefined
      ? args.approval_policy
      : template.approvalPolicy || {}) as RoutineApprovalPolicy;

  const routine: RoutineCreateInput = {
    composer_app_id: template.appId,
    composer_app_slug: template.appSlug,
    template_id: template.id,
    template_version: template.appVersion ?? null,
    name: optionalString(args.name) || template.label,
    description: optionalString(args.description) ||
      template.description ||
      null,
    intent: optionalString(args.intent) || null,
    handler_function: optionalString(args.handler_function) ||
      template.handler,
    schedule: scheduleFromArgs(template, args) || { every_minutes: 5 },
    config,
    budget_policy: budgetPolicy,
    approval_policy: approvalPolicy,
    max_concurrency: typeof args.max_concurrency === "number"
      ? args.max_concurrency
      : 1,
    next_run_at: optionalString(args.next_run_at) || null,
    created_by_trace_id: optionalString(args.trace_id) || null,
    metadata: {
      ...(objectOrUndefined(args.metadata) || {}),
      source: "ul.routine",
      template_label: template.label,
      template_app_name: template.appName,
      approval_confirmed: args.approve_capabilities === true,
    },
    capabilities,
    dashboard_bindings: dashboardBindings,
  };

  return {
    template,
    routine,
    pendingCapabilities,
    approvedCapabilities,
    createArgs: {
      action: "create",
      app_id: template.appId,
      template_id: template.id,
      name: routine.name,
      schedule: routine.schedule,
      config: routine.config,
      budget_policy: routine.budget_policy,
      approve_capabilities: true,
      activate: args.activate === true,
    },
  };
}

async function planRoutine(
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const template = await resolveRoutineTemplate(userId, args);
  const plan = buildRoutinePlan(template, args);
  return {
    template: plan.template,
    routine: plan.routine,
    approvals: {
      capability_count: plan.pendingCapabilities.length +
        plan.approvedCapabilities.length,
      approved_count: plan.approvedCapabilities.length,
      pending_count: plan.pendingCapabilities.length,
      pending_capabilities: plan.pendingCapabilities,
      approve_with_create: {
        ...plan.createArgs,
        approve_capabilities: true,
      },
    },
    command_surfaces: plan.routine.dashboard_bindings || [],
    create_args: plan.createArgs,
    will_start_paused: args.activate !== true ||
      plan.pendingCapabilities.length > 0,
  };
}

async function createRoutineFromTemplate(
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const template = await resolveRoutineTemplate(userId, args);
  const plan = buildRoutinePlan(template, args);
  const activate = args.activate === true;

  if (activate && plan.pendingCapabilities.length > 0) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_INVALID_PARAMS,
      "Cannot activate a routine with pending capabilities. Pass approve_capabilities=true after user approval.",
      { pending_capabilities: plan.pendingCapabilities },
    );
  }

  let routine = await createRoutine(userId, plan.routine);
  if (activate) {
    const activeRoutine = await resumeRoutine(userId, routine.id);
    routine = { ...routine, ...activeRoutine };
  }

  return {
    routine,
    template: plan.template,
    approvals: {
      capability_count: routine.capabilities.length,
      approved_count:
        routine.capabilities.filter((capability) => capability.approved).length,
      pending_count:
        routine.capabilities.filter((capability) => !capability.approved)
          .length,
    },
    command_surfaces: routine.dashboard_bindings,
    next_step: activate
      ? "Routine is active. The durable executor will claim due runs after PR5."
      : "Routine is saved paused. Resume it when ready.",
  };
}

async function updateRoutineFromArgs(
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const routineId = requiredString(args.routine_id, "routine_id");
  const updates: Partial<RoutineCreateInput> & { status?: RoutineStatus } = {};
  for (
    const key of [
      "name",
      "description",
      "intent",
      "schedule",
      "config",
      "budget_policy",
      "approval_policy",
      "max_concurrency",
      "next_run_at",
      "metadata",
      "status",
    ] as const
  ) {
    if (args[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = args[key];
    }
  }
  const routine = await updateRoutine(userId, routineId, updates);
  return { routine };
}

async function runRoutineNow(
  userId: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const routineId = requiredString(args.routine_id, "routine_id");
  const routine = await getRoutine(userId, routineId);
  if (!routine) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_NOT_FOUND,
      `Routine ${routineId} not found`,
    );
  }
  if (routine.status === "deleted" || routine.status === "disabled") {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_INVALID_PARAMS,
      `Routine ${routineId} is ${routine.status} and cannot be queued`,
    );
  }

  const traceId = optionalString(args.trace_id) || crypto.randomUUID();
  const run = await createRoutineRun({
    routineId,
    userId,
    trigger: "manual",
    traceId,
    status: "queued",
    runConfig: objectOrUndefined(args.run_config) || {},
    metadata: {
      ...(objectOrUndefined(args.metadata) || {}),
      source: "ul.routine.run_now",
      routine_status_at_queue: routine.status,
    },
  });

  return {
    queued: true,
    run,
    routine: {
      id: routine.id,
      name: routine.name,
      status: routine.status,
      handler_function: routine.handler_function,
    },
    executor_status: "pending_pr5",
    message:
      "Run is queued. The durable routine executor added in PR5 will claim queued and due runs.",
  };
}

export async function executeRoutinePlatformAction(
  userId: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const action = requiredString(args.action, "action");
  if (!isAction(action)) {
    throw new RoutinePlatformError(
      ROUTINE_PLATFORM_INVALID_PARAMS,
      `Invalid routine action: ${action}. Use ${
        ROUTINE_PLATFORM_ACTIONS.join("|")
      }`,
    );
  }

  switch (action) {
    case "templates":
      return await listRoutineTemplates(userId, args);
    case "plan":
      return await planRoutine(userId, args);
    case "create":
      return await createRoutineFromTemplate(userId, args);
    case "list":
      return await listRoutines(userId, {
        status: args.status as RoutineStatus | undefined,
        limit: numericLimit(args.limit, 50, 100),
      });
    case "get": {
      const routineId = requiredString(args.routine_id, "routine_id");
      const routine = await getRoutine(userId, routineId);
      if (!routine) {
        throw new RoutinePlatformError(
          ROUTINE_PLATFORM_NOT_FOUND,
          `Routine ${routineId} not found`,
        );
      }
      return { routine };
    }
    case "update":
      return await updateRoutineFromArgs(userId, args);
    case "pause": {
      const routineId = requiredString(args.routine_id, "routine_id");
      return { routine: await pauseRoutine(userId, routineId) };
    }
    case "resume": {
      const routineId = requiredString(args.routine_id, "routine_id");
      return { routine: await resumeRoutine(userId, routineId) };
    }
    case "delete": {
      const routineId = requiredString(args.routine_id, "routine_id");
      return await deleteRoutine(userId, routineId);
    }
    case "run_now":
      return await runRoutineNow(userId, args);
  }
}
