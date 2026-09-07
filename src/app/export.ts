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
import { seasonStatsPayload, trackTypePayload, baselinesPayload } from "./data.ts";
import { offlineContent, PWA_ICONS, serviceWorkerSource, webManifest } from "./pwa.ts";
import { page } from "./layout.ts";
import { LIVE_API_BASE } from "./layout.ts";

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

  const careerIds = new Set<number>();
  for (const s of ALL_SERIES) {
    const prefix = SERIES_PREFIX[s]!;
    await write(prefix || "/", render.renderHome(p, s));
    await write(`${prefix}/drivers`, render.renderDriversIndex(p, s, null));

    for (const d of driversService.driverIndex(p, s)) {
      careerIds.add(d.driverId);
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
    await write(`${prefix}/live`, render.renderLive(p, s));

    // Weekly recap: the series' "this week" entry point, plus one per current-season
    // race with results (un-prefixed, race_id is global). Bounded to the current
    // season so the page count stays modest.
    const recap = render.renderLatestRecap(p, s);
    if (recap) await write(`${prefix}/recap`, recap);
    const curSeason = render.currentSeason(p, s);
    if (curSeason !== null) {
      for (const race of ingestionService.seasonRaces(p, curSeason, s)) {
        if (!race.hasResults) continue;
        const html = render.renderRecap(p, race.raceId);
        if (html) await write(`/recap/${race.raceId}`, html);
      }
    }

    await Bun.write(join(DIST, `data/season-stats-${s}.json`), JSON.stringify(seasonStatsPayload(p, s)));
    await Bun.write(join(DIST, `data/tracktype-${s}.json`), JSON.stringify(trackTypePayload(p, s)));
    await Bun.write(join(DIST, `data/baselines-${s}.json`), JSON.stringify(baselinesPayload(p, s)));
    log?.info(`series ${s}: pages so far ${pages}`);
  }

  // Career pages are un-prefixed (driver_id is global); one per distinct driver.
  for (const id of careerIds) {
    const html = render.renderCareer(p, id);
    if (html) await write(`/driver/${id}`, html);
  }
  log?.info(`career pages: ${careerIds.size}`);

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
  await Bun.write(join(DIST, "live.js"), Bun.file(new URL("./client/live.js", import.meta.url)));
  await Bun.write(join(DIST, "home-live.js"), Bun.file(new URL("./client/home-live.js", import.meta.url)));
  await Bun.write(join(DIST, "install.js"), Bun.file(new URL("./client/install.js", import.meta.url)));

  // PWA (WS-H): the static fallback host must be installable too, so the
  // manifest, worker, icons and offline page ship with the export.
  await Bun.write(join(DIST, "manifest.webmanifest"), JSON.stringify(webManifest()));
  await Bun.write(join(DIST, "sw.js"), serviceWorkerSource(new URL(LIVE_API_BASE).origin));
  for (const icon of PWA_ICONS) {
    await Bun.write(join(DIST, "icons", icon), Bun.file(new URL(`./static/icons/${icon}`, import.meta.url)));
  }
  await write(
    "/offline",
    page({
      title: "Offline",
      active: "home",
      seriesId: ingestionConfig.SERIES.cup,
      season: render.currentSeason(p, ingestionConfig.SERIES.cup),
      content: offlineContent(),
    }),
  );
  await Bun.write(join(DIST, "404.html"), render.render404(1, render.currentSeason(p, 1), "Page"));

  // Cloudflare Pages reads _headers from the output root. Data + assets change
  // only on a weekly rebuild, so a modest cache is safe.
  await Bun.write(
    join(DIST, "_headers"),
    `/data/*\n  Cache-Control: public, max-age=3600\n/*.css\n  Cache-Control: public, max-age=3600\n/*.js\n  Cache-Control: public, max-age=3600\n` +
      // The worker and manifest must revalidate, or an installed PWA pins
      // itself to a stale worker and never picks up a deploy. These MUST stay
      // after the `/*.js` rule above: Cloudflare applies every matching rule
      // and the last one to set a header wins.
      `/sw.js\n  Cache-Control: public, max-age=0, must-revalidate\n` +
      `/manifest.webmanifest\n  Cache-Control: public, max-age=0, must-revalidate\n`,
  );

  db.close();
  return { pages };
}
