import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { describe, expect, it, vi } from "vitest";
import contextPruneExtension from "./index.js";

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};

type RegisteredHandler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<unknown> | unknown;

function makeMessages(): AgentMessage[] {
  return [
    { role: "user", content: "Keep this request" } as AgentMessage,
    {
      role: "assistant",
      content: [
        { type: "text", text: "I will inspect this." },
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "printf secret-tool-output" },
        },
      ],
    } as AgentMessage,
    {
      role: "toolResult",
      toolCallId: "call-1",
      toolName: "bash",
      content: [{ type: "text", text: "secret-tool-output" }],
    } as AgentMessage,
    {
      role: "assistant",
      content: [{ type: "text", text: "Done" }],
    } as AgentMessage,
  ];
}

describe("/prune-auto extension flow", () => {
  it("triggers compaction instead of rewriting provider context after threshold", async () => {
    const commands = new Map<string, RegisteredCommand>();
    const handlers = new Map<string, RegisteredHandler>();
    const pi = {
      registerCommand: vi.fn((name, command) => commands.set(name, command)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };

    contextPruneExtension(pi as unknown as ExtensionAPI);

    const notify = vi.fn();
    const setStatus = vi.fn();
    await commands.get("prune-auto")?.handler("70", {
      hasUI: true,
      ui: { notify, setStatus },
      getContextUsage: () => ({ percent: 50 }),
    } as unknown as ExtensionCommandContext);

    expect(setStatus).toHaveBeenLastCalledWith(
      "context-pruner",
      "prune:auto 70% · 20.0% left",
    );

    const compact = vi.fn();
    await handlers.get("turn_end")?.({ type: "turn_end" }, {
      ui: { notify, setStatus },
      getContextUsage: () => ({ percent: 75 }),
      compact,
    } as unknown as ExtensionContext);

    const result = (await handlers.get("context")?.(
      { type: "context", messages: makeMessages() },
      {
        ui: { notify, setStatus },
        getContextUsage: () => ({ percent: 75 }),
        compact,
      } as unknown as ExtensionContext,
    )) as { messages: AgentMessage[] };

    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: expect.stringContaining("reasoning prune"),
      }),
    );
    expect(result).toBeUndefined();
  });

  it("does not alter provider context while auto-prune is below threshold", async () => {
    const commands = new Map<string, RegisteredCommand>();
    const handlers = new Map<string, RegisteredHandler>();
    const pi = {
      registerCommand: vi.fn((name, command) => commands.set(name, command)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };

    contextPruneExtension(pi as unknown as ExtensionAPI);

    const notify = vi.fn();
    const setStatus = vi.fn();
    await commands.get("prune-auto")?.handler("70", {
      hasUI: true,
      ui: { notify, setStatus },
      getContextUsage: () => ({ percent: 50 }),
    } as unknown as ExtensionCommandContext);

    const messages = makeMessages();
    const result = await handlers.get("context")?.(
      { type: "context", messages },
      {
        ui: { notify, setStatus },
        getContextUsage: () => ({ percent: 50 }),
        compact: vi.fn(),
      } as unknown as ExtensionContext,
    );

    expect(result).toBeUndefined();
  });
});
