import type { ResolvedInferenceRoute } from "./inference-route.ts";

const DEFAULT_REFERER = "https://ultralight-api.rgn4jz429m.workers.dev";

export interface InferenceFetchOptions {
  title?: string;
  referer?: string;
}

export function selectInferenceModel(
  route: ResolvedInferenceRoute,
  requestedModel?: string | null,
): string {
  if (route.billingMode === "byok") {
    return route.model;
  }

  return requestedModel?.trim() || route.model;
}

export function getInferenceChatCompletionsUrl(route: ResolvedInferenceRoute): string {
  return `${route.baseUrl.replace(/\/$/, "")}/chat/completions`;
}

export function buildInferenceHeaders(
  route: ResolvedInferenceRoute,
  options: InferenceFetchOptions = {},
): Record<string, string> {
  return {
    "Authorization": `Bearer ${route.apiKey}`,
    "Content-Type": "application/json",
    "HTTP-Referer": options.referer || DEFAULT_REFERER,
    "X-Title": options.title || "Ultralight",
  };
}

export function fetchInferenceChatCompletion(
  route: ResolvedInferenceRoute,
  body: Record<string, unknown>,
  options: InferenceFetchOptions = {},
): Promise<Response> {
  return fetch(getInferenceChatCompletionsUrl(route), {
    method: "POST",
    headers: buildInferenceHeaders(route, options),
    body: JSON.stringify(body),
  });
}
