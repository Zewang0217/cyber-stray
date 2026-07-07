# pnpm Monorepo Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify three sub-projects (agent, web, slides) into a clean pnpm monorepo with Node.js as the unified runtime, moving Bun to Node.js for the agent.

**Architecture:** pnpm workspace at root with `packages/*` layout. Three packages: `@cyber-stray/agent` (tsx + vitest, from Bun → Node.js), `@cyber-stray/web` (Next.js, unchanged), `@cyber-stray/slides` (Slidev, unchanged). Root `package.json` provides orchestration scripts only.

**Tech Stack:** pnpm 9+, Node.js, TypeScript strict, tsx (run TS), vitest (test), Vercel AI SDK v6, Next.js 16, Slidev

**Spec:** `docs/superpowers/specs/2026-07-07-pnpm-monorepo-migration-design.md`

---

### Task 1: Create pnpm workspace config

**Files:**
- Create: `pnpm-workspace.yaml`

- [ ] **Step 1: Create pnpm-workspace.yaml**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 2: Commit**

```bash
git add pnpm-workspace.yaml
git commit -m "chore: add pnpm-workspace.yaml"
```

---

### Task 2: Create tsconfig.base.json

**Files:**
- Create: `tsconfig.base.json`

- [ ] **Step 1: Create shared base tsconfig**

```jsonc
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "Preserve",
    "moduleDetection": "force",
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noPropertyAccessFromIndexSignature": false
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add tsconfig.base.json
git commit -m "chore: add shared tsconfig.base.json"
```

---

### Task 3: Create root package.json

**Files:**
- Create: `package.json` (overwrite existing)

- [ ] **Step 1: Write root package.json**

```jsonc
{
  "name": "cyber-stray",
  "private": true,
  "scripts": {
    "dev": "pnpm -r dev",
    "dev:agent": "pnpm --filter @cyber-stray/agent dev",
    "dev:web": "pnpm --filter @cyber-stray/web dev",
    "dev:slides": "pnpm --filter @cyber-stray/slides dev",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "typecheck": "pnpm -r typecheck",
    "build": "pnpm -r build"
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add package.json
git commit -m "chore: rewrite root package.json as pnpm workspace orchestration"
```

---

### Task 4: Move agent source into packages/agent/

**Files:**
- Create: `packages/agent/src/` (move all from `src/`)
- Remove: `src/`

- [ ] **Step 1: Create target directory and move files**

```powershell
New-Item -ItemType Directory -Force -Path "packages\agent"
Robocopy src packages\agent\src /E /MOVE
```

- [ ] **Step 2: Verify src/ is empty, then remove it**

```powershell
if ((Get-ChildItem -Path src -Recurse).Count -eq 0) { Remove-Item -Recurse -Force src }
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "refactor: move agent source to packages/agent/src"
```

---

### Task 5: Create packages/agent/package.json

**Files:**
- Create: `packages/agent/package.json`

- [ ] **Step 1: Write agent package.json**

```jsonc
{
  "name": "@cyber-stray/agent",
  "version": "0.1.0",
  "description": "赛博街溜子 - autonomous web-surfing AI agent",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "tsx src/index.ts",
    "test": "vitest",
    "lint": "eslint src/",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@ai-sdk/deepseek": "^2.0.29",
    "@ai-sdk/openai": "^3.0.53",
    "@larksuiteoapi/node-sdk": "^1.62.1",
    "@mozilla/readability": "^0.6.0",
    "ai": "6",
    "consola": "^3.4.2",
    "ink": "^7.0.1",
    "jsdom": "^29.0.2",
    "pptxgenjs": "^4.0.1",
    "react": "^19.2.5",
    "react-devtools-core": "^7.0.1",
    "zod": "4"
  },
  "devDependencies": {
    "@eslint/js": "^9",
    "@types/jsdom": "^28.0.1",
    "@types/mozilla__readability": "^0.4.2",
    "@types/node": "^20",
    "@types/react": "^19.2.14",
    "@types/react-dom": "^19.2.3",
    "eslint": "^9",
    "tsx": "^4",
    "typescript": "^5",
    "typescript-eslint": "^8",
    "vitest": "^3"
  }
}
```

