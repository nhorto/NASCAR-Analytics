# Tech Debt Tracker

> Known technical debt items. Log debt here, don't let it hide.

| Item | Severity | Domain | Description | Logged |
|------|----------|--------|-------------|--------|
| 2025 YellaWood 500 results missing | Low | data-ingestion | CDN weekend-feed serves `weekend_race: null` for race 5580. Loop stats + lap times ingested fine. Analytics counts its loop stats via `POINTS_RACE_ID_OVERRIDES` in analytics config; results-based 2025 stats are one race short. Recoverable from nascaR.data. | 2026-07-05 |
| ~~race_type_id=3 unidentified~~ RESOLVED | — | data-ingestion | Identified 2026-07-05: race 5586, the 2025 Cook Out Clash at Bowman Gray — an exhibition variant. Points filter is `race_type_id = 1`; analytics excludes 2 and 3. | 2026-07-05 |
| weekend_runs not ingested | Low | data-ingestion | Practice/qualifying runs in weekend-feed are archived raw but not normalized into tables. Add if practice-speed analysis becomes a Phase 2 metric. | 2026-07-05 |
| Expectation baselines are league-wide | Low | analytics | adjPE / Closer Score baselines pool all loop-data seasons (2019+) and all track types into one set of position buckets. Era (Next Gen vs Gen 6) and track-type effects aren't separated; small residual bias possible. Refine once the metrics get UI exposure. | 2026-07-05 |
| Desktop layout is single-column | Low | app | DESIGN.md layout rules call for 1-col mobile → multi-col desktop grids; the current shell is a centered 520px column on every viewport. Fine for the mobile-first MVP; widen when desktop usage matters. | 2026-07-05 |
| Track explorer has no season-range control | Low | app | The track-type explorer defaults to a loop-era window (current−7 → current, min 5 starts). Users can override via `?from=&to=&min=` but there's no UI control; low-frequency types (dirt) can still be sparse in some series. Add a range/min selector (the mockup's "Filters ⚙" placeholder). | 2026-07-05 |
| Form leaders can surface part-timers | Low | analytics | The "In Form" list ranks trailing-window form with only a `window_races ≥ 4` gate, so a Cup regular who made a handful of strong Xfinity starts can top that series' form board. Consider a recency/started-recently filter. | 2026-07-05 |
