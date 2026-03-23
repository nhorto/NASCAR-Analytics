# NASCAR Analytics

A modern NASCAR analytics platform combining loop data, proprietary stats, and betting context.

## How to Orient

| If you need to... | Read this |
|-------------------|-----------|
| Understand the project purpose | docs/PRODUCT_SENSE.md |
| See the code map and architecture | ARCHITECTURE.md |
| See what's been built and what's in progress | docs/PLANS.md |
| See active work | docs/exec-plans/active/ |
| See completed work and past decisions | docs/exec-plans/completed/ |
| Understand a design decision | docs/design-docs/index.md |
| Check quality standards | docs/QUALITY_SCORE.md |
| See research and market analysis | docs/research/ |

## Agent Workflow (MANDATORY)

Every non-trivial change follows this sequence:

### Before You Start
1. Read ARCHITECTURE.md to understand the code map
2. Read docs/PLANS.md to see what's done and what's in progress
3. If your task relates to an existing plan, read that plan

### Plan
4. Create or update an exec plan in `docs/exec-plans/active/`
5. Update `docs/PLANS.md` with the plan entry (status: ACTIVE)

### Implement
6. Follow the plan. If the plan needs to change, update the plan document FIRST, then implement.

### Verify
7. Self-review: correctness, edge cases, test coverage
8. Run ALL tests (including architecture tests) — zero failures required

### Update Documentation (DO NOT SKIP)
9. Complete → move plan from `active/` to `completed/`, update PLANS.md
10. Structure changed → update ARCHITECTURE.md
11. Capabilities changed → update "Current Guarantees" and "What Does NOT Exist"
12. Quality changed → update QUALITY_SCORE.md
13. Tech debt introduced → log in tech-debt-tracker.md

## Stack

- **Runtime/Package Manager:** Bun (not Node, not npm/yarn/pnpm)
- **Language:** TypeScript
- **HTTP:** `Bun.serve()` (not express)
- **Database:** `bun:sqlite` for local, `Bun.sql` for Postgres
- **Tests:** `bun test`
- **Env:** Bun auto-loads `.env`

## Architecture

Dependencies flow one direction: `Utils → Types → Providers → Domains → App`

Within domains: `Types → Config → Repo → Service → Runtime → UI`

- Types = pure type definitions, zero runtime code
- Service = business logic (pure where possible)
- Providers = single interface for external dependencies (db, APIs)
- Cross-domain: import types only, never internals

## Documentation Rules

- Structure changes → update ARCHITECTURE.md
- New features → exec plan in `active/` first
- Completed → move to `completed/`, update PLANS.md
- Tech debt → log in tech-debt-tracker.md
