// Pure view-models for the driver list and profile.
import type { DriverProfile, DriverSummary, SeasonStatsRow } from "./api.ts";

export interface DriverListRow {
  driverId: number;
  name: string;
  line: string;
}

export function driverListRows(drivers: DriverSummary[], filter: string): DriverListRow[] {
  const needle = filter.trim().toLowerCase();
  return drivers
    .filter((d) => needle === "" || d.fullName.toLowerCase().includes(needle))
    .map((d) => ({
      driverId: d.driverId,
      name: d.fullName,
      line: [
        d.latestCarNumber ? `#${d.latestCarNumber}` : null,
        d.latestTeam,
        `${d.races} races`,
        d.wins > 0 ? `${d.wins} wins` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
}

export function fmt(value: number | null, digits = 1): string {
  return value === null ? "—" : value.toFixed(digits);
}

export interface StatLine {
  label: string;
  value: string;
}

export function seasonStatLines(row: SeasonStatsRow): StatLine[] {
  return [
    { label: "Races", value: String(row.races) },
    { label: "Wins", value: String(row.wins) },
    { label: "Top 5s", value: String(row.top5s) },
    { label: "Top 10s", value: String(row.top10s) },
    { label: "Avg start", value: fmt(row.avgStart) },
    { label: "Avg finish", value: fmt(row.avgFinish) },
    { label: "Laps led", value: String(row.lapsLed) },
    { label: "Rating", value: fmt(row.avgRating) },
    { label: "adjPE", value: fmt(row.adjPassEfficiency, 2) },
    { label: "Closer", value: fmt(row.closerScore, 2) },
  ];
}

export interface ProfileModel {
  name: string;
  subtitle: string;
  latestSeason: SeasonStatsRow | null;
  recentRaces: Array<{ key: string; line: string; finish: string }>;
}

export function profileModel(profile: DriverProfile): ProfileModel {
  const d = profile.driver;
  const latestSeason = profile.seasons.reduce<SeasonStatsRow | null>(
    (best, row) => (best === null || row.season > best.season ? row : best),
    null,
  );
  return {
    name: d.fullName,
    subtitle: [
      d.latestCarNumber ? `#${d.latestCarNumber}` : null,
      d.latestTeam,
      d.latestCarMake,
      `${d.firstSeason}–${d.lastSeason}`,
    ]
      .filter(Boolean)
      .join(" · "),
    latestSeason,
    recentRaces: profile.raceLog.slice(0, 10).map((race) => ({
      key: String(race.raceId),
      line: `${race.season} · ${race.raceName}${race.start !== null ? ` · started ${race.start}` : ""}`,
      finish: `P${race.finish}`,
    })),
  };
}
