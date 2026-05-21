.PHONY: check lint format test all clean

# Quality gate - runs all checks (mirrors CI)
all: check lint format test

# Typecheck
check:
	npx tsc -p tsconfig.json --noEmit

# Lint
lint:
	npx eslint .

# Format check (not write)
format:
	npx prettier . --check

# Run tests
test:
	npx vitest run

# Auto-fix formatting + lint
fix:
	npx prettier . --write
	npx eslint . --fix

# Security audit
audit:
	npm audit

clean:
	rm -rf node_modules .tmp coverage
