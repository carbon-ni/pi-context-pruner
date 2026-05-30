import { estimateTokens } from "@mariozechner/pi-coding-agent";
import type { AssistantMessage, AgentMessage } from "./types.js";
import { distillMessages } from "./distill.js";
import { buildPresets, DEFAULT_CONFIG } from "./config.js";

export interface AuditInput {
  systemPrompt?: string;
  messages: AgentMessage[];
}

export interface AuditBreakdown {
  label: string;
  category: string;
  tokens: number;
  count: number;
}

export interface AuditTopConsumer {
  index: number;
  category: string;
  label: string;
  tokens: number;
}

export interface AuditSavings {
  reasoningPreset: { tokens: number; percent: number };
}

export interface AuditReport {
  totalTokens: number;
  initialTokens: number;
  conversationTokens: number;
  totalMessages: number;
  breakdown: AuditBreakdown[];
  topConsumers: AuditTopConsumer[];
  savings?: AuditSavings;
}

const CHARS_PER_TOKEN = 4;

function tokensForText(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function getToolPath(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || !("path" in args)) return undefined;
  const path = (args as { path?: unknown }).path;
  return typeof path === "string" ? path : undefined;
}

function classifyAssistantPart(
  part: AssistantMessage["content"][number],
): string | null {
  if (part.type === "thinking") return "assistant_thinking";
  if (part.type === "toolCall") return "tool_call";
  if (part.type === "text") return "assistant_text";
  return null;
}

function isToolCallToRead(part: AssistantMessage["content"][number]): boolean {
  if (part.type !== "toolCall") return false;
  return part.name === "read";
}

interface PromptSection {
  label: string;
  category: string;
  tokens: number;
}

function parseSystemPromptSections(prompt: string): PromptSection[] {
  const sections: PromptSection[] = [];

  // Split into: before project context, project context entries, skills, trailing
  const projectCtxMatch = prompt.indexOf("# Project Context");
  const skillsMatch = prompt.indexOf("<available_skills>");
  const skillsEndMatch =
    skillsMatch >= 0 ? prompt.indexOf("</available_skills>", skillsMatch) : -1;

  // Base prompt (everything before project context or skills)
  const baseEnd =
    projectCtxMatch >= 0
      ? projectCtxMatch
      : skillsMatch >= 0
        ? skillsMatch
        : prompt.length;
  const baseText = prompt.slice(0, baseEnd).trim();
  if (baseText) {
    sections.push({
      label: "system_prompt (base)",
      category: "system_prompt",
      tokens: tokensForText(baseText),
    });
  }

  // Project context entries: ## {filePath}\n\n{content}
  if (projectCtxMatch >= 0) {
    const ctxStart = prompt.indexOf("\n", projectCtxMatch);
    const ctxEnd = skillsMatch >= 0 ? skillsMatch : prompt.length;
    const ctxBlock = prompt.slice(ctxStart, ctxEnd);

    // Split on ## headings
    const headingRegex = /^## (.+)$/gm;
    let match: RegExpExecArray | null;
    const entries: { filePath: string; start: number; end: number }[] = [];
    while ((match = headingRegex.exec(ctxBlock)) !== null) {
      entries.push({ filePath: match[1], start: match.index, end: -1 });
    }
    for (let i = 0; i < entries.length; i++) {
      entries[i].end =
        i + 1 < entries.length ? entries[i + 1].start : ctxBlock.length;
    }

    for (const entry of entries) {
      const content = ctxBlock.slice(entry.start, entry.end);
      if (content.trim()) {
        sections.push({
          label: entry.filePath,
          category: "system_prompt",
          tokens: tokensForText(content),
        });
      }
    }

    // Preamble between # Project Context and first ##
    if (entries.length > 0 && entries[0].start > 0) {
      const preamble = ctxBlock.slice(0, entries[0].start).trim();
      if (preamble) {
        sections.push({
          label: "project_context (header)",
          category: "system_prompt",
          tokens: tokensForText(preamble),
        });
      }
    }
  }

  // Skills block
  if (skillsMatch >= 0 && skillsEndMatch >= 0) {
    const skillBlock = prompt.slice(
      skillsMatch,
      skillsEndMatch + "</available_skills>".length,
    );
    // Parse individual skills — for now we show the whole block
    const skillLines = skillBlock.split("\n");
    const headerEnd = skillLines.findIndex((l) => l.includes("<skill>"));
    if (headerEnd > 0) {
      const headerText = skillLines.slice(0, headerEnd).join("\n").trim();
      if (headerText) {
        sections.push({
          label: "skills (header)",
          category: "system_prompt",
          tokens: tokensForText(headerText),
        });
      }
    }
    const skillEntries = skillLines
      .slice(headerEnd > 0 ? headerEnd : 0)
      .join("\n");
    if (skillEntries.trim()) {
      sections.push({
        label: "skills (list)",
        category: "system_prompt",
        tokens: tokensForText(skillEntries),
      });
    }
  }

  // Trailing: date + working directory (after skills or project context)
  const trailingStart =
    skillsEndMatch >= 0
      ? skillsEndMatch + "</available_skills>".length
      : projectCtxMatch >= 0
        ? (() => {
            // Find end of project context block
            const end = skillsMatch >= 0 ? skillsMatch : prompt.length;
            return end;
          })()
        : -1;

  if (trailingStart >= 0 && trailingStart < prompt.length) {
    const trailing = prompt.slice(trailingStart).trim();
    if (trailing) {
      sections.push({
        label: "system_prompt (trailing)",
        category: "system_prompt",
        tokens: tokensForText(trailing),
      });
    }
  }

  return sections;
}

