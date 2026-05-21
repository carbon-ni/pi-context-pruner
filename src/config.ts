import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type {
  PruneConfig,
  PrunePreset,
  CategoryMeta,
  ToolKeepRule,
} from "./types.js";

export const DEFAULT_TOOL_RESULT_KEEP_RULES: ToolKeepRule[] = [
  {
    tool: "read",
    args: { pathEndsWith: ["package.json", "tsconfig.json"] },
    maxChars: 100,
  },
  { tool: /^ast_/, maxChars: 6000 },
  { tool: /^code_/, maxChars: 6000 },
];

export const DEFAULT_CONFIG: PruneConfig = {
  includeUser: true,
  includeAssistantThinking: false,
  includeAssistantComment: false,
  includeAssistantFinal: true,
  includeToolCalls: false,
  includeToolResults: false,
  includeLoadedInstructions: true,
  toolResultKeepRules: DEFAULT_TOOL_RESULT_KEEP_RULES,
  toolResultTruncation: "head",
};

export function buildPresets(
  baseConfig: PruneConfig,
): Record<PrunePreset, { description: string; config: PruneConfig }> {
  return {
    chat: {
      description: "user + assistant final only",
      config: cloneConfig(baseConfig),
    },
    reasoning: {
      description: "user + thinking + comments + final",
      config: {
        ...cloneConfig(baseConfig),
        includeAssistantThinking: true,
        includeAssistantComment: true,
      },
    },
    tools: {
      description: "user + tool calls + tool results",
      config: {
        ...cloneConfig(baseConfig),
        includeToolCalls: true,
        includeToolResults: true,
      },
    },
    "no-tools": {
      description: "user + comments + final (no tool trace)",
      config: {
        ...cloneConfig(baseConfig),
        includeAssistantComment: true,
      },
    },
  };
}

export const PRESETS: Record<
  PrunePreset,
  { description: string; config: PruneConfig }
> = buildPresets(DEFAULT_CONFIG);

export const CATEGORY_META: CategoryMeta[] = [
  {
    key: "user",
    label: "User messages",
    get: (c) => c.includeUser,
    set: (c, v) => {
      c.includeUser = v;
    },
  },
  {
    key: "assistant_thinking",
    label: "Assistant thinking",
    get: (c) => c.includeAssistantThinking,
    set: (c, v) => {
      c.includeAssistantThinking = v;
    },
  },
  {
    key: "assistant_comment",
    label: "Assistant comments (tool turns)",
    get: (c) => c.includeAssistantComment,
    set: (c, v) => {
      c.includeAssistantComment = v;
    },
  },
  {
    key: "assistant_final",
    label: "Assistant final messages",
    get: (c) => c.includeAssistantFinal,
    set: (c, v) => {
      c.includeAssistantFinal = v;
    },
  },
  {
    key: "tool_call",
    label: "Tool calls",
    get: (c) => c.includeToolCalls,
    set: (c, v) => {
      c.includeToolCalls = v;
    },
  },
  {
    key: "tool_result",
    label: "Tool results",
    get: (c) => c.includeToolResults,
    set: (c, v) => {
      c.includeToolResults = v;
    },
  },
];

export function cloneConfig(config: PruneConfig): PruneConfig {
  return { ...config, toolResultKeepRules: [...config.toolResultKeepRules] };
}

export interface ConfigPathOptions {
  cwd?: string;
  home?: string;
}

export function getConfigPaths(options: ConfigPathOptions = {}): {
  local: string;
  global: string;
} {
  const cwd = options.cwd ?? process.cwd();
  const home = options.home ?? homedir();
  return {
    local: join(cwd, ".pi", "context-pruner.json"),
    global: join(home, ".pi", "agent", "context-pruner.json"),
  };
}

function readConfigFile(path: string): Partial<PruneConfig> {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<PruneConfig>;
  } catch (error) {
    console.warn(`Failed to load context-pruner config at ${path}:`, error);
    return {};
  }
}

export function loadConfig(options: ConfigPathOptions = {}): PruneConfig {
  const paths = getConfigPaths(options);
  return cloneConfig({
    ...DEFAULT_CONFIG,
    ...readConfigFile(paths.global),
    ...readConfigFile(paths.local),
  });
}

export function parsePreset(args: string): PrunePreset | "last" | undefined {
  const token = args.trim().toLowerCase();
  if (!token) return undefined;
  if (token === "last") return "last";
  if (token in PRESETS) return token as PrunePreset;
  return undefined;
}
