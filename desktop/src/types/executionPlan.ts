export interface ToolUsed {
  appId: string;
  appName: string;
  appSlug: string;
  origin: 'library' | 'marketplace';
  fnName: string;
  args: Record<string, unknown>;
  cost_light: number;
}

export interface ExecutionPlan {
  id: string;
  conversation_id: string;
  message_id: string;
  recipe: string;
  tools_used: ToolUsed[];
  total_cost_light: number;
  created_at: number;
  window_seconds: number;
  fire_at?: number;
  status: 'pending' | 'executing' | 'completed' | 'cancelled';
  result?: string;
  fired_at?: number;
  completed_at?: number;
}
