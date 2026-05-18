import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getConfigPaths, loadConfig } from "../src/config.js";
import { distillMessages } from "../src/distill.js";
import type { AgentMessage } from "../src/types.js";

function makeUser(text: string): AgentMessage {
	return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function makeAssistantToolCall(name: string): AgentMessage {
	return { role: "assistant", content: [{ type: "toolCall", name, arguments: {} }] } as AgentMessage;
}

function makeToolResult(toolName: string, text: string): AgentMessage {
	return { role: "toolResult", toolName, content: [{ type: "text", text }] } as AgentMessage;
}

describe("config file loading", () => {
	it("uses local .pi/context-pruner.json over global ~/.pi/agent/context-pruner.json", () => {
		const cwd = mkdtempSync(join(tmpdir(), "context-pruner-cwd-"));
		const home = mkdtempSync(join(tmpdir(), "context-pruner-home-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		mkdirSync(join(home, ".pi", "agent"), { recursive: true });
		writeFileSync(
			join(home, ".pi", "agent", "context-pruner.json"),
			JSON.stringify({ toolResultMaxChars: 10, includeToolResults: true }),
		);
		writeFileSync(
			join(cwd, ".pi", "context-pruner.json"),
			JSON.stringify({ toolResultMaxChars: 20, includeToolResults: false }),
		);

		const config = loadConfig({ cwd, home });

		expect(config.toolResultMaxChars).toBe(20);
		expect(config.includeToolResults).toBe(false);
	});

	it("exposes the local and global config paths", () => {
		const paths = getConfigPaths({ cwd: "/repo", home: "/home/me" });

		expect(paths.local).toBe("/repo/.pi/context-pruner.json");
		expect(paths.global).toBe("/home/me/.pi/agent/context-pruner.json");
	});

	it("falls back to defaults and warns when config JSON is malformed", () => {
		const cwd = mkdtempSync(join(tmpdir(), "context-pruner-bad-cwd-"));
		const home = mkdtempSync(join(tmpdir(), "context-pruner-bad-home-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "context-pruner.json"), "{");
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

		const config = loadConfig({ cwd, home });

		expect(config.includeUser).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Failed to load context-pruner config"),
			expect.any(Error),
		);
		warn.mockRestore();
	});

	it("supports wildcard tool names from JSON config", () => {
		const cwd = mkdtempSync(join(tmpdir(), "context-pruner-wildcard-cwd-"));
		const home = mkdtempSync(join(tmpdir(), "context-pruner-wildcard-home-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "context-pruner.json"),
			JSON.stringify({ toolResultKeepRules: [{ tool: "ast_*" }, { tool: "code_*" }] }),
		);
		const messages = [
			makeUser("explore"),
			makeAssistantToolCall("ast_context_pack"),
			makeToolResult("ast_context_pack", "symbols"),
			makeAssistantToolCall("code_symbol_context"),
			makeToolResult("code_symbol_context", "context"),
		];

		const { messages: result } = distillMessages(messages, loadConfig({ cwd, home }));

		expect(result).toHaveLength(5);
	});
});
