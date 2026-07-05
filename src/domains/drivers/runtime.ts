// JSON API handlers: parse params -> call service -> Response.
import type { Providers } from "../../providers/index.ts";
import { DEFAULT_SERIES_ID } from "./config.ts";
import * as service from "./service.ts";

type Db = Pick<Providers, "db">;

/** Series query param, clamped to the three national series (default Cup). */
function seriesOf(url: URL): number {
  const s = Number.parseInt(url.searchParams.get("series") ?? "", 10);
  return s === 2 || s === 3 ? s : DEFAULT_SERIES_ID;
}

export function handleDriverIndex(p: Db, url: URL): Response {
  const seriesId = seriesOf(url);
  const q = url.searchParams.get("q");
  let drivers = service.driverIndex(p, seriesId);
  if (q) drivers = drivers.filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()));
  return Response.json({ seriesId, drivers });
}

export function handleDriver(p: Db, idParam: string, url: URL): Response {
  const seriesId = seriesOf(url);
  const id = Number.parseInt(idParam, 10);
  if (Number.isNaN(id)) return Response.json({ error: "invalid driver id" }, { status: 400 });
  const driver = service.findDriver(p, id, seriesId);
  if (!driver) return Response.json({ error: "driver not found" }, { status: 404 });
  return Response.json({ driver, raceLog: service.driverRaceLog(p, id, seriesId) });
}

/** Cross-series career; series-agnostic (driver_id is global). */
export function handleDriverCareer(p: Db, idParam: string): Response {
  const id = Number.parseInt(idParam, 10);
  if (Number.isNaN(id)) return Response.json({ error: "invalid driver id" }, { status: 400 });
  const career = service.driverCareer(p, id);
  if (!career) return Response.json({ error: "driver not found" }, { status: 404 });
  return Response.json(career);
}
