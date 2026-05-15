import { describe, expect, it } from "vitest";
import { distillMessages } from "../src/distill.js";
import { PRESETS } from "../src/config.js";
import type { AgentMessage } from "../src/types.js";

function makeUser(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function makeAssistant(
	parts: Array<
		| { type: "text"; text: string }
		| { type: "thinking"; thinking: string }
		| { type: "toolCall"; name: string; arguments: Record<string, unknown> }
	>,
): AgentMessage {
	return {
		role: "assistant",
		content: parts,
	} as AgentMessage;
}

function makeToolResult(toolName: string, text: string): AgentMessage {
	return {
		role: "toolResult",
		toolName,
		content: [{ type: "text", text }],
	} as AgentMessage;
}

function makeMessages() {
	return [
		makeUser("Hello"),
		makeAssistant([
			{ type: "thinking", thinking: "Let me think about this" },
			{ type: "text", text: "I'll help you with that" },
			{ type: "toolCall", name: "read", arguments: { path: "/foo.txt" } },
		]),
		makeToolResult("read", "file contents here"),
		makeAssistant([{ type: "text", text: "Done!" }]),
	];
}

describe("distillMessages", () => {
	const messages = makeMessages();
	// 4 total: user, assistant(tool), toolResult, assistant(final)

	it("chat preset keeps user + final only", () => {
		const { messages: result, stats } = distillMessages(messages, PRESETS.chat.config);
		expect(stats.keptMessages).toBe(2); // user + final assistant
		expect(stats.droppedMessages).toBe(2); // tool assistant + tool result
		expect(result[0].role).toBe("user");
		expect(result[1].role).toBe("assistant");
		// Final assistant only has text
		const final = result[1] as { content: Array<{ type: string }> };
		expect(final.content.every((p) => p.type === "text")).toBe(true);
	});

	it("reasoning preset keeps user + thinking + comments + final", () => {
		const { messages: result, stats } = distillMessages(messages, PRESETS.reasoning.config);
		expect(stats.keptMessages).toBe(3); // user + tool assistant + final assistant
		expect(stats.droppedMessages).toBe(1); // tool result
		// Tool assistant keeps thinking + comment
		const toolAsst = result[1] as { content: Array<{ type: string }> };
		expect(toolAsst.content.length).toBe(2); // thinking + text
	});

	it("tools preset keeps user + tool calls + tool results + final", () => {
		const { messages: result, stats } = distillMessages(messages, PRESETS.tools.config);
		expect(stats.keptMessages).toBe(4); // user + tool asst(call) + tool result + final asst
		expect(stats.droppedMessages).toBe(0);
		// Tool assistant has toolCall but no thinking/text
		const toolAsst = result[1] as { content: Array<{ type: string }> };
		const types = toolAsst.content.map((p) => p.type);
		expect(types).toEqual(["toolCall"]);
	});

	it("no-tools preset keeps user + comments + final (no tool trace)", () => {
		const { messages: result, stats } = distillMessages(messages, PRESETS["no-tools"].config);
		expect(stats.keptMessages).toBe(3); // user + tool assistant (comment) + final assistant
		// Tool assistant has comment text but no tool calls
		const toolAsst = result[1] as { content: Array<{ type: string }> };
		const hasToolCall = toolAsst.content.some((p) => p.type === "toolCall");
		expect(hasToolCall).toBe(false);
	});

	it("respects user exclusion", () => {
		const config = { ...PRESETS.chat.config, includeUser: false };
		const { messages: result } = distillMessages(messages, config);
		expect(result.every((m) => m.role !== "user")).toBe(true);
	});

	it("returns empty stats when nothing matched", () => {
		const config = {
			...PRESETS.chat.config,
			includeUser: false,
			includeAssistantFinal: false,
		};
		const { messages: result, stats } = distillMessages(messages, config);
		expect(result).toHaveLength(0);
		expect(stats.keptMessages).toBe(0);
		expect(stats.sourceMessages).toBe(4);
	});

	it("truncates tool results when maxChars set", () => {
		const messages = [
			makeUser("read file"),
			makeAssistant([{ type: "toolCall", name: "read", arguments: {} }]),
			makeToolResult("read", "A".repeat(200)),
		];
		const config = {
			...PRESETS.tools.config,
			toolResultMaxChars: 100,
		};
		const { messages: result } = distillMessages(messages, config);
		const toolResult = result[2] as { content: Array<{ type: string; text: string }> };
		const text = toolResult.content.find((p) => p.type === "text")!.text;
		expect(text.length).toBeLessThan(200);
		expect(text).toContain("[pruned");
	});
});
