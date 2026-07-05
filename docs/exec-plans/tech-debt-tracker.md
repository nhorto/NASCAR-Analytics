# Tech Debt Tracker

> Known technical debt items. Log debt here, don't let it hide.

| Item | Severity | Domain | Description | Logged |
|------|----------|--------|-------------|--------|
| 2025 YellaWood 500 results missing | Low | data-ingestion | CDN weekend-feed serves `weekend_race: null` for race 5580. Loop stats + lap times ingested fine. Recoverable from nascaR.data if the drivers domain needs official results for it. | 2026-07-05 |
| race_type_id=3 unidentified | Low | data-ingestion | 341 races have race_type_id=1 (points), 28 have 2 (exhibition), 1 race has 3 — identify what 3 means before Phase 2 analytics filters on points races. | 2026-07-05 |
| weekend_runs not ingested | Low | data-ingestion | Practice/qualifying runs in weekend-feed are archived raw but not normalized into tables. Add if practice-speed analysis becomes a Phase 2 metric. | 2026-07-05 |
