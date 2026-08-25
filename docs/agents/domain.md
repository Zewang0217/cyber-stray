# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout: multi-context

This is a pnpm monorepo with **multi-context** domain docs — a root `CONTEXT-MAP.md` points at per-context `CONTEXT.md` files.

```
/
├── CONTEXT.md                  ← system-wide SaaS shared vocabulary + locked decisions
├── CONTEXT-MAP.md              ← points at each per-context CONTEXT.md
├── docs/adr/                   ← system-wide architectural decisions
└── packages/
    ├── agent/
    │   ├── CONTEXT.md          ← agent runtime domain (ReAct / memory / reflection / push gate)
    │   └── docs/adr/           ← agent-scoped decisions
    ├── web/
    │   ├── CONTEXT.md          ← web dashboard domain (read-only contract)
    │   └── docs/adr/
    ├── control-plane/
    │   ├── CONTEXT.md          ← control plane domain (auth / billing / scheduling)
    │   └── docs/adr/
    └── slides/
        ├── CONTEXT.md
        └── docs/adr/
```

## Before exploring, read these

1. **`CONTEXT-MAP.md`** at the repo root — it points at each per-context `CONTEXT.md`. Read the ones relevant to the topic you're working on.
2. **Root `CONTEXT.md`** — system-wide SaaS shared vocabulary and locked decisions (pricing, multi-tenancy, auth, real-time, feedback loop). Read this for any cross-package work.
3. **Per-package `packages/<pkg>/CONTEXT.md`** — read the one(s) for the package(s) you touch.
4. **`docs/adr/`** at the root — system-wide ADRs. Also check `packages/<pkg>/docs/adr/` for package-scoped decisions.

## Current state

- **Root `CONTEXT.md`** exists — SaaS shared vocabulary + locked decisions (from issue #42 RFC). It is the system-wide glossary.
- **`CONTEXT-MAP.md`** — created by this setup, pointing at the contexts below.
- **Per-package `CONTEXT.md`** — **not yet created** for any package. They are created lazily by the `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) when terms or decisions actually get resolved for that package. Do not create empty stubs upfront.
- **`docs/adr/`** — 系统级 ADR（现有：0005 口头禅系统）；包级 `packages/<pkg>/docs/adr/` 由 `/domain-modeling` 按需创建。

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in the relevant `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

Key terms from the root `CONTEXT.md` (use these exact terms):

- **租户 tenant** — paying/registration unit (≈ org). Billing hangs off tenant, not pet.
- **宠物 pet** — one independent agent instance: own state / memory / interests / push.
- **控制面 control plane** — pooled shared services: auth / billing / web / push gateway.
- **伴侣端 companion** — owner's interaction surface (PWA first).
- **通道 channel** — push backend (Feishu / Telegram), per-tenant bound, optional.
- **数据目录 data dir** — tenant-isolated markdown persistence unit (`DATA_DIR`).

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders) — but worth reopening because…_
