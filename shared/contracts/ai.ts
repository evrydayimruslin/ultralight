export interface AITextPart {
  type: 'text';
  text: string;
}

export interface AIFilePart {
  type: 'file';
  data: string;
  filename?: string;
}

export type AIContentPart = AITextPart | AIFilePart;

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | AIContentPart[];
  cache_control?: { type: 'ephemeral' };
}

export interface AITool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AIRequest {
  model?: string;
  messages: AIMessage[];
  temperature?: number;
  max_tokens?: number;
  tools?: AITool[];
}

export interface AIUsage {
  input_tokens: number;
  output_tokens: number;
  cost_light: number;
}

export interface AIResponse {
  content: string;
  model: string;
  usage: AIUsage;
  error?: string;
}

export interface ChatStreamRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatTool[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ChatTool {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatBillingResult {
  cost_light: number;
  balance_after: number;
  was_depleted: boolean;
}

export const CHAT_MIN_BALANCE_LIGHT = 50;
export const CHAT_PLATFORM_MARKUP = 1.2;
