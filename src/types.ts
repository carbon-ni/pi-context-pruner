import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type {
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
} from "@mariozechner/pi-ai";

export type PrunePreset = "chat" | "reasoning" | "tools" | "no-tools";
export type TruncationMode = "head" | "tail";

export type MessageCategory =
  | "user"
  | "assistant_thinking"
  | "assistant_comment"
  | "assistant_final"
  | "tool_call"
  | "tool_result";

export interface ToolKeepRule {
  tool: string | RegExp;
  args?: {
    pathEndsWith?: string[];
    pathIncludes?: string[];
  };
  maxChars?: number;
}

export interface PruneConfig {
  includeUser: boolean;
  includeAssistantThinking: boolean;
  includeAssistantComment: boolean;
  includeAssistantFinal: boolean;
  includeToolCalls: boolean;
  includeToolResults: boolean;
  includeLoadedInstructions: boolean;
  toolResultKeepRules: ToolKeepRule[];
  toolResultMaxChars?: number;
  toolResultTruncation: TruncationMode;
}

export interface PruneStats {
  sourceMessages: number;
  keptMessages: number;
  droppedMessages: number;
  sourceApproxTokens: number;
  keptApproxTokens: number;
}

export interface CategoryMeta {
  key: MessageCategory;
  label: string;
  get(config: PruneConfig): boolean;
  set(config: PruneConfig, enabled: boolean): void;
}

// Re-export for convenience
export type {
  AgentMessage,
  AssistantMessage,
  ImageContent,
  Message,
  TextContent,
  ToolCall,
  ToolResultMessage,
  UserMessage,
};
