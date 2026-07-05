// JSON API handlers: parse params -> call service -> Response.
import type { Providers } from "../../providers/index.ts";
import * as service from "./service.ts";

type Db = Pick<Providers, "db">;

export function handleDriverIndex(p: Db, url: URL): Response {
  const q = url.searchParams.get("q");
  let drivers = service.driverIndex(p);
  if (q) drivers = drivers.filter((d) => d.fullName.toLowerCase().includes(q.toLowerCase()));
  return Response.json({ drivers });
}

export function handleDriver(p: Db, idParam: string): Response {
  const id = Number.parseInt(idParam, 10);
  if (Number.isNaN(id)) return Response.json({ error: "invalid driver id" }, { status: 400 });
  const driver = service.findDriver(p, id);
  if (!driver) return Response.json({ error: "driver not found" }, { status: 404 });
  return Response.json({ driver, raceLog: service.driverRaceLog(p, id) });
}
