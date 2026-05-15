import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { Usage } from "@mariozechner/pi-ai";
import type {
	AgentMessage,
	AssistantMessage,
	ImageContent,
	Message,
	PruneConfig,
	PruneStats,
	TextContent,
	ToolResultMessage,
	UserMessage,
} from "./types.js";

const ZERO_USAGE: Usage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function isUser(m: AgentMessage): m is UserMessage {
	return m.role === "user";
}
function isAssistant(m: AgentMessage): m is AssistantMessage {
	return m.role === "assistant";
}
function isToolResult(m: AgentMessage): m is ToolResultMessage {
	return m.role === "toolResult";
}

function trimText(text: string): string {
	return text.replace(/\r\n/g, "\n").trim();
}

function truncateText(text: string, maxChars: number, mode: "head" | "tail"): string {
	if (text.length <= maxChars) return text;
	if (mode === "tail") {
		return `[pruned: kept last ${maxChars}/${text.length} chars]\n${text.slice(-maxChars)}`;
	}
	return `${text.slice(0, maxChars)}\n[pruned: kept first ${maxChars}/${text.length} chars]`;
}

function approxTokens(messages: AgentMessage[]): number {
	return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

export function distillMessages(
	messages: AgentMessage[],
	config: PruneConfig,
): { messages: Message[]; stats: PruneStats } {
	const result: Message[] = [];
	const stats: PruneStats = {
		sourceMessages: messages.length,
		keptMessages: 0,
		droppedMessages: 0,
		sourceApproxTokens: approxTokens(messages),
		keptApproxTokens: 0,
	};

	for (const message of messages) {
		if (isUser(message)) {
			if (!config.includeUser) {
				stats.droppedMessages++;
				continue;
			}
			result.push({ ...message });
			stats.keptMessages++;
			continue;
		}

		if (isAssistant(message)) {
			const hasToolCall = message.content.some((p) => p.type === "toolCall");
			const kept: AssistantMessage["content"] = [];

			for (const part of message.content) {
				if (
					part.type === "thinking" &&
					config.includeAssistantThinking &&
					trimText(part.thinking)
				) {
					kept.push({ ...part });
				}
				if (part.type === "text" && trimText(part.text)) {
					if (hasToolCall && config.includeAssistantComment) kept.push({ ...part });
					if (!hasToolCall && config.includeAssistantFinal) kept.push({ ...part });
				}
				if (part.type === "toolCall" && config.includeToolCalls) {
					kept.push(part);
				}
			}

			if (kept.length === 0) {
				stats.droppedMessages++;
				continue;
			}

			result.push({
				...message,
				content: kept,
				usage: ZERO_USAGE,
				stopReason: kept.some((p) => p.type === "toolCall") ? "toolUse" : "stop",
				errorMessage: undefined,
			});
			stats.keptMessages++;
			continue;
		}

		if (isToolResult(message)) {
			if (!config.includeToolResults) {
				stats.droppedMessages++;
				continue;
			}

			let content = [...message.content];
			if (config.toolResultMaxChars) {
				const images = content.filter((p): p is ImageContent => p.type === "image");
				const text = content
					.filter((p): p is TextContent => p.type === "text")
					.map((p) => p.text)
					.join("\n\n");
				const truncated = truncateText(
					text,
					config.toolResultMaxChars,
					config.toolResultTruncation,
				);
				content = [{ type: "text", text: truncated }, ...images];
			}

			result.push({ ...message, content, details: { __pruned: true } });
			stats.keptMessages++;
			continue;
		}

		// Drop unknown message types
		stats.droppedMessages++;
	}

	stats.keptApproxTokens = approxTokens(result as unknown as AgentMessage[]);
	return { messages: result, stats };
}
