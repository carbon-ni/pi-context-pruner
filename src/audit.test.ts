import { describe, expect, it } from "vitest";
import {
  auditContext,
  dedupeSystemPrompt,
  type AuditInput,
  type AuditReport,
} from "./audit.js";
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

function tokenOf(report: AuditReport, label: string): number {
  return report.breakdown.find((b) => b.label === label)?.tokens ?? 0;
}

describe("auditContext", () => {
  it("classifies system prompt as initial setup", () => {
    const input: AuditInput = {
      systemPrompt: "You are a helpful assistant with many instructions.",
      messages: [
        makeUser("hello"),
        makeAssistant([{ type: "text", text: "hi" }]),
      ],
    };

    const report = auditContext(input);

    expect(report.totalTokens).toBeGreaterThan(0);
    expect(report.initialTokens).toBeGreaterThan(0);
    expect(report.conversationTokens).toBeGreaterThan(0);
    expect(tokenOf(report, "system_prompt (base)")).toBeGreaterThan(0);
  });

  it("classifies pre-first-user tool calls as setup (AGENTS.md, SKILL.md)", () => {
    const input: AuditInput = {
      systemPrompt: "system",
      messages: [
        makeAssistant([
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { path: "/repo/AGENTS.md" },
          },
        ]),
        makeToolResult(
          "c1",
          "read",
          "# Agent instructions\nlong content here...".repeat(20),
        ),
        makeAssistant([
          {
            type: "toolCall",
            id: "c2",
            name: "read",
            arguments: { path: "/skills/foo/SKILL.md" },
          },
        ]),
        makeToolResult(
          "c2",
          "read",
          "# Skill instructions\nmore content...".repeat(10),
        ),
        makeUser("Now do the real work"),
        makeAssistant([{ type: "text", text: "Working on it" }]),
      ],
    };

    const report = auditContext(input);

    expect(report.initialTokens).toBeGreaterThan(report.conversationTokens);
    // Per-path breakdown instead of lumped setup_instructions
    expect(tokenOf(report, "/repo/AGENTS.md")).toBeGreaterThan(0);
    expect(tokenOf(report, "/skills/foo/SKILL.md")).toBeGreaterThan(0);
  });

  it("classifies pre-first-user tool calls without known instruction paths as other_setup", () => {
    const input: AuditInput = {
      systemPrompt: "system",
      messages: [
        makeAssistant([
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "ls" },
          },
        ]),
        makeToolResult("c1", "bash", "file1.txt\nfile2.txt"),
        makeUser("continue"),
        makeAssistant([{ type: "text", text: "ok" }]),
      ],
    };

    const report = auditContext(input);

    expect(tokenOf(report, "other_setup")).toBeGreaterThan(0);
    // No instruction reads, so no path-based entries
    expect(
      report.breakdown.every(
        (b) => b.category !== "setup_instruction" || b.label.startsWith("/"),
      ),
    ).toBe(true);
  });

  it("breaks conversation by category", () => {
    const input: AuditInput = {
      systemPrompt: "system",
      messages: [
        makeUser("hello"),
        makeAssistant([{ type: "thinking", thinking: "let me think..." }]),
        makeAssistant([
          { type: "text", text: "I will run bash" },
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "echo hi" },
          },
        ]),
        makeToolResult("c1", "bash", "hi"),
        makeAssistant([{ type: "text", text: "Done" }]),
      ],
    };

    const report = auditContext(input);

    expect(tokenOf(report, "user")).toBeGreaterThan(0);
    expect(tokenOf(report, "assistant_thinking")).toBeGreaterThan(0);
    expect(tokenOf(report, "assistant_comment")).toBeGreaterThan(0);
    expect(tokenOf(report, "tool_call")).toBeGreaterThan(0);
    expect(tokenOf(report, "tool_result")).toBeGreaterThan(0);
    expect(tokenOf(report, "assistant_final")).toBeGreaterThan(0);
  });

  it("ranks top consumers", () => {
    const longResult = "x".repeat(5000);
    const input: AuditInput = {
      systemPrompt: "system",
      messages: [
        makeUser("go"),
        makeAssistant([
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "run" },
          },
        ]),
        makeToolResult("c1", "bash", longResult),
        makeAssistant([{ type: "text", text: "done" }]),
      ],
    };

    const report = auditContext(input);

    expect(report.topConsumers.length).toBeGreaterThan(0);
    expect(report.topConsumers[0].tokens).toBeGreaterThan(0);
    // tool_result with 5000 chars should be the biggest
    expect(report.topConsumers[0].category).toBe("tool_result");
  });

  it("handles empty messages", () => {
    const input: AuditInput = {
      systemPrompt: "",
      messages: [],
    };

    const report = auditContext(input);

    expect(report.totalTokens).toBe(0);
    expect(report.initialTokens).toBe(0);
    expect(report.conversationTokens).toBe(0);
    expect(report.breakdown).toEqual([]);
    expect(report.topConsumers).toEqual([]);
  });

  it("handles no system prompt", () => {
    const input: AuditInput = {
      messages: [makeUser("hello")],
    };

    const report = auditContext(input);

    expect(report.totalTokens).toBeGreaterThan(0);
    expect(tokenOf(report, "system_prompt (base)")).toBe(0);
  });

  it("all tokens add up to total", () => {
    const input: AuditInput = {
      systemPrompt: "system prompt here",
      messages: [
        makeAssistant([
          {
            type: "toolCall",
            id: "c1",
            name: "read",
            arguments: { path: "/AGENTS.md" },
          },
        ]),
        makeToolResult("c1", "read", "agent stuff"),
        makeUser("do work"),
        makeAssistant([{ type: "text", text: "ok" }]),
      ],
    };

    const report = auditContext(input);

    const sumBreakdown = report.breakdown.reduce((s, b) => s + b.tokens, 0);
    expect(sumBreakdown).toBe(report.totalTokens);
    expect(report.initialTokens + report.conversationTokens).toBe(
      report.totalTokens,
    );
    // Per-path entry for AGENTS.md
    expect(tokenOf(report, "/AGENTS.md")).toBeGreaterThan(0);
  });

  it("parses system prompt into sections (project context, skills)", () => {
    const input: AuditInput = {
      systemPrompt: [
        "You are an expert coding assistant.",
        "",
        "# Project Context",
        "",
        "Project-specific instructions and guidelines:",
        "",
        "## /repo/AGENTS.md",
        "",
        "Always write tests first.",
        "",
        "## /home/.pi/agent/agents/AGENTS.md",
        "",
        "Be proactive. Be concise.",
        "",
        "<available_skills>",
        "  <skill>",
        "    <name>codebase-explorer</name>",
        "    <description>Explore code</description>",
        "  </skill>",
        "</available_skills>",
        "",
        "Current date: 2026-05-30",
        "Current working directory: /repo",
      ].join("\n"),
      messages: [makeUser("go")],
    };

    const report = auditContext(input);

    // Should have separate sections
    expect(tokenOf(report, "system_prompt (base)")).toBeGreaterThan(0);
    expect(tokenOf(report, "/repo/AGENTS.md")).toBeGreaterThan(0);
    expect(tokenOf(report, "/home/.pi/agent/agents/AGENTS.md")).toBeGreaterThan(
      0,
    );
    expect(tokenOf(report, "skills (list)")).toBeGreaterThan(0);

    // All tokens add up
    const sumBreakdown = report.breakdown.reduce((s, b) => s + b.tokens, 0);
    expect(sumBreakdown).toBe(report.totalTokens);
  });

  it("reports duplicate system prompt sections", () => {
    const duplicated = "same instruction body".repeat(20);
    const report = auditContext({
      systemPrompt: [
        "base",
        "# Project Context",
        "## /one/AGENTS.md",
        duplicated,
        "## /two/AGENTS.md",
        duplicated,
      ].join("\n"),
      messages: [makeUser("hello")],
    });

    expect(report.duplicates).toHaveLength(1);
    expect(report.duplicates[0].labels).toEqual([
      "/one/AGENTS.md",
      "/two/AGENTS.md",
    ]);
    expect(report.duplicates[0].wastedTokens).toBeGreaterThan(0);
  });

  it("deduplicates repeated system prompt sections by content", () => {
    const duplicated = "same instruction body".repeat(20);
    const prompt = [
      "base",
      "# Project Context",
      "## /one/AGENTS.md",
      duplicated,
      "## /two/AGENTS.md",
      duplicated,
      "<available_skills>",
      "</available_skills>",
    ].join("\n");

    const result = dedupeSystemPrompt(prompt);

    expect(result.removedTokens).toBeGreaterThan(0);
    expect(result.systemPrompt).toContain("## /one/AGENTS.md");
    expect(result.systemPrompt).not.toContain("## /two/AGENTS.md");
    expect(result.systemPrompt).toContain("<available_skills>");
  });

  it("computes savings for reasoning preset", () => {
    const input: AuditInput = {
      systemPrompt: "system",
      messages: [
        makeAssistant([
          {
            type: "toolCall",
            id: "c1",
            name: "bash",
            arguments: { command: "echo hi" },
          },
        ]),
        makeToolResult("c1", "bash", "x".repeat(2000)),
        makeUser("do work"),
        makeAssistant([{ type: "text", text: "ok" }]),
      ],
    };

    const report = auditContext(input);

    expect(report.savings).toBeDefined();
    // reasoning preset drops tool calls + tool results (no loaded instruction reads)
    expect(report.savings!.reasoningPreset.tokens).toBeGreaterThan(0);
    expect(report.savings!.reasoningPreset.percent).toBeGreaterThan(0);
    expect(report.savings!.reasoningPreset.tokens).toBeLessThan(
      report.totalTokens,
    );
  });
});