export function auditContext(input: AuditInput): AuditReport {
  const { systemPrompt, messages } = input;
  const totalMessages = messages.length;

  if (totalMessages === 0 && !systemPrompt) {
    return {
      totalTokens: 0,
      initialTokens: 0,
      conversationTokens: 0,
      totalMessages: 0,
      breakdown: [],
      topConsumers: [],
    };
  }

  // Find first user message — boundary between setup and conversation
  let firstUserIndex = messages.findIndex((m) => m.role === "user");
  if (firstUserIndex === -1) firstUserIndex = messages.length;

  // Accumulate by bucket
  const buckets = new Map<
    string,
    { tokens: number; count: number; category: string }
  >();

  // Map toolCallId → path label (built during assistant passes, consumed by tool results)
  const toolCallPathMap = new Map<string, string>();

  // Parse system prompt into named sections
  if (systemPrompt) {
    const sections = parseSystemPromptSections(systemPrompt);
    for (const section of sections) {
      addToBucket(section.label, section.category, section.tokens);
    }
  }

  // Track top consumers per message
  const consumerList: AuditTopConsumer[] = [];

  function addToBucket(key: string, category: string, tokens: number): void {
    const ex = buckets.get(key) ?? { tokens: 0, count: 0, category };
    ex.tokens += tokens;
    ex.count += 1;
    buckets.set(key, ex);
  }

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    const msgTokens = estimateTokens(msg);
    const isSetup = i < firstUserIndex;

    if (msg.role === "user") {
      addToBucket("user", "user", msgTokens);
      consumerList.push({
        index: i,
        category: "user",
        label: "user",
        tokens: msgTokens,
      });
      continue;
    }

    if (msg.role === "assistant") {
      const hasRead = msg.content.some(isToolCallToRead);

      if (isSetup && hasRead) {
        // Split: read tool calls → per-path bucket, others → other_setup
        let otherTokens = 0;
        const pathTokens = new Map<string, number>();

        for (const part of msg.content) {
          if (part.type === "toolCall" && isToolCallToRead(part)) {
            const path = getToolPath(part.arguments);
            const label = path ?? "read (unknown path)";
            const partTokens = estimateTokens({
              role: "assistant",
              content: [part],
            } as AgentMessage);
            pathTokens.set(label, (pathTokens.get(label) ?? 0) + partTokens);
            // Map toolCallId → path for matching tool results
            toolCallPathMap.set(part.id, label);
          } else {
            otherTokens += estimateTokens({
              role: "assistant",
              content: [part],
            } as AgentMessage);
          }
        }

        for (const [path, tokens] of pathTokens) {
          addToBucket(path, "setup_instruction", tokens);
        }
        if (otherTokens > 0) {
          addToBucket("other_setup", "other_setup", otherTokens);
        }

        consumerList.push({
          index: i,
          category: "setup_instruction",
          label: "assistant (setup)",
          tokens: msgTokens,
        });
        continue;
      }

      if (isSetup) {
        addToBucket("other_setup", "other_setup", msgTokens);
        consumerList.push({
          index: i,
          category: "other_setup",
          label: "assistant (setup)",
          tokens: msgTokens,
        });
        continue;
      }

      // Conversation assistant — split by part type
      for (const part of msg.content) {
        const cls = classifyAssistantPart(part);
        if (!cls) continue;

        const hasToolCall = msg.content.some((p) => p.type === "toolCall");
        const category =
          cls === "assistant_text"
            ? hasToolCall
              ? "assistant_comment"
              : "assistant_final"
            : cls;

        const partTokens = estimateTokens({
          role: "assistant",
          content: [part],
        } as AgentMessage);

        addToBucket(category, category, partTokens);
      }

      consumerList.push({
        index: i,
        category: "assistant",
        label: "assistant",
        tokens: msgTokens,
      });
      continue;
    }

    if (msg.role === "toolResult") {
      if (isSetup) {
        // Resolve to path label from the tool call that triggered this result
        const pathLabel = toolCallPathMap.get(msg.toolCallId);
        const key = pathLabel ?? "other_setup";
        const category = pathLabel ? "setup_instruction" : "other_setup";

        addToBucket(key, category, msgTokens);
        consumerList.push({
          index: i,
          category,
          label: pathLabel
            ? `tool_result → ${pathLabel}`
            : `tool_result (${msg.toolName})`,
          tokens: msgTokens,
        });
        continue;
      }

      addToBucket("tool_result", "tool_result", msgTokens);
      consumerList.push({
        index: i,
        category: "tool_result",
        label: `tool_result (${msg.toolName})`,
        tokens: msgTokens,
      });
      continue;
    }
  }

  // Build breakdown sorted by tokens desc
  const breakdown: AuditBreakdown[] = Array.from(buckets.entries())
    .map(([label, { tokens, count, category }]) => ({
      label,
      category,
      tokens,
      count,
    }))
    .sort((a, b) => b.tokens - a.tokens);

  // Top consumers (top 5)
  const topConsumers = consumerList
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5);

  // Compute totals
  const initialTokens = breakdown
    .filter(
      (b) =>
        b.category === "system_prompt" ||
        b.category === "setup_instruction" ||
        b.category === "other_setup",
    )
    .reduce((s, b) => s + b.tokens, 0);

  const conversationTokens = breakdown
    .filter(
      (b) =>
        b.category !== "system_prompt" &&
        b.category !== "setup_instruction" &&
        b.category !== "other_setup",
    )
    .reduce((s, b) => s + b.tokens, 0);

  const totalTokens = initialTokens + conversationTokens;

  // Compute savings using reasoning preset
  let savings: AuditSavings | undefined;
  if (messages.length > 0) {
    const reasoningConfig = buildPresets(DEFAULT_CONFIG).reasoning.config;
    const { stats } = distillMessages(messages, reasoningConfig);
    const reasoningSaved = stats.sourceApproxTokens - stats.keptApproxTokens;
    savings = {
      reasoningPreset: {
        tokens: reasoningSaved,
        percent:
          stats.sourceApproxTokens > 0
            ? Math.round((reasoningSaved / stats.sourceApproxTokens) * 100)
            : 0,
      },
    };
  }

  return {
    totalTokens,
    initialTokens,
    conversationTokens,
    totalMessages,
    breakdown,
    topConsumers,
    savings,
  };
}
