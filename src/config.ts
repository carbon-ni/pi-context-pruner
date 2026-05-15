import type { PruneConfig, PrunePreset, CategoryMeta } from "./types.js";

export const DEFAULT_CONFIG: PruneConfig = {
	includeUser: true,
	includeAssistantThinking: false,
	includeAssistantComment: false,
	includeAssistantFinal: true,
	includeToolCalls: false,
	includeToolResults: false,
	toolResultTruncation: "head",
};

export const PRESETS: Record<PrunePreset, { description: string; config: PruneConfig }> = {
	chat: {
		description: "user + assistant final only",
		config: { ...DEFAULT_CONFIG },
	},
	reasoning: {
		description: "user + thinking + comments + final",
		config: {
			...DEFAULT_CONFIG,
			includeAssistantThinking: true,
			includeAssistantComment: true,
		},
	},
	tools: {
		description: "user + tool calls + tool results",
		config: {
			...DEFAULT_CONFIG,
			includeToolCalls: true,
			includeToolResults: true,
		},
	},
	"no-tools": {
		description: "user + comments + final (no tool trace)",
		config: {
			...DEFAULT_CONFIG,
			includeAssistantComment: true,
		},
	},
};

export const CATEGORY_META: CategoryMeta[] = [
	{
		key: "user",
		label: "User messages",
		get: (c) => c.includeUser,
		set: (c, v) => {
			c.includeUser = v;
		},
	},
	{
		key: "assistant_thinking",
		label: "Assistant thinking",
		get: (c) => c.includeAssistantThinking,
		set: (c, v) => {
			c.includeAssistantThinking = v;
		},
	},
	{
		key: "assistant_comment",
		label: "Assistant comments (tool turns)",
		get: (c) => c.includeAssistantComment,
		set: (c, v) => {
			c.includeAssistantComment = v;
		},
	},
	{
		key: "assistant_final",
		label: "Assistant final messages",
		get: (c) => c.includeAssistantFinal,
		set: (c, v) => {
			c.includeAssistantFinal = v;
		},
	},
	{
		key: "tool_call",
		label: "Tool calls",
		get: (c) => c.includeToolCalls,
		set: (c, v) => {
			c.includeToolCalls = v;
		},
	},
	{
		key: "tool_result",
		label: "Tool results",
		get: (c) => c.includeToolResults,
		set: (c, v) => {
			c.includeToolResults = v;
		},
	},
];

export function cloneConfig(config: PruneConfig): PruneConfig {
	return { ...config };
}

export function parsePreset(args: string): PrunePreset | "last" | undefined {
	const token = args.trim().toLowerCase();
	if (!token) return undefined;
	if (token === "last") return "last";
	if (token in PRESETS) return token as PrunePreset;
	return undefined;
}
