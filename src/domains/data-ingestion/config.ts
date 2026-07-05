import type { TrackType } from "./types.ts";

export const CDN_BASE = "https://cf.nascar.com";

export const SERIES = {
  cup: 1,
  xfinity: 2,
  trucks: 3,
} as const;

// Verified CDN coverage boundaries, confirmed against actual payloads during
// the 2026-07-05 backfill (docs/research/2026-07-05_data-sources-reverification.md):
// - 2016: schedule feed only; all per-race weekend-feeds return 403
// - 2016-2017 loopstats: HTTP 200 with a literal `null` body; 2018: 403
export const SCHEDULE_FIRST_SEASON = 2016;
export const BACKFILL_FIRST_SEASON = 2017;
export const LOOPSTATS_FIRST_SEASON = 2019;
export const LAPTIMES_FIRST_SEASON = 2020;

// Polite fetch behavior against the public CDN.
export const FETCH_DELAY_MS = 300;
export const FETCH_RETRIES = 3;
export const FETCH_RETRY_BASE_DELAY_MS = 1000;
export const USER_AGENT = "nascar-analytics/0.1 (personal research project)";

export function scheduleUrl(season: number, seriesId: number): string {
  return `${CDN_BASE}/cacher/${season}/${seriesId}/schedule-feed.json`;
}

export function weekendFeedUrl(season: number, seriesId: number, raceId: number): string {
  return `${CDN_BASE}/cacher/${season}/${seriesId}/${raceId}/weekend-feed.json`;
}

export function lapTimesUrl(season: number, seriesId: number, raceId: number): string {
  return `${CDN_BASE}/cacher/${season}/${seriesId}/${raceId}/lap-times.json`;
}

export function loopStatsUrl(season: number, seriesId: number, raceId: number): string {
  return `${CDN_BASE}/loopstats/prod/${season}/${seriesId}/${raceId}.json`;
}

// Track type classification, hand-curated from the distinct Cup tracks in the
// 2016-2026 schedule feeds. Buckets follow common analytical convention:
//   superspeedway = drafting-style racing (Daytona, Talladega, Atlanta 2022+)
//   short         = ovals ~1 mile and under (incl. flat miles: Phoenix, Loudon, Dover)
//   intermediate  = everything else oval (1.25mi+ incl. Pocono, Indy oval, Michigan)
//   road          = road and street courses
//   dirt          = dirt surface (Bristol Dirt 2021-2023)
// Road-course variants of ovals have their own track_ids, so only Atlanta's
// 2022 reprofile needs a season-based override.
export const TRACK_TYPES: Record<number, { name: string; type: TrackType }> = {
  4: { name: "Darlington Raceway", type: "intermediate" },
  14: { name: "Bristol Motor Speedway", type: "short" },
  22: { name: "Martinsville Speedway", type: "short" },
  26: { name: "Richmond International Raceway", type: "short" },
  34: { name: "Road America", type: "road" },
  38: { name: "Auto Club Speedway", type: "intermediate" },
  39: { name: "Chicagoland Speedway", type: "intermediate" },
  40: { name: "Homestead-Miami Speedway", type: "intermediate" },
  41: { name: "Kansas Speedway", type: "intermediate" },
  42: { name: "Las Vegas Motor Speedway", type: "intermediate" },
  43: { name: "Texas Motor Speedway", type: "intermediate" },
  45: { name: "World Wide Technology Raceway", type: "intermediate" },
  52: { name: "Nashville Superspeedway", type: "intermediate" },
  61: { name: "Kentucky Speedway", type: "intermediate" },
  75: { name: "Autódromo Hermanos Rodríguez", type: "road" },
  82: { name: "Talladega Superspeedway", type: "superspeedway" },
  84: { name: "Phoenix International Raceway", type: "short" },
  99: { name: "Sonoma Raceway", type: "road" },
  103: { name: "Dover International Speedway", type: "short" },
  105: { name: "Daytona International Speedway", type: "superspeedway" },
  111: { name: "Atlanta Motor Speedway", type: "intermediate" }, // pre-2022; see override
  123: { name: "Indianapolis Motor Speedway", type: "intermediate" },
  133: { name: "Michigan International Speedway", type: "intermediate" },
  138: { name: "New Hampshire Motor Speedway", type: "short" },
  157: { name: "Watkins Glen International", type: "road" },
  159: { name: "Bowman Gray Stadium", type: "short" },
  162: { name: "Charlotte Motor Speedway", type: "intermediate" },
  177: { name: "North Wilkesboro Speedway", type: "short" },
  198: { name: "Pocono Raceway", type: "intermediate" },
  206: { name: "Iowa Speedway", type: "short" },
  210: { name: "Charlotte Motor Speedway Road Course", type: "road" },
  211: { name: "Indianapolis Motor Speedway Road Course", type: "road" },
  212: { name: "DAYTONA Road Course", type: "road" },
  214: { name: "Circuit of The Americas", type: "road" },
  216: { name: "Bristol Motor Speedway Dirt", type: "dirt" },
  217: { name: "Los Angeles Memorial Coliseum", type: "short" },
  218: { name: "Chicago Street Race", type: "road" },
  221: { name: "San Diego Street Course", type: "road" },
};

// Atlanta was reprofiled ahead of the 2022 season into a drafting track.
const ATLANTA_TRACK_ID = 111;
const ATLANTA_SUPERSPEEDWAY_FROM = 2022;

export function trackTypeFor(trackId: number, season: number): TrackType {
  if (trackId === ATLANTA_TRACK_ID && season >= ATLANTA_SUPERSPEEDWAY_FROM) {
    return "superspeedway";
  }
  return TRACK_TYPES[trackId]?.type ?? "unknown";
}
