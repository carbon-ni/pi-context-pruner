# pi-context-pruner

Context bonsai for Pi: trim a noisy session into a focused memory branch that carries only what the next task needs.

`pi-context-pruner` creates a deterministic fork of the current session, keeping useful memory and cutting stale tool noise. No summaries, no guessing: messages are kept, dropped, or truncated.

Based on [pi-reduce](https://github.com/maxjendrall/pi-reduce) — simplified for quick preset-driven usage.

## Commands

| Command                 | Effect                                                                     |
| ----------------------- | -------------------------------------------------------------------------- |
| `/prune`                | Run the default `reasoning` preset                                         |
| `/prune chat`           | Keep user messages and assistant final answers                             |
| `/prune reasoning`      | Keep user messages, assistant thinking, comments, and final answers        |
| `/prune tools`          | Keep user messages, tool calls, and tool results                           |
| `/prune no-tools`       | Keep user messages, assistant comments, and final answers; drop tool trace |
| `/prune pick`           | Choose a preset interactively                                              |
| `/prune last`           | Rerun the last prune config                                                |
| `/prune-auto [percent]` | Enable auto-prune at a context threshold; default `60`, `0` disables       |

## How it works

1. Reads the current branch context.
2. Filters messages by category: user, thinking, assistant text, tool calls, tool results.
3. Keeps selected tool results by whitelist and truncates long text results.
4. Creates a new child session with the reduced messages.
5. Switches into the new session immediately.

## Presets

| Preset      | Keeps                                                                                   | Drops                                                 |
| ----------- | --------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| `chat`      | User messages, assistant final answers                                                  | Thinking, comments with tool calls, tool trace        |
| `reasoning` | User messages, thinking, comments, final answers, selected context-bearing tool results | Most tool results                                     |
| `tools`     | User messages, tool calls, tool results                                                 | Assistant final/comment text unless part of tool flow |
| `no-tools`  | User messages, assistant comments, final answers                                        | Tool calls and tool results                           |

## Auto-prune

Auto-prune is disabled by default. Enable it explicitly:

- `/prune-auto` — enable at 60%
- `/prune-auto 80` — enable at 80%
- `/prune-auto 80%` — same as above
- `/prune-auto 0` — disable

When enabled, it uses the `reasoning` preset: user messages, assistant reasoning, comments, and final answers, without full tool traces.

## Session names

Pruned sessions receive a suffix with preset, prune count, and reduction, for example:

```text
My session [prune:reasoning · ×1 · -78%]
```

Repeated pruning increments the count instead of stacking suffixes.

## Configuration

Config files are optional. Local config overrides global config.

- local: `.pi/context-pruner.json`
- global: `~/.pi/agent/context-pruner.json`

Config values are shallow overrides. `toolResultKeepRules` replaces the default rule list.

Example:

```json
{
  "includeUser": true,
  "includeAssistantFinal": true,
  "includeAssistantThinking": true,
  "includeAssistantComment": true,
  "includeToolCalls": false,
  "includeToolResults": false,
  "includeLoadedInstructions": true,
  "toolResultMaxChars": 4000,
  "toolResultTruncation": "head",
  "toolResultKeepRules": [
    {
      "tool": "read",
      "args": { "pathEndsWith": ["package.json", "tsconfig.json"] },
      "maxChars": 4000
    }
  ]
}
```

## Tool result whitelist

Default pruning drops most tool results, but keeps selected context-bearing results:

- loaded instructions: `read` calls for `AGENTS.md` and `SKILL.md` files
- small project config reads: `package.json`, `tsconfig.json` (truncated)
- AST/LSP exploration tools: `ast_*`, `code_*` (truncated)

Use `/prune tools` when you need every tool call and result.

## Development

```sh
npm test
npm run check
npm run lint
```

Project shape:

- `src/index.ts` — extension entrypoint and command registration
- `src/distill.ts` — message filtering and truncation logic
- `src/config.ts` — defaults, presets, and config loading
- `src/auto.ts` — auto-prune threshold parsing and decision logic
- `src/format.ts` — user-facing summary formatting
- `src/types.ts` — shared types
- `test/*.test.ts` — Vitest coverage for presets, config, auto-prune, session names, and distillation
