# pnpm Monorepo Migration Design

**Date:** 2026-07-07
**Status:** Approved

## Objective

Unify three currently independent sub-projects (agent, web, slides) into a clean pnpm monorepo, with Node.js as the unified runtime.

## Motivation

Current problems:
- Three packages use three different runtimes (Bun, Node.js, Node.js)
- Mixed lockfiles: `bun.lock` ×2, `package-lock.json`
- Agent source lives at root (not in a package directory) — root = workspace root + agent code
- Inconsistent scripts (`bun` vs `npm` vs `npx`)

## Design

### 1. Directory Structure

```
cyber-stray/
├── pnpm-workspace.yaml
├── package.json                 # workspace root: orchestration scripts only
├── tsconfig.base.json           # shared strict TS config
├── eslint.config.mjs            # shared ESLint config
├── .env / .env.example
├── data/                  # runtime data (unchanged, gitignored per existing rules)
├── assets/
├── docs/
│   └── superpowers/
│       └── specs/
├── DESIGN.md
├── README.md
├── AGENTS.md
│
├── packages/
│   ├── agent/                   # @cyber-stray/agent
│   │   ├── package.json
│   │   ├── tsconfig.json        # extends ../../tsconfig.base.json
│   │   ├── vitest.config.ts
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent/           # state.ts, react.ts, planner.ts
│   │   │   ├── tools/           # registry/, search/, page/, push/, dedup/, feishu/
│   │   │   ├── memory/          # long-term/, reflection/, user-profile.ts, interest-graph.ts, feedback-*
│   │   │   ├── prompts/
│   │   │   ├── llm/
│   │   │   ├── tui/
│   │   │   ├── test/            # test helpers (useTempDataDir, etc.)
│   │   │   ├── config.ts
│   │   │   ├── types.ts
│   │   │   └── logger.ts
│   │   └── data/                # symlinked or DATA_DIR pointed to root data/
│   │
│   ├── web/                     # @cyber-stray/web (unchanged from current web/)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.ts
│   │   └── app/ components/ hooks/ lib/ public/
│   │
│   └── slides/                  # @cyber-stray/slides (unchanged from current slides/)
│       ├── package.json
│       └── slides.md
```

`data/` stays at root because agent reads files relative to cwd (`data/state.json`, `data/memory/`). The cwd is still the repo root when running `pnpm dev:agent`.

### 2. Package Names & Workspace Config

**pnpm-workspace.yaml:**
```yaml
packages:
  - 'packages/*'
```

**Package names:** `@cyber-stray/agent`, `@cyber-stray/web`, `@cyber-stray/slides`

### 3. Root package.json (orchestration only)

```jsonc
{
  "name": "cyber-stray",
  "private": true,
  "scripts": {
    "dev":          "pnpm -r dev",
    "dev:agent":    "pnpm --filter @cyber-stray/agent dev",
    "dev:web":      "pnpm --filter @cyber-stray/web dev",
    "dev:slides":   "pnpm --filter @cyber-stray/slides dev",
    "test":         "pnpm -r test",
    "lint":         "pnpm -r lint",
    "typecheck":    "pnpm -r typecheck",
    "build":        "pnpm -r build"
  }
}
```

### 4. Agent Package: Bun → Node.js Migration

**Source code:** No changes needed. All imports use standard Node.js APIs (`fs`, `fs/promises`).

**Dependency changes:**
- ADD: `tsx` — run TypeScript without compile step
- ADD: `vitest` — test runner (replaces `bun test`)
- REMOVE: `@types/bun` — no longer needed

**Script changes:**
- `"dev": "tsx src/index.ts"` (was `bun run src/index.ts`)
- `"test": "vitest"` (was `bun test`)
- `"typecheck": "tsc --noEmit"` (was `bun tsc --noEmit`)
- `"lint": "eslint src/"` (unchanged)

**tsconfig changes:**
- Remove `"types": ["bun"]`
- Extend from `../../tsconfig.base.json`
- Keep agent-specific options: `DOM lib`, `jsx`, `verbatimModuleSyntax`

**Test migration (15 files):**
- Replace `import { describe, test, expect, ... } from 'bun:test'` with `import { describe, test, expect, ... } from 'vitest'`
- API is compatible: `describe`, `test`/`it`, `expect`, `beforeEach`, `afterEach`, `mock` all work identically
- Add `vitest.config.ts` at `packages/agent/vitest.config.ts`

### 5. tsconfig Strategy

**tsconfig.base.json** (root, shared):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "noUncheckedIndexedAccess": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "allowImportingTsExtensions": true
  }
}
```

Each package extends and adds its own `lib`, `jsx`, `paths`, etc.

### 6. ESLint Strategy

Root `eslint.config.mjs` provides base config. Each package extends for its own framework (agent = vanilla TS, web = Next.js config, slides = none).

### 7. .gitignore Changes

- ADD: `pnpm-lock.yaml` → **tracked** (committed)
- REMOVE: `bun.lock` from gitignore (files will be deleted)
- REMOVE: `package-lock.json` from gitignore (files will be deleted)
- Keep all existing data/, .env, IDE rules unchanged

### 8. What Does NOT Change

- All `.ts` source code in agent (no Bun-specific APIs used)
- All web/ app code
- All slides/ code
- `data/` directory structure and runtime behavior
- `.env` / `.env.example` format
- `AGENTS.md` (will be updated for new paths)
- `DESIGN.md`, `README.md`

### 9. Verification Criteria

After migration:
- `pnpm install` at root succeeds, creates `pnpm-lock.yaml`
- `pnpm typecheck` passes across all packages
- `pnpm lint` passes
- `pnpm test` passes (all 15 agent test files + any web tests)
- `pnpm dev:agent` starts agent without errors
- `pnpm dev:web` starts Next.js dev server
- `pnpm dev:slides` starts Slidev dev server
