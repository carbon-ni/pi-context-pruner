import { describe, expect, it } from "vitest";
import { prunedSessionName } from "./index.js";
import type { PruneStats } from "./types.js";

const stats = (
  sourceApproxTokens: number,
  keptApproxTokens: number,
): PruneStats => ({
  sourceMessages: 10,
  keptMessages: 5,
  droppedMessages: 5,
  sourceApproxTokens,
  keptApproxTokens,
});

describe("prunedSessionName", () => {
  it("creates a prune name when the source session is unnamed", () => {
    expect(prunedSessionName(undefined, "reasoning", stats(1000, 200))).toBe(
      "prune:reasoning · ×1 · -80%",
    );
  });

  it("appends the prune label, count, and last reduction to a regular source session", () => {
    expect(prunedSessionName("debug task", "reasoning", stats(1000, 875))).toBe(
      "debug task [prune:reasoning · ×1 · -13%]",
    );
  });

  it("increments previous prune count instead of accumulating suffixes", () => {
    expect(
      prunedSessionName(
        "debug task [prune:reasoning · ×2 · -80%] [prune:reasoning · ×3 · -10%]",
        "tools",
        stats(1000, 950),
      ),
    ).toBe("debug task [prune:tools · ×4 · -5%]");
  });

  it("increments prune-only sessions without adding suffixes", () => {
    expect(
      prunedSessionName(
        "prune:reasoning · ×2 · -80% [prune:reasoning]",
        "tools",
        stats(0, 0),
      ),
    ).toBe("prune:tools · ×3 · -0%");
  });
});