Changes vs original root package.json:
- Removed `@types/bun`, `module` field, `keywords`, `author`, `contributors`, `license` (these are in root)
- Added `tsx`, `vitest`, `@eslint/js`, `eslint`, `typescript-eslint`, `@types/node`
- Changed name to `@cyber-stray/agent`

- [ ] **Step 2: Commit**

```bash
git add packages/agent/package.json
git commit -m "chore: add packages/agent/package.json with Node.js toolchain"
```

---

### Task 6: Create packages/agent/tsconfig.json

**Files:**
- Create: `packages/agent/tsconfig.json`

- [ ] **Step 1: Write agent tsconfig.json**

```jsonc
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "allowJs": true
  },
  "exclude": ["node_modules"]
}
```

Key differences from old root tsconfig:
- Removed `"types": ["bun"]`
- Extends base; only keeps agent-specific options

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @cyber-stray/agent typecheck`
Expected: PASS (or TypeScript errors that existed before migration — no new errors)

- [ ] **Step 3: Commit**

```bash
git add packages/agent/tsconfig.json
git commit -m "chore: add packages/agent/tsconfig.json extending base"
```

---

### Task 7: Create packages/agent/vitest.config.ts

**Files:**
- Create: `packages/agent/vitest.config.ts`

- [ ] **Step 1: Write vitest config**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/vitest.config.ts
git commit -m "chore: add vitest config for agent package"
```

---

### Task 8: Migrate test imports from bun:test to vitest

**Files:**
- Modify: All 15 `*.test.ts` files in `packages/agent/src/`

- [ ] **Step 1: Replace all `bun:test` imports with `vitest`**

Run this PowerShell command to batch-replace:

```powershell
Get-ChildItem -Path packages\agent\src -Filter *.test.ts -Recurse | ForEach-Object {
    $content = Get-Content $_.FullName -Raw
    $content = $content -replace "from 'bun:test'", "from 'vitest'"
    Set-Content -Path $_.FullName -Value $content -NoNewline
}
```

- [ ] **Step 2: Spot-check a few files to confirm the replacement**

Read the first line of a few test files:

```powershell
Get-ChildItem -Path packages\agent\src -Filter *.test.ts -Recurse | Select-Object -First 5 | ForEach-Object {
    Write-Host "--- $($_.FullName) ---"
    Get-Content $_.FullName -First 1
}
```

Expected: All show `from 'vitest'`, none show `from 'bun:test'`

- [ ] **Step 3: Commit**

```bash
git add packages/agent/src/**/*.test.ts
git commit -m "refactor: migrate test imports from bun:test to vitest"
```

---

### Task 9: Create packages/agent/eslint.config.mjs

**Files:**
- Create: `packages/agent/eslint.config.mjs`

- [ ] **Step 1: Write agent eslint config**

```javascript
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "no-undef": "off",
    },
  },
  {
    ignores: ["node_modules/", "coverage/"],
  },
);
```

- [ ] **Step 2: Commit**

```bash
git add packages/agent/eslint.config.mjs
git commit -m "chore: add eslint config for agent package"
```

---

### Task 10: Move web/ into packages/web/

**Files:**
- Move: `web/*` → `packages/web/*`
- Remove: `web/`

- [ ] **Step 1: Create target and move files**

```powershell
New-Item -ItemType Directory -Force -Path "packages\web"
Robocopy web packages\web /E /MOVE
```

- [ ] **Step 2: Remove empty web directory**

```powershell
if ((Get-ChildItem -Path web -Recurse -ErrorAction SilentlyContinue).Count -eq 0) { Remove-Item -Recurse -Force web }
```

