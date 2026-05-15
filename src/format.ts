import type { PruneConfig, PruneStats } from "./types.js";
import { CATEGORY_META } from "./config.js";

function formatInt(n: number): string {
	return new Intl.NumberFormat("en-US").format(Math.round(n));
}

function reductionPercent(before: number, after: number): number {
	if (before <= 0) return 0;
	return Math.max(0, ((before - after) / before) * 100);
}

function bar(percent: number, width = 20): string {
	const filled = Math.round((Math.min(100, Math.max(0, percent)) / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

export function configSummary(config: PruneConfig): string {
	const enabled = CATEGORY_META.filter((m) => m.get(config)).map((m) => m.label);
	return `Categories: ${enabled.length > 0 ? enabled.join(", ") : "none"}`;
}

export function statsSummary(stats: PruneStats): string {
	const pct = reductionPercent(stats.sourceApproxTokens, stats.keptApproxTokens);
	return [
		`Tokens: ~${formatInt(stats.keptApproxTokens)} (was ~${formatInt(stats.sourceApproxTokens)}, ${pct.toFixed(1)}% reduction)`,
		`Messages: ${formatInt(stats.keptMessages)} kept / ${formatInt(stats.sourceMessages)} total`,
	].join("\n");
}

export function compactSummary(sessionName: string, stats: PruneStats): string {
	const pct = reductionPercent(stats.sourceApproxTokens, stats.keptApproxTokens);
	return [
		`Pruned → ${sessionName}`,
		`ctx ${bar(pct)} ${pct.toFixed(1)}% reduced`,
		`~${formatInt(stats.sourceApproxTokens)} → ~${formatInt(stats.keptApproxTokens)} tokens · ${formatInt(stats.keptMessages)}/${formatInt(stats.sourceMessages)} msgs kept`,
	].join("\n");
}
