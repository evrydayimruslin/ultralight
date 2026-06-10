import type {
  AccessPolicyRuntimeEvaluationRequest,
  AccessPolicyRuntimeEvaluator,
} from './access-policy.ts';
import { executeInDynamicSandbox } from '../runtime/dynamic-sandbox.ts';
import type {
  AIService,
  AppDataService,
  ExecutionResult,
  RuntimeConfig,
  UserContext,
} from '../runtime/sandbox.ts';
import type { ToolAccessPolicyPlanPayload } from '../../shared/contracts/manifest.ts';

export interface RuntimeAccessPolicyApp {
  id: string;
  owner_id: string;
  slug?: string | null;
}

export interface RuntimeAccessPolicyExecutorOptions {
  app: RuntimeAccessPolicyApp;
  user?: UserContext | null;
  timeoutMs?: number;
  executeInSandbox?: typeof executeInDynamicSandbox;
}

export function createRuntimeAccessPolicyExecutor(
  options: RuntimeAccessPolicyExecutorOptions,
): AccessPolicyRuntimeEvaluator {
  return async (request) => {
    const manifestPolicy = request.manifestPolicy;
    if (manifestPolicy.mode !== 'module' || !manifestPolicy.exportName) {
      throw new Error('No executable access policy is declared');
    }

    const executor = options.executeInSandbox ?? executeInDynamicSandbox;
    const result = await executor(
      buildPolicyRuntimeConfig(options, request),
      manifestPolicy.exportName,
      [buildPolicyPayload(request)],
    );
    if (!result.success) {
      throw new Error(result.error?.message || 'Policy execution failed');
    }
    return result.result;
  };
}

function buildPolicyRuntimeConfig(
  options: RuntimeAccessPolicyExecutorOptions,
  request: AccessPolicyRuntimeEvaluationRequest,
): RuntimeConfig {
  return {
    appId: options.app.id,
    userId: request.context.caller.userId,
    ownerId: options.app.owner_id,
    executionId: crypto.randomUUID(),
    code: '',
    permissions: [],
    userApiKey: null,
    aiRoute: null,
    user: options.user || null,
    appDataService: unavailableAppDataService,
    d1DataService: null,
    memoryService: null,
    aiService: unavailableAiService,
    envVars: {},
    timeoutMs: options.timeoutMs ?? 2_000,
  };
}

function buildPolicyPayload(
  request: AccessPolicyRuntimeEvaluationRequest,
): ToolAccessPolicyPlanPayload {
  const staticDecision = request.staticDecision;
  return {
    version: 1,
    app: {
      id: request.context.app.id,
      slug: request.context.app.slug || null,
      ownerId: request.context.app.owner_id,
      owner_id: request.context.app.owner_id,
    },
    caller: request.context.caller,
    subject: request.context.subject,
    input: request.context.input || {},
    metadata: request.context.metadata || {},
    static: {
      effect: staticDecision.effect,
      subjectKind: staticDecision.subjectKind,
      subject_kind: staticDecision.subjectKind,
      subjectId: staticDecision.subjectId,
      subject_id: staticDecision.subjectId,
      priceLight: staticDecision.priceLight,
      price_light: staticDecision.priceLight,
      chargeLight: staticDecision.chargeLight,
      charge_light: staticDecision.chargeLight,
      free: staticDecision.free,
      freeQuotaLimit: staticDecision.freeQuotaLimit,
      free_quota_limit: staticDecision.freeQuotaLimit,
      freeQuotaCounterKey: staticDecision.freeQuotaCounterKey,
      free_quota_counter_key: staticDecision.freeQuotaCounterKey,
      selfAccess: staticDecision.selfAccess,
      self_access: staticDecision.selfAccess,
    },
  };
}

const unavailableAppDataService: AppDataService = {
  async store(): Promise<void> {
    throw new Error('Storage is not available in access policy execution');
  },
  async load(): Promise<unknown> {
    throw new Error('Storage is not available in access policy execution');
  },
  async remove(): Promise<void> {
    throw new Error('Storage is not available in access policy execution');
  },
  async list(): Promise<string[]> {
    throw new Error('Storage is not available in access policy execution');
  },
  async query(): Promise<never[]> {
    throw new Error('Storage is not available in access policy execution');
  },
  async batchStore(): Promise<void> {
    throw new Error('Storage is not available in access policy execution');
  },
  async batchLoad(): Promise<never[]> {
    throw new Error('Storage is not available in access policy execution');
  },
  async batchRemove(): Promise<void> {
    throw new Error('Storage is not available in access policy execution');
  },
};

const unavailableAiService: AIService = {
  async call(): Promise<never> {
    throw new Error('AI is not available in access policy execution');
  },
};

export type RuntimeAccessPolicyExecutionResult = ExecutionResult;
