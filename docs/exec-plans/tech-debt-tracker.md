# Tech Debt Tracker

> Known technical debt items. Log debt here, don't let it hide.

| Item | Severity | Domain | Description | Logged |
|------|----------|--------|-------------|--------|
| 2025 YellaWood 500 results missing | Low | data-ingestion | CDN weekend-feed serves `weekend_race: null` for race 5580. Loop stats + lap times ingested fine. Analytics counts its loop stats via `POINTS_RACE_ID_OVERRIDES` in analytics config; results-based 2025 stats are one race short. Recoverable from nascaR.data. | 2026-07-05 |
| ~~race_type_id=3 unidentified~~ RESOLVED | — | data-ingestion | Identified 2026-07-05: race 5586, the 2025 Cook Out Clash at Bowman Gray — an exhibition variant. Points filter is `race_type_id = 1`; analytics excludes 2 and 3. | 2026-07-05 |
| weekend_runs not ingested | Low | data-ingestion | Practice/qualifying runs in weekend-feed are archived raw but not normalized into tables. Add if practice-speed analysis becomes a Phase 2 metric. | 2026-07-05 |
| Expectation baselines are league-wide | Low | analytics | adjPE / Closer Score baselines pool all loop-data seasons (2019+) and all track types into one set of position buckets. Era (Next Gen vs Gen 6) and track-type effects aren't separated; small residual bias possible. Refine once the metrics get UI exposure. | 2026-07-05 |