- [ ] **Step 3: Update packages/web/package.json name**

Change `"name": "web"` to `"name": "@cyber-stray/web"`.

- [ ] **Step 4: Add typecheck and test scripts to packages/web/package.json**

In the `"scripts"` section, add:

```json
"test": "echo \"no tests yet\""
```

(web has no tests currently, this prevents `pnpm -r test` from failing)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: move web to packages/web, update package name"
```

---

### Task 11: Move slides/ into packages/slides/

**Files:**
- Move: `slides/*` → `packages/slides/*`
- Remove: `slides/`

- [ ] **Step 1: Create target and move files**

```powershell
New-Item -ItemType Directory -Force -Path "packages\slides"
Robocopy slides packages\slides /E /MOVE
```

- [ ] **Step 2: Remove empty slides directory**

```powershell
if ((Get-ChildItem -Path slides -Recurse -ErrorAction SilentlyContinue).Count -eq 0) { Remove-Item -Recurse -Force slides }
```

- [ ] **Step 3: Update packages/slides/package.json name**

Change `"name": "cyber-stray-slides"` to `"name": "@cyber-stray/slides"`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: move slides to packages/slides, update package name"
```

---

### Task 12: Remove old lockfiles and node_modules

**Files:**
- Delete: root `bun.lock`
- Delete: root `node_modules/`
- Delete: `packages/web/bun.lock`
- Delete: `packages/web/package-lock.json`
- Delete: `packages/web/node_modules/`
- Delete: `packages/slides/package-lock.json`
- Delete: `packages/slides/node_modules/`

- [ ] **Step 1: Delete old lockfiles and node_modules**

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force bun.lock -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\web\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force packages\web\bun.lock -ErrorAction SilentlyContinue
Remove-Item -Force packages\web\package-lock.json -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\slides\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force packages\slides\package-lock.json -ErrorAction SilentlyContinue
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: remove old lockfiles and node_modules (migrating to pnpm)"
```

---

### Task 13: Update .gitignore

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Update .gitignore**

Replace these lines:

```
# Node/Bun
node_modules/
dist/
*.tsbuildinfo
bun.lock

# Package lock (use bun.lock)
package-lock.json
```

With:

```
# pnpm
node_modules/
dist/
*.tsbuildinfo
```

(Remove `bun.lock` and `package-lock.json` from gitignore — `pnpm-lock.yaml` should be tracked, and those files will be deleted)

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: update .gitignore for pnpm migration"
```

---

### Task 14: Install dependencies with pnpm

**Files:**
- Create: `pnpm-lock.yaml` (generated by pnpm)

- [ ] **Step 1: Install all workspace dependencies**

```powershell
pnpm install
```

- [ ] **Step 2: Verify lockfile was created**

```powershell
Test-Path pnpm-lock.yaml
```

Expected: `True`

- [ ] **Step 3: Commit pnpm-lock.yaml**

```bash
git add pnpm-lock.yaml
git commit -m "chore: add pnpm-lock.yaml"
```

---

### Task 15: Run typecheck across all packages

- [ ] **Step 1: Run typecheck for all packages**

```powershell
pnpm typecheck
```

Expected: PASS across all packages. If errors, fix before continuing.

- [ ] **Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: typecheck issues after migration"
```

---

### Task 16: Run lint across all packages

- [ ] **Step 1: Run lint**

```powershell
pnpm lint
```

Expected: PASS. If errors, fix before continuing.

- [ ] **Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: lint issues after migration"
```

---

### Task 17: Run tests

- [ ] **Step 1: Run tests for all packages**

```powershell
pnpm test
```

Expected: All 15 agent tests pass. Web/slides show "no tests yet".

- [ ] **Step 2: Commit any fixes if needed**

```bash
git add -A
git commit -m "fix: test issues after migration"
```

---

### Task 18: Remove old root tsconfig.json

**Files:**
- Delete: root `tsconfig.json` (replaced by `tsconfig.base.json` + per-package tsconfigs)

- [ ] **Step 1: Delete old root tsconfig.json**

```powershell
Remove-Item tsconfig.json
```

- [ ] **Step 2: Verify typecheck still passes from root**

```powershell
pnpm typecheck
```

Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove old root tsconfig.json (replaced by base + per-package)"
```

---

### Task 19: Update AGENTS.md

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Update AGENTS.md paths and commands**

Replace the Commands section:

```
### Root Agent
```bash
bun install              # Install deps (Bun runtime, ESM)
bun run dev              # Start agent (TUI + heartbeat scheduler)
bun test                 # Run all tests (auto-discovers *.test.ts)
bun run lint             # ESLint (src/ only)
bun run typecheck        # tsc --noEmit
```

### Web Dashboard
```bash
cd web
bun install              # Separate package, separate deps
bun run dev              # Next.js dev server
bun run build            # Production build
bun run lint             # ESLint
bun run typecheck        # tsc --noEmit
```

With:

```
```bash
pnpm install             # Install all workspace deps
pnpm dev:agent           # Start agent (TUI + heartbeat)
pnpm dev:web             # Start Next.js dashboard
pnpm dev:slides          # Start Slidev presentation
pnpm test                # Run all tests
pnpm lint                # Lint all packages
pnpm typecheck           # Typecheck all packages
```

- [ ] **Step 2: Update architecture file paths**

- `src/index.ts` → `packages/agent/src/index.ts`
- `src/agent/react.ts` → `packages/agent/src/agent/react.ts`
- All `src/` paths → `packages/agent/src/`
- Remove Bun-specific gotcha, add Node.js toolchain note

- [ ] **Step 3: Add pnpm-specific gotcha**

Add a new gotcha item:
```
9. **pnpm workspace** — install deps with `pnpm install` at root. `tsx` runs agent TS directly, `vitest` for tests.
```

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: update AGENTS.md for pnpm monorepo"
```

---

### Task 20: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update commands section**

Replace with:

```
## 常用命令

```bash
# 依赖安装（根目录）
pnpm install             # 安装所有 workspace 包

# Agent 运行
pnpm dev:agent           # 启动 Agent（TUI + 内嵌心跳）
pnpm --filter @cyber-stray/agent test   # 运行 Agent 测试
pnpm --filter @cyber-stray/agent lint   # ESLint 检查
pnpm --filter @cyber-stray/agent typecheck  # TypeScript 类型检查

# Web Dashboard
pnpm dev:web             # 启动 Next.js 开发服务器
pnpm --filter @cyber-stray/web build     # 生产构建
pnpm --filter @cyber-stray/web lint      # ESLint 检查
pnpm --filter @cyber-stray/web typecheck # TypeScript 类型检查

# 全部
pnpm test                # 所有包测试
pnpm lint                # 所有包 lint
pnpm typecheck           # 所有包 typecheck
```

- [ ] **Step 2: Update architecture paths**

Update all `src/` references to `packages/agent/src/`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for pnpm monorepo"
```

---

### Task 21: Final verification - clean install from scratch

- [ ] **Step 1: Remove node_modules and lockfile, reinstall**

```powershell
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\agent\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\web\node_modules -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force packages\slides\node_modules -ErrorAction SilentlyContinue
Remove-Item -Force pnpm-lock.yaml -ErrorAction SilentlyContinue
pnpm install
```

- [ ] **Step 2: Full check**

```powershell
pnpm typecheck
if ($?) { Write-Host "typecheck PASS" }

pnpm lint
if ($?) { Write-Host "lint PASS" }

pnpm test
if ($?) { Write-Host "test PASS" }
```

Expected: All three PASS

- [ ] **Step 3: Commit pnpm-lock.yaml**

```bash
git add pnpm-lock.yaml
git commit -m "chore: regenerate pnpm-lock.yaml after clean install"
```
