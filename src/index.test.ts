import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import contextPruneExtension from "./index.js";

type RegisteredCommand = {
  handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
};

type RegisteredHandler = (
  event: unknown,
  ctx: ExtensionContext,
) => Promise<void> | void;

describe("/prune-auto extension flow", () => {
  it("auto-prunes after a turn when context usage reaches the configured threshold", async () => {
    const commands = new Map<string, RegisteredCommand>();
    const handlers = new Map<string, RegisteredHandler>();
    const pi = {
      registerCommand: vi.fn((name, command) => commands.set(name, command)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };

    contextPruneExtension(pi as unknown as ExtensionAPI);

    const notify = vi.fn();
    await commands.get("prune-auto")?.handler("70", {
      hasUI: true,
      ui: { notify },
      getContextUsage: () => ({ percent: 50 }),
    } as unknown as ExtensionCommandContext);

    const pruneContext = vi.fn();
    await handlers.get("turn_end")?.({ type: "turn_end" }, {
      ui: { notify },
      getContextUsage: () => ({ percent: 75 }),
      compact: pruneContext,
    } as unknown as ExtensionContext);

    expect(pruneContext).toHaveBeenCalledOnce();
    expect(pruneContext).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: expect.stringContaining("Preserve user requests"),
        onComplete: expect.any(Function),
        onError: expect.any(Function),
      }),
    );
  });

  it("notifies when auto-prune compaction fails", async () => {
    const commands = new Map<string, RegisteredCommand>();
    const handlers = new Map<string, RegisteredHandler>();
    const pi = {
      registerCommand: vi.fn((name, command) => commands.set(name, command)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };

    contextPruneExtension(pi as unknown as ExtensionAPI);

    const notify = vi.fn();
    await commands.get("prune-auto")?.handler("70", {
      hasUI: true,
      ui: { notify },
      getContextUsage: () => ({ percent: 50 }),
    } as unknown as ExtensionCommandContext);

    const compact = vi.fn((options) => {
      options.onError(new Error("model unavailable"));
    });
    await handlers.get("turn_end")?.({ type: "turn_end" }, {
      ui: { notify },
      getContextUsage: () => ({ percent: 75 }),
      compact,
    } as unknown as ExtensionContext);

    expect(notify).toHaveBeenCalledWith(
      "Auto-prune failed: model unavailable",
      "error",
    );
  });

  it("uses turn-end compaction so Pi keeps recent tool context", async () => {
    const commands = new Map<string, RegisteredCommand>();
    const handlers = new Map<string, RegisteredHandler>();
    const pi = {
      registerCommand: vi.fn((name, command) => commands.set(name, command)),
      on: vi.fn((event, handler) => handlers.set(event, handler)),
    };

    contextPruneExtension(pi as unknown as ExtensionAPI);

    const notify = vi.fn();
    await commands.get("prune-auto")?.handler("70", {
      hasUI: true,
      ui: { notify },
      getContextUsage: () => ({ percent: 50 }),
    } as unknown as ExtensionCommandContext);

    const compact = vi.fn();
    await handlers.get("turn_end")?.(
      {
        type: "turn_end",
        turnIndex: 0,
        message: { role: "assistant", content: "", toolCalls: [] },
        toolResults: [
          {
            role: "toolResult",
            toolCallId: "call-1",
            content: "important output",
          },
        ],
      },
      {
        ui: { notify },
        getContextUsage: () => ({ percent: 75 }),
        compact,
      } as unknown as ExtensionContext,
    );

    expect(compact).toHaveBeenCalledOnce();
    expect(compact).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: expect.stringContaining("Preserve user requests"),
      }),
    );
  });
});
