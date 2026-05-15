# pi-context-pruner

Pi extension that creates a pruned fork of the current session branch, keeping only the message types you choose.

Based on [pi-reduce](https://github.com/maxjendrall/pi-reduce) — simplified for quick preset-driven usage.

## Commands

- `/prune` — default: **reasoning** (user + thinking + comments + final, ~80% reduction)
- `/prune chat` — keep user + assistant final only
- `/prune reasoning` — keep user + thinking + comments + final
- `/prune tools` — keep user + tool calls + tool results
- `/prune no-tools` — keep user + comments + final (no tool trace)
- `/prune pick` — interactive preset picker
- `/prune last` — rerun the last prune config
- `/prune-auto [percent]` — enable reasoning auto-prune threshold (default: 60%, `0` disables)

## How it works

1. Reads current branch context
2. Filters messages by category (user, thinking, tool calls, etc.)
3. Creates a new session with only kept messages
4. Switches into the new session immediately

No summaries generated — reduction is deterministic: keep, drop, or truncate.

## Auto-prune

Auto-prune is disabled by default. Enable it explicitly:

- `/prune-auto` — enable at 60%
- `/prune-auto 80` — enable at 80%
- `/prune-auto 80%` — same as above
- `/prune-auto 0` — disable

When enabled, it uses the `reasoning` preset: user messages, assistant reasoning, comments, and final answers, without full tool traces.
