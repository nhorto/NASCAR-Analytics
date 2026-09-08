import type { Database } from "bun:sqlite";
import { createDb } from "./db.ts";
import { createNascarCdnClient, type NascarCdnClient, type CdnClientOptions } from "./nascar-cdn.ts";
import { createRawArchive, createNullArchive, type RawArchive } from "./raw-archive.ts";
import { createHibpClient, createNullHibp, type HibpClient, type HibpOptions } from "./hibp.ts";

export interface Providers {
  db: Database;
  cdn: NascarCdnClient;
  archive: RawArchive;
  /** Breached-password lookup (WS-I). Always present; a null client is the
   *  explicit "check disabled" value, so no caller can silently skip it. */
  hibp: HibpClient;
}

export interface ProviderOptions {
  dbPath: string;
  /** Directory for raw JSON archival; null disables archival (tests). */
  archiveDir: string | null;
  cdn: CdnClientOptions;
  /** Breached-password check; null disables it (offline/dev runs). */
  hibp?: HibpOptions | null;
}

export function createProviders(opts: ProviderOptions): Providers {
  return {
    db: createDb(opts.dbPath),
    cdn: createNascarCdnClient(opts.cdn),
    archive: opts.archiveDir ? createRawArchive(opts.archiveDir) : createNullArchive(),
    hibp: opts.hibp === null ? createNullHibp() : createHibpClient(opts.hibp ?? {}),
  };
}

export type { NascarCdnClient, CdnFetchResult, CdnClientOptions } from "./nascar-cdn.ts";
export type { RawArchive } from "./raw-archive.ts";
export type { HibpClient, HibpOptions } from "./hibp.ts";
export { createDb } from "./db.ts";
export { createNullArchive } from "./raw-archive.ts";
export { createHibpClient, createNullHibp } from "./hibp.ts";
