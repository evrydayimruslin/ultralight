import type { AIRequest, AIResponse, ChatUsage } from "../../shared/contracts/ai.ts";
import type { RuntimeAIRoute } from "../runtime/sandbox.ts";
import { createAIService } from "./ai.ts";
import { deductChatCost } from "./chat-billing.ts";
import { selectInferenceModel } from "./inference-client.ts";
import {
  InferenceRouteError,
  resolveInferenceRoute,
  type ResolvedInferenceRoute,
} from "./inference-route.ts";

export interface RuntimeAIService {
  call(request: AIRequest, apiKey?: string): Promise<AIResponse>;
}

export interface RuntimeAIContext {
  route: RuntimeAIRoute | null;
  resolvedRoute: ResolvedInferenceRoute | null;
  aiService: RuntimeAIService;
  userApiKey: string | null;
}

export interface RuntimeAIUser {
  id: string;
  email: string;
}

function emptyAIResponse(model: string, errorMessage: string): AIResponse {
  return {
    content: "",
    model,
    usage: { input_tokens: 0, output_tokens: 0, cost_light: 0 },
    error: errorMessage,
  };
}

export function createUnavailableAIService(errorMessage: string): RuntimeAIService {
  return {
    call: async (request: AIRequest) => emptyAIResponse(request.model || "none", errorMessage),
  };
}

function toRuntimeAIRoute(route: ResolvedInferenceRoute): RuntimeAIRoute {
  return {
    provider: route.provider,
    baseUrl: route.baseUrl,
    apiKey: route.apiKey,
    model: route.model,
    shouldDebitLight: route.shouldDebitLight,
  };
}

function toChatUsage(response: AIResponse): ChatUsage {
  const promptTokens = response.usage.input_tokens || 0;
  const completionTokens = response.usage.output_tokens || 0;
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  };
}

export function createRoutedRuntimeAIService(
  route: ResolvedInferenceRoute,
  userId: string,
): RuntimeAIService {
  const service = createAIService(route.provider, route.apiKey, route.model);

  return {
    call: async (request: AIRequest): Promise<AIResponse> => {
      const model = selectInferenceModel(route, request.model);
      const response = await service.call({ ...request, model });
      const usage = toChatUsage(response);

      if (route.shouldDebitLight && usage.total_tokens > 0) {
        try {
          const billing = await deductChatCost(userId, usage, response.model || model);
          response.usage.cost_light = billing.cost_light;
        } catch (err) {
          console.error("[RUNTIME-AI] Failed to debit Light for AI call:", err);
        }
      }

      return response;
    },
  };
}

function routeErrorMessage(error: unknown): string {
  if (error instanceof InferenceRouteError) {
    if (error.code === "byok_key_missing") {
      return "BYOK is enabled, but the API key could not be loaded. Please re-add your API key in Settings.";
    }
    return error.message;
  }

  return error instanceof Error ? error.message : "AI service unavailable";
}

export async function createRuntimeAIContext(
  user: RuntimeAIUser | null | undefined,
): Promise<RuntimeAIContext> {
  if (!user) {
    const message = "AI requires an authenticated user.";
    return {
      route: null,
      resolvedRoute: null,
      aiService: createUnavailableAIService(message),
      userApiKey: null,
    };
  }

  try {
    const route = await resolveInferenceRoute({
      userId: user.id,
      userEmail: user.email,
    });

    return {
      route: toRuntimeAIRoute(route),
      resolvedRoute: route,
      aiService: createRoutedRuntimeAIService(route, user.id),
      userApiKey: route.apiKey,
    };
  } catch (error) {
    const message = routeErrorMessage(error);
    return {
      route: null,
      resolvedRoute: null,
      aiService: createUnavailableAIService(message),
      userApiKey: null,
    };
  }
}
