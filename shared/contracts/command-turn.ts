import type {
  AgenticInterfaceAction,
  AgenticInterfaceSpec,
} from "./agentic-interface.ts";

export type NextStep =
  | {
    id: string;
    kind: "suggest_prompt";
    label: string;
    prompt: string;
    suggestion_id?: string;
    suggestion_set_id?: string;
  }
  | {
    id: string;
    kind: "action";
    label: string;
    action: AgenticInterfaceAction;
    preview: boolean;
    suggestion_id?: string;
    suggestion_set_id?: string;
  };

export interface NextStepsTurnArtifact {
  id: string;
  kind: "next_steps";
  steps: NextStep[];
  created_at: number;
  source: "orchestrate";
}

export interface InterfaceTurnArtifact {
  id: string;
  kind: "interface";
  spec: AgenticInterfaceSpec;
  created_at: number;
  source: "orchestrate";
}

export type ChatTurnArtifact = NextStepsTurnArtifact | InterfaceTurnArtifact;
