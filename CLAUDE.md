# NASCAR Analytics

A modern NASCAR analytics platform combining loop data, proprietary stats, and betting context — built to replace the outdated tools fans currently rely on.

## How to Orient in This Repo (Read This First)

> This is a map, not a manual. Read what you need for your current task.

| If you need to... | Read this |
|-------------------|-----------|
| Understand the project purpose | docs/PRODUCT_SENSE.md |
| See the code map and architecture | ARCHITECTURE.md |
| See what's been built and what's in progress | docs/PLANS.md |
| See active work | docs/exec-plans/active/ |
| See completed work and past decisions | docs/exec-plans/completed/ |
| Understand a design decision | docs/design-docs/index.md |
| Check quality standards | docs/QUALITY_SCORE.md |
| Understand security requirements | docs/SECURITY.md |
| Understand reliability standards | docs/RELIABILITY.md |
| See research and market analysis | docs/research/ |

## Agent Workflow (MANDATORY — No Exceptions)

Every non-trivial change follows this sequence. These are not suggestions.

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
9. If the plan is complete:
   - Move the plan file from `docs/exec-plans/active/` to `docs/exec-plans/completed/`
   - Update `docs/PLANS.md`: move entry from Active to Completed table
10. If you changed project structure → update `ARCHITECTURE.md`
11. If you changed capabilities → update "Current Guarantees" and "What Does NOT Exist" in ARCHITECTURE.md
12. If quality changed → update `docs/QUALITY_SCORE.md`
13. If you introduced tech debt → log in `docs/exec-plans/tech-debt-tracker.md`

## Tools & Package Management

Default to using Bun for everything.

- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of jest/vitest
- Use `bun install` instead of npm/yarn/pnpm
- Use `Bun.serve()` for HTTP servers
- Bun automatically loads `.env` files

## Repository Knowledge System

All project knowledge lives in the repo. If it's not in the repo, it doesn't exist for agents.

```
ARCHITECTURE.md              Code map — where things are and architectural constraints
docs/
├── PLANS.md                 Index of all execution plans (active + completed)
├── DESIGN.md                Design system and UI patterns
├── PRODUCT_SENSE.md         Product vision, beliefs, north star metric
├── QUALITY_SCORE.md         Quality grades per domain/layer
├── RELIABILITY.md           Reliability standards and error recovery
├── SECURITY.md              Security requirements and practices
├── design-docs/             Design decisions and methodology
│   └── index.md             Index of all design docs
├── exec-plans/              Implementation plans
│   ├── active/              Work in progress
│   ├── completed/           Finished plans and decisions
│   └── tech-debt-tracker.md Known tech debt
├── generated/               Auto-generated docs (DB schema, etc.)
├── product-specs/           Product specifications
│   └── index.md             Index of product specs
├── references/              Research and reference material
└── research/                Market research and data source analysis
```

## Architectural Constraints

Dependencies flow in one direction only:

```
Utils → Types → Providers → Domains → App
```

Within each domain:
```
Types → Config → Repo → Service → Runtime → UI
```

Key rules:
- Types have zero runtime imports
- Service functions contain business logic (pure where possible)
- Cross-cutting concerns enter through Providers only
- Cross-domain internal access is forbidden — call the owning domain's service instead
- See ARCHITECTURE.md for the full DDD layer model reference

## Documentation Rules

- If you change project structure → update `ARCHITECTURE.md`
- If you add tech debt → log in `docs/exec-plans/tech-debt-tracker.md`
- New features need an exec plan in `docs/exec-plans/active/` before implementation
- Completed plans move to `docs/exec-plans/completed/`
- Plan lifecycle is mandatory: create → implement → verify → move to completed
