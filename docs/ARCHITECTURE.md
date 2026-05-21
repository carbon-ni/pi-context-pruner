# Architecture: pi-context-pruner

## Overview

Pi extension that distills long conversation context into compact summaries, creating "pruned" sessions that preserve essential information while reducing token count.

## Module Boundaries

```
index.ts (infra/extension layer)
  ├── registers TUI commands and agent lifecycle hooks
  ├── depends on: config, auto, distill, format
  └── should NOT contain business logic

distill.ts (core algorithm)
  ├── iterates messages, applies keep/truncate rules per tool type
  ├── no external deps beyond pi-agent-core types
  └── pure function: messages + config → distilled messages + stats

config.ts (configuration)
  ├── loads JSON config from .pi/context-pruner.json (local > global)
  ├── builds named presets (chat, reasoning, tools, no-tools)
  └── no side effects beyond file reads

auto.ts (auto-prune decision)
  ├── parses threshold, decides if context usage warrants pruning
  └── pure logic, no I/O

format.ts (display)
  └── formats stats/config for TUI display

types.ts
  └── re-exports from @mariozechner/pi-agent-core
```

## Data Flow

```
User triggers prune (manual or auto)
  → index.ts: runPreset()
    → config.ts: loadConfig() + parsePreset()
    → index.ts: getMessages()
    → distill.ts: distillMessages(messages, config)
      ← returns { messages, stats }
    → index.ts: createPrunedSession()
      → writes new session file with pruned name
```

## Dependency Direction

```
index → { config, auto, distill, format }
distill → config (types only), types
config → types
auto → types
format → types
```

All arrows point inward. No circular dependencies. Business logic (distill, auto) has no knowledge of Pi extension APIs.

## Configuration Precedence

Defaults < `.pi/context-pruner.json` (local) < `~/.pi/agent/context-pruner.json` (global)
