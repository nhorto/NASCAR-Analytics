# Security Requirements — NASCAR Analytics

## Authentication

- Phase 1: No auth (public analytics site)
- Phase 2: Email/password for premium tier (when subscription launches)
- Phase 3: OAuth with Google/Apple for frictionless signup

## API Keys

- Odds API key: stored in `.env`, never committed to git
- No other API keys needed for Phase 1 (NASCAR CDN is public)

## Input Validation

- All user-facing query parameters validated and sanitized
- No raw SQL — use parameterized queries only
- Rate limiting on API endpoints

## Data Protection

- No PII collected in Phase 1
- Phase 2 (subscriptions): payment handled by Stripe (no card data stored)
- User email addresses stored with encryption at rest

## Dependency Management

- Run `bun audit` regularly
- Pin dependency versions
- Review new dependencies before adding
