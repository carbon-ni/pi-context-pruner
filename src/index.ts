import { buildSessionContext } from "@mariozechner/pi-coding-agent";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { DEFAULT_CONFIG, PRESETS, cloneConfig, parsePreset } from "./config.js";
import { distillMessages } from "./distill.js";
import { compactSummary, configSummary, statsSummary } from "./format.js";
import { configureAutoPrune, shouldAutoPrune, type AutoPruneConfig } from "./auto.js";
import type { PruneConfig, PrunePreset, PruneStats, Message } from "./types.js";

interface PruneState {
	lastConfig: PruneConfig;
	lastPreset?: PrunePreset;
	auto: AutoPruneConfig;
}

const AUTO_PRUNE_INSTRUCTIONS = [
	"Preserve user requests, assistant conclusions, and important reasoning.",
	"Drop verbose tool traces and redundant intermediate details.",
	"Keep enough context to continue the current task safely.",
].join(" ");

function sessionName(ctx: ExtensionCommandContext, label: string): string {
	const current = ctx.sessionManager.getSessionName();
	return current ? `${current} [prune:${label}]` : `prune:${label}`;
}

async function createPrunedSession(
	ctx: ExtensionCommandContext,
	label: string,
	config: PruneConfig,
	pruned: Message[],
	stats: PruneStats,
) {
	const sourceFile = ctx.sessionManager.getSessionFile();
	const leafId = ctx.sessionManager.getLeafId();
	const sourceContext = buildSessionContext(ctx.sessionManager.getEntries(), leafId);
	const name = sessionName(ctx, label);

	await ctx.waitForIdle();
	const result = await ctx.newSession({
		parentSession: sourceFile,
		setup: async (sm) => {
			sm.appendCustomEntry("prune-source", {
				sourceSessionFile: sourceFile,
				sourceLeafId: leafId,
				label,
				config,
				stats,
				createdAt: new Date().toISOString(),
			});

			if (sourceContext.model) {
				sm.appendModelChange(sourceContext.model.provider, sourceContext.model.modelId);
			}
			sm.appendThinkingLevelChange(sourceContext.thinkingLevel);

			for (const message of pruned) {
				sm.appendMessage(message);
			}
			sm.appendSessionInfo(name);
		},
		withSession: async (ctx) => {
			ctx.ui.notify(compactSummary(name, stats), "info");
		},
	});

	if (result.cancelled) {
		ctx.ui.notify("Prune cancelled", "info");
	}
}

export default function contextPruneExtension(pi: ExtensionAPI) {
	let state: PruneState = {
		lastConfig: cloneConfig(DEFAULT_CONFIG),
		auto: { enabled: false, thresholdPercent: 0 },
	};

	const getMessages = (ctx: ExtensionCommandContext) => {
		const context = buildSessionContext(
			ctx.sessionManager.getEntries(),
			ctx.sessionManager.getLeafId(),
		);
		return context.messages;
	};

	const runPreset = async (preset: PrunePreset, ctx: ExtensionCommandContext) => {
		const config = cloneConfig(PRESETS[preset].config);
		const { messages, stats } = distillMessages(getMessages(ctx), config);

		if (messages.length === 0) {
			ctx.ui.notify("Preset removed everything — try a different one", "warning");
			return;
		}

		const detail = `${configSummary(config)}\n\n${statsSummary(stats)}`;
		const confirmed = await ctx.ui.confirm(`Create pruned session (${preset})?`, detail);
		if (!confirmed) return;

		state = { ...state, lastConfig: cloneConfig(config), lastPreset: preset };
		await createPrunedSession(ctx, preset, config, messages, stats);
	};

	const pickAndRun = async (ctx: ExtensionCommandContext) => {
		const options = Object.entries(PRESETS).map(
			([key, { description }]) => `${key} — ${description}`,
		);
		const selection = await ctx.ui.select("Prune preset", options);
		if (!selection) return;
		const preset = selection.split(" — ")[0] as PrunePreset;
		await runPreset(preset, ctx);
	};

	const pruneIfAutoThresholdReached = (ctx: ExtensionContext, notifyWhenSkipped: boolean) => {
		const decision = shouldAutoPrune(ctx.getContextUsage(), state.auto);
		if (!decision.shouldPrune) {
			if (notifyWhenSkipped) {
				ctx.ui.notify(
					`Auto-prune enabled at ${state.auto.thresholdPercent}%. ${decision.reason}`,
					"info",
				);
			}
			return;
		}

		ctx.ui.notify(`${decision.reason}; pruning context`, "info");
		ctx.compact({ customInstructions: AUTO_PRUNE_INSTRUCTIONS });
	};

	pi.on("agent_end", async (_event, ctx) => {
		pruneIfAutoThresholdReached(ctx, false);
	});

	pi.registerCommand("prune", {
		description:
			"Create a pruned fork (usage: /prune [chat|reasoning|tools|no-tools|pick|last], default: reasoning)",
		getArgumentCompletions: (prefix: string) => {
			const options = ["chat", "reasoning", "tools", "no-tools", "pick", "last"];
			const filtered = options.filter((o) => o.startsWith(prefix.toLowerCase()));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/prune requires interactive mode", "error");
				return;
			}

			const parsed = parsePreset(args);

			if (parsed === "last") {
				const { messages, stats } = distillMessages(getMessages(ctx), state.lastConfig);
				if (messages.length === 0) {
					ctx.ui.notify("Last config removes everything", "warning");
					return;
				}
				const label = state.lastPreset ?? "last";
				const detail = `${configSummary(state.lastConfig)}\n\n${statsSummary(stats)}`;
				const confirmed = await ctx.ui.confirm(`Prune with last config (${label})?`, detail);
				if (!confirmed) return;
				await createPrunedSession(ctx, label, state.lastConfig, messages, stats);
				return;
			}

			if (parsed) {
				await runPreset(parsed, ctx);
				return;
			}

			// /prune pick → interactive picker
			if (args.trim().toLowerCase() === "pick") {
				await pickAndRun(ctx);
				return;
			}

			// /prune (no args) → default to reasoning
			await runPreset("reasoning", ctx);
		},
	});

	pi.registerCommand("prune-auto", {
		description:
			"Enable reasoning auto-prune threshold (usage: /prune-auto [percent], default: 60, 0 disables)",
		getArgumentCompletions: (prefix: string) => {
			const options = ["0", "60", "70", "80", "90"];
			const filtered = options.filter((o) => o.startsWith(prefix.trim()));
			return filtered.length > 0 ? filtered.map((value) => ({ value, label: `${value}%` })) : null;
		},
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/prune-auto requires interactive mode", "error");
				return;
			}

			const auto = configureAutoPrune(args);
			if (!auto) {
				ctx.ui.notify("Usage: /prune-auto [0-100]", "warning");
				return;
			}

			state = { ...state, auto };
			if (!auto.enabled) {
				ctx.ui.notify("Auto-prune disabled", "info");
				return;
			}

			pruneIfAutoThresholdReached(ctx, true);
		},
	});
}
