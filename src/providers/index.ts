import type { Database } from "bun:sqlite";
import { createDb } from "./db.ts";
import { createNascarCdnClient, type NascarCdnClient, type CdnClientOptions } from "./nascar-cdn.ts";
import { createRawArchive, createNullArchive, type RawArchive } from "./raw-archive.ts";

export interface Providers {
  db: Database;
  cdn: NascarCdnClient;
  archive: RawArchive;
}

export interface ProviderOptions {
  dbPath: string;
  /** Directory for raw JSON archival; null disables archival (tests). */
  archiveDir: string | null;
  cdn: CdnClientOptions;
}

export function createProviders(opts: ProviderOptions): Providers {
  return {
    db: createDb(opts.dbPath),
    cdn: createNascarCdnClient(opts.cdn),
    archive: opts.archiveDir ? createRawArchive(opts.archiveDir) : createNullArchive(),
  };
}

export type { NascarCdnClient, CdnFetchResult, CdnClientOptions } from "./nascar-cdn.ts";
export type { RawArchive } from "./raw-archive.ts";
export { createDb } from "./db.ts";
export { createNullArchive } from "./raw-archive.ts";
