import type { PruneConfig, PruneStats } from "./types.js";
import { CATEGORY_META } from "./config.js";
import type { AuditReport } from "./audit.js";

function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function reductionPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.max(0, ((before - after) / before) * 100);
}

function bar(percent: number, width = 20): string {
  const filled = Math.round(
    (Math.min(100, Math.max(0, percent)) / 100) * width,
  );
  return "█".repeat(filled) + "░".repeat(width - filled);
}

export function configSummary(config: PruneConfig): string {
  const enabled = CATEGORY_META.filter((m) => m.get(config)).map(
    (m) => m.label,
  );
  return `Categories: ${enabled.length > 0 ? enabled.join(", ") : "none"}`;
}

export function statsSummary(stats: PruneStats): string {
  const pct = reductionPercent(
    stats.sourceApproxTokens,
    stats.keptApproxTokens,
  );
  return [
    `Tokens: ~${formatInt(stats.keptApproxTokens)} (was ~${formatInt(stats.sourceApproxTokens)}, ${pct.toFixed(1)}% reduction)`,
    `Messages: ${formatInt(stats.keptMessages)} kept / ${formatInt(stats.sourceMessages)} total`,
  ].join("\n");
}

export function auditSummary(report: AuditReport): string {
  const lines: string[] = [];

  lines.push(
    `Context Audit — ${report.totalMessages} messages, ~${formatInt(report.totalTokens)} tokens`,
  );
  lines.push("");

  const initialPct =
    report.totalTokens > 0
      ? ((report.initialTokens / report.totalTokens) * 100).toFixed(1)
      : "0.0";
  const convPct =
    report.totalTokens > 0
      ? ((report.conversationTokens / report.totalTokens) * 100).toFixed(1)
      : "0.0";

  lines.push(
    `INITIAL SETUP — ~${formatInt(report.initialTokens)} tokens (${initialPct}%)`,
  );
  for (const b of report.breakdown.filter(
    (b) =>
      b.category === "system_prompt" ||
      b.category === "setup_instruction" ||
      b.category === "other_setup",
  )) {
    const pct =
      report.totalTokens > 0
        ? ((b.tokens / report.totalTokens) * 100).toFixed(1)
        : "0.0";
    lines.push(
      `  ${b.label.padEnd(24)} ${bar(Number(pct), 12)} ${formatInt(b.tokens).padStart(8)} (${pct}%)`,
    );
  }

  lines.push("");
  lines.push(
    `CONVERSATION — ~${formatInt(report.conversationTokens)} tokens (${convPct}%)`,
  );
  for (const b of report.breakdown.filter(
    (b) =>
      b.category !== "system_prompt" &&
      b.category !== "setup_instruction" &&
      b.category !== "other_setup",
  )) {
    const pct =
      report.totalTokens > 0
        ? ((b.tokens / report.totalTokens) * 100).toFixed(1)
        : "0.0";
    lines.push(
      `  ${b.label.padEnd(24)} ${bar(Number(pct), 12)} ${formatInt(b.tokens).padStart(8)} (${pct}%)`,
    );
  }

  if (report.topConsumers.length > 0) {
    lines.push("");
    lines.push("Top Consumers:");
    for (let i = 0; i < report.topConsumers.length; i++) {
      const c = report.topConsumers[i];
      lines.push(
        `  #${i + 1} [msg ${c.index}] ${c.label} — ~${formatInt(c.tokens)} tokens`,
      );
    }
  }

  if (report.savings) {
    lines.push("");
    lines.push(
      `Savings (reasoning preset): ~${formatInt(report.savings.reasoningPreset.tokens)} tokens (${report.savings.reasoningPreset.percent}%)`,
    );
  }

  return lines.join("\n");
}

export function compactSummary(sessionName: string, stats: PruneStats): string {
  const pct = reductionPercent(
    stats.sourceApproxTokens,
    stats.keptApproxTokens,
  );
  return [
    `Pruned → ${sessionName}`,
    `ctx ${bar(pct)} ${pct.toFixed(1)}% reduced`,
    `~${formatInt(stats.sourceApproxTokens)} → ~${formatInt(stats.keptApproxTokens)} tokens · ${formatInt(stats.keptMessages)}/${formatInt(stats.sourceMessages)} msgs kept`,
  ].join("\n");
}
