import { describe, expect, it } from "vitest";
import { distillMessages } from "./distill.js";
import { PRESETS } from "./config.js";
import type { AgentMessage } from "./types.js";

function makeUser(text: string): AgentMessage {
  return { role: "user", content: [{ type: "text", text }] } as AgentMessage;
}

function makeAssistant(
  parts: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | {
        type: "toolCall";
        id: string;
        name: string;
        arguments: Record<string, unknown>;
      }
  >,
): AgentMessage {
  return {
    role: "assistant",
    content: parts,
  } as AgentMessage;
}

function makeToolResult(
  toolCallId: string,
  toolName: string,
  text: string,
): AgentMessage {
  return {
    role: "toolResult",
    toolCallId,
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
      {
        type: "toolCall",
        id: "call_1",
        name: "read",
        arguments: { path: "/foo.txt" },
      },
    ]),
    makeToolResult("call_1", "read", "file contents here"),
    makeAssistant([{ type: "text", text: "Done!" }]),
  ];
}

describe("distillMessages", () => {
  const messages = makeMessages();
  // 4 total: user, assistant(tool), toolResult, assistant(final)

  it("chat preset keeps user + final only", () => {
    const { messages: result, stats } = distillMessages(
      messages,
      PRESETS.chat.config,
    );
    expect(stats.keptMessages).toBe(2); // user + final assistant
    expect(stats.droppedMessages).toBe(2); // tool assistant + tool result
    expect(result[0].role).toBe("user");
    expect(result[1].role).toBe("assistant");
    // Final assistant only has text
    const final = result[1] as { content: Array<{ type: string }> };
    expect(final.content.every((p) => p.type === "text")).toBe(true);
  });

  it("reasoning preset keeps user + thinking + comments + final", () => {
    const { messages: result, stats } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );
    expect(stats.keptMessages).toBe(3); // user + tool assistant + final assistant
    expect(stats.droppedMessages).toBe(1); // tool result
    // Tool assistant keeps thinking + comment
    const toolAsst = result[1] as { content: Array<{ type: string }> };
    expect(toolAsst.content.length).toBe(2); // thinking + text
  });

  it("tools preset keeps user + tool calls + tool results + final", () => {
    const { messages: result, stats } = distillMessages(
      messages,
      PRESETS.tools.config,
    );
    expect(stats.keptMessages).toBe(4); // user + tool asst(call) + tool result + final asst
    expect(stats.droppedMessages).toBe(0);
    // Tool assistant has toolCall but no thinking/text
    const toolAsst = result[1] as { content: Array<{ type: string }> };
    const types = toolAsst.content.map((p) => p.type);
    expect(types).toEqual(["toolCall"]);
  });

  it("no-tools preset keeps user + comments + final (no tool trace)", () => {
    const { messages: result, stats } = distillMessages(
      messages,
      PRESETS["no-tools"].config,
    );
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

  it("keeps loaded skill reads even when tool results are otherwise excluded", () => {
    const messages = [
      makeUser("Use skill"),
      makeAssistant([
        {
          type: "toolCall",
          id: "call_skill",
          name: "read",
          arguments: {
            path: "/Users/me/.pi/agent/skills/git-committer/SKILL.md",
          },
        },
      ]),
      makeToolResult(
        "call_skill",
        "read",
        "# Git Committer\nSkill instructions",
      ),
      makeAssistant([{ type: "text", text: "Loaded" }]),
    ];

    const { messages: result } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );

    expect(result).toHaveLength(4);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("toolResult");
  });

  it("keeps AGENTS.md reads even when tool results are otherwise excluded", () => {
    const messages = [
      makeUser("Check repo instructions"),
      makeAssistant([
        {
          type: "toolCall",
          id: "call_agents",
          name: "read",
          arguments: { path: "/repo/AGENTS.md" },
        },
      ]),
      makeToolResult("call_agents", "read", "# Agent instructions"),
    ];

    const { messages: result } = distillMessages(messages, PRESETS.chat.config);

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("toolResult");
  });

  it("keeps whitelisted read results with rule truncation", () => {
    const messages = [
      makeUser("inspect package"),
      makeAssistant([
        {
          type: "toolCall",
          id: "call_pkg",
          name: "read",
          arguments: { path: "/repo/package.json" },
        },
      ]),
      makeToolResult("call_pkg", "read", "A".repeat(200)),
    ];

    const { messages: result } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("toolResult");
    const toolResult = result[2] as {
      content: Array<{ type: string; text: string }>;
    };
    const text = toolResult.content.find((p) => p.type === "text")!.text;
    expect(text.length).toBeLessThan(200);
    expect(text).toContain("[pruned");
  });

  it("keeps whitelisted AST tool results", () => {
    const messages = [
      makeUser("map file"),
      makeAssistant([
        {
          type: "toolCall",
          id: "call_ast",
          name: "ast_context_pack",
          arguments: {},
        },
      ]),
      makeToolResult("call_ast", "ast_context_pack", "symbols"),
    ];

    const { messages: result } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );

    expect(result).toHaveLength(3);
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("toolResult");
  });

  it("drops non-whitelisted tool results", () => {
    const messages = [
      makeUser("read file"),
      makeAssistant([
        {
          type: "toolCall",
          id: "call_src",
          name: "read",
          arguments: { path: "/repo/src/index.ts" },
        },
      ]),
      makeToolResult("call_src", "read", "source"),
    ];

    const { messages: result } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );

    expect(result).toHaveLength(1);
    expect(result[0].role).toBe("user");
  });

  it("truncates tool results when maxChars set", () => {
    const messages = [
      makeUser("read file"),
      makeAssistant([
        { type: "toolCall", id: "call_trunc", name: "read", arguments: {} },
      ]),
      makeToolResult("call_trunc", "read", "A".repeat(200)),
    ];
    const config = {
      ...PRESETS.tools.config,
      toolResultMaxChars: 100,
    };
    const { messages: result } = distillMessages(messages, config);
    const toolResult = result[2] as {
      content: Array<{ type: string; text: string }>;
    };
    const text = toolResult.content.find((p) => p.type === "text")!.text;
    expect(text.length).toBeLessThan(200);
    expect(text).toContain("[pruned");
  });

  it("drops tool results for tool calls that were not kept, even when they arrive first", () => {
    // Assistant has 2 tool calls: non-whitelisted bash first, whitelisted AST second
    // Tool results arrive in reverse: bash result first, ast result second
    // Bug: keepNextToolResult boolean keeps the FIRST result regardless of which call it belongs to
    const messages = [
      makeUser("explore"),
      makeAssistant([
        { type: "text", text: "Let me check..." },
        {
          type: "toolCall",
          id: "call_bash",
          name: "bash",
          arguments: { command: "ls" },
        },
        {
          type: "toolCall",
          id: "call_ast",
          name: "ast_context_pack",
          arguments: {},
        },
      ]),
      makeToolResult("call_bash", "bash", "src test"),
      makeToolResult("call_ast", "ast_context_pack", "symbols"),
    ];

    const { messages: result } = distillMessages(
      messages,
      PRESETS.reasoning.config,
    );

    // ast call + comment kept, bash call dropped
    // ast result kept (whitelisted), bash result dropped (not whitelisted)
    expect(result).toHaveLength(3); // user + asst(ast call+comment) + ast result
    expect(result[1].role).toBe("assistant");
    expect(result[2].role).toBe("toolResult");
    expect((result[2] as { toolCallId?: string }).toolCallId).toBe("call_ast");
  });
});
