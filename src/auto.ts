export const DEFAULT_AUTO_THRESHOLD_PERCENT = 60;

export interface AutoPruneConfig {
  enabled: boolean;
  thresholdPercent: number;
}

export interface AutoPruneDecision {
  thresholdPercent: number;
  usagePercent?: number;
  shouldPrune: boolean;
  reason: string;
}

export function parseAutoThreshold(args: string): number | undefined {
  const token = args.trim();
  if (!token) return DEFAULT_AUTO_THRESHOLD_PERCENT;

  const normalized = token.endsWith("%") ? token.slice(0, -1) : token;
  const threshold = Number(normalized);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100)
    return undefined;

  return threshold;
}

export function configureAutoPrune(args: string): AutoPruneConfig | undefined {
  const threshold = parseAutoThreshold(args);
  if (threshold === undefined) return undefined;

  return {
    enabled: threshold > 0,
    thresholdPercent: threshold,
  };
}

export function normalizeContextPercent(percent: number): number {
  return percent <= 1 ? percent * 100 : percent;
}

export function formatAutoPruneStatus(
  usage: { percent?: number | null } | undefined,
  config: AutoPruneConfig,
): string | undefined {
  if (!config.enabled) return undefined;
  if (!usage || usage.percent == null)
    return `prune:auto ${config.thresholdPercent}%`;

  const usagePercent = normalizeContextPercent(usage.percent);
  const remainingPercent = Math.max(config.thresholdPercent - usagePercent, 0);
  if (remainingPercent === 0)
    return `prune:auto ${config.thresholdPercent}% · reached`;

  return `prune:auto ${config.thresholdPercent}% · ${remainingPercent.toFixed(1)}% left`;
}

export function shouldAutoPrune(
  usage: { percent?: number | null } | undefined,
  config: AutoPruneConfig,
): AutoPruneDecision {
  if (!config.enabled) {
    return {
      thresholdPercent: config.thresholdPercent,
      shouldPrune: false,
      reason: "Auto-prune is disabled",
    };
  }

  if (!usage || usage.percent == null) {
    return {
      thresholdPercent: config.thresholdPercent,
      shouldPrune: false,
      reason: "Context usage is unavailable",
    };
  }

  const usagePercent = normalizeContextPercent(usage.percent);
  if (usagePercent < config.thresholdPercent) {
    return {
      thresholdPercent: config.thresholdPercent,
      usagePercent,
      shouldPrune: false,
      reason: `Context usage ${usagePercent.toFixed(1)}% is below ${config.thresholdPercent}%`,
    };
  }

  return {
    thresholdPercent: config.thresholdPercent,
    usagePercent,
    shouldPrune: true,
    reason: `Context usage ${usagePercent.toFixed(1)}% reached ${config.thresholdPercent}%`,
  };
}
