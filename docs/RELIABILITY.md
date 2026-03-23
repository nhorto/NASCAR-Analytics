# Reliability Standards — NASCAR Analytics

## Error Handling

- NASCAR CDN endpoints may be unavailable during non-race periods — handle gracefully
- Odds API may rate-limit — implement exponential backoff
- All external data fetches should have timeouts and fallback to cached data

## Data Freshness

- Race results: updated within 1 hour of race completion
- Loop data: updated as soon as NASCAR publishes (typically same day)
- Betting odds: real-time during race weekends, cached otherwise
- Historical data: updated weekly during season

## Graceful Degradation

- If NASCAR CDN is down → serve cached data with "last updated" timestamp
- If Odds API is unavailable → hide odds section, show analytics only
- If database is slow → prioritize most-requested data (current season)

## Health Checks

TBD — to be defined during deployment setup.
