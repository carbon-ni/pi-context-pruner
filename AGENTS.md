# pi-context-pruner

A Pi extension that automatically prunes conversation context when it grows too large, distilling message history into a compact summary.

## Commands

| Make target   | What it does                                     |
| ------------- | ------------------------------------------------ |
| `make all`    | Full quality gate (check + lint + format + test) |
| `make check`  | TypeScript typecheck                             |
| `make lint`   | ESLint                                           |
| `make format` | Prettier check (dry-run)                         |
| `make test`   | Vitest unit tests                                |
| `make fix`    | Auto-fix lint + format                           |
| `make clean`  | Remove node_modules, .tmp, coverage              |

## Git Hooks

```bash
git config core.hooksPath .githooks
```

Pre-commit runs: format, typecheck, lint, tests. Blocks commit on failure.

## Project Structure

```
src/
  auto.ts              # Auto-prune threshold logic
  auto.test.ts         # Tests for auto-prune
  config.ts            # Config loading + presets
  config.test.ts       # Tests for config
  distill.ts           # Core distillation algorithm
  distill.test.ts      # Tests for distillation
  format.ts            # Display formatting helpers
  index.ts             # Extension entry point (registers commands/hooks)
  index.test.ts        # Tests for extension flow
  session-name.test.ts # Tests for session naming
  types.ts             # Type re-exports from pi-agent-core
```

Tests are co-located with source files. No separate test directory.

## Configuration

Users can place `.pi/context-pruner.json` in their project or `~/.pi/agent/context-pruner.json` globally.

## Anti-patterns

- Do not add a separate `test/` directory. Co-locate tests.
- Do not bypass `make all` before committing.
- Do not use external dependencies in business logic files (distill, auto). Keep them in infra/index.
