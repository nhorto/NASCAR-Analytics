// Static-site generator for Cloudflare Pages. Renders every page to
// dist/<path>/index.html using the same render.ts the dev server uses, writes
// the client-page JSON, and copies the client assets. Run: `bun run export`.
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createDb } from "../providers/db.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { driversService } from "../domains/drivers/index.ts";
import * as render from "./render.ts";
import { seasonStatsPayload, trackTypePayload } from "./data.ts";

const DIST = "dist";
const SERIES_PREFIX: Record<number, string> = { 1: "", 2: "/xfinity", 3: "/trucks" };
const ALL_SERIES = [
  ingestionConfig.SERIES.cup,
  ingestionConfig.SERIES.xfinity,
  ingestionConfig.SERIES.trucks,
];

interface Log {
  info(msg: string): void;
}

/** URL path → dist file. "/" → index.html; "/xfinity/drivers/5" → xfinity/drivers/5/index.html */
function pageRel(urlPath: string): string {
  if (urlPath === "" || urlPath === "/") return "index.html";
  return urlPath.replace(/^\//, "") + "/index.html";
}

async function writePage(urlPath: string, html: string): Promise<void> {
  await Bun.write(join(DIST, pageRel(urlPath)), html);
}

export async function exportSite(dbPath = "data/nascar.db", log?: Log): Promise<{ pages: number }> {
  rmSync(DIST, { recursive: true, force: true });
  const db: Database = createDb(dbPath);
  const p = { db };
  let pages = 0;
  const write = async (urlPath: string, html: string) => {
    await writePage(urlPath, html);
    pages++;
  };

  for (const s of ALL_SERIES) {
    const prefix = SERIES_PREFIX[s]!;
    await write(prefix || "/", render.renderHome(p, s));
    await write(`${prefix}/drivers`, render.renderDriversIndex(p, s, null));

    for (const d of driversService.driverIndex(p, s)) {
      const html = render.renderDriverProfile(p, s, d.driverId);
      if (html) await write(`${prefix}/drivers/${d.driverId}`, html);
    }

    const latest = render.renderRacesIndex(p, s);
    if (latest) await write(`${prefix}/races`, latest);
    for (const yr of ingestionService.seasonsAvailable(p, s)) {
      const html = render.renderRacesIndex(p, s, yr);
      if (html) await write(`${prefix}/races/${yr}`, html);
    }

    const metrics = render.renderMetrics(p, s);
    if (metrics) await write(`${prefix}/metrics`, metrics);
    await write(`${prefix}/compare`, render.renderCompare(p, s));
    await write(`${prefix}/tracks`, render.renderTracks(p, s));

    await Bun.write(join(DIST, `data/season-stats-${s}.json`), JSON.stringify(seasonStatsPayload(p, s)));
    await Bun.write(join(DIST, `data/tracktype-${s}.json`), JSON.stringify(trackTypePayload(p, s)));
    log?.info(`series ${s}: pages so far ${pages}`);
  }

  // Race pages are un-prefixed (race_id is globally unique); one per race with results.
  const raceIds = db
    .query(`SELECT DISTINCT race_id AS id FROM results ORDER BY race_id`)
    .all() as Array<{ id: number }>;
  for (const { id } of raceIds) {
    const html = render.renderRacePage(p, id);
    if (html) await write(`/race/${id}`, html);
  }
  log?.info(`race pages: ${raceIds.length}`);

  // Static assets + 404.
  await Bun.write(join(DIST, "style.css"), Bun.file(new URL("./style.css", import.meta.url)));
  await Bun.write(join(DIST, "compare.js"), Bun.file(new URL("./client/compare.js", import.meta.url)));
  await Bun.write(join(DIST, "tracks.js"), Bun.file(new URL("./client/tracks.js", import.meta.url)));
  await Bun.write(join(DIST, "404.html"), render.render404(1, render.currentSeason(p, 1), "Page"));

  // Cloudflare Pages reads _headers from the output root. Data + assets change
  // only on a weekly rebuild, so a modest cache is safe.
  await Bun.write(
    join(DIST, "_headers"),
    `/data/*\n  Cache-Control: public, max-age=3600\n/*.css\n  Cache-Control: public, max-age=3600\n/*.js\n  Cache-Control: public, max-age=3600\n`,
  );

  db.close();
  return { pages };
}
