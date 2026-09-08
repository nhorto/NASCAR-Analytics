import type { Database } from "bun:sqlite";
import { createDb } from "./db.ts";
import { createNascarCdnClient, type NascarCdnClient, type CdnClientOptions } from "./nascar-cdn.ts";
import { createRawArchive, createNullArchive, type RawArchive } from "./raw-archive.ts";
import { createHibpClient, createNullHibp, type HibpClient, type HibpOptions } from "./hibp.ts";
import { createStripeClient, createNullStripe, type StripeClient, type StripeOptions } from "./stripe.ts";

export interface Providers {
  db: Database;
  cdn: NascarCdnClient;
  archive: RawArchive;
  /** Breached-password lookup (WS-I). Always present; a null client is the
   *  explicit "check disabled" value, so no caller can silently skip it. */
  hibp: HibpClient;
  /** Stripe API (WS-E). Always present; the null client is the explicit
   *  "no Stripe account yet" value (webhooks only need the endpoint secret). */
  stripe: StripeClient;
}

export interface ProviderOptions {
  dbPath: string;
  /** Directory for raw JSON archival; null disables archival (tests). */
  archiveDir: string | null;
  cdn: CdnClientOptions;
  /** Breached-password check; null disables it (offline/dev runs). */
  hibp?: HibpOptions | null;
  /** Stripe API key; null/absent leaves the null client (pre-launch/dev). */
  stripe?: StripeOptions | null;
}

export function createProviders(opts: ProviderOptions): Providers {
  return {
    db: createDb(opts.dbPath),
    cdn: createNascarCdnClient(opts.cdn),
    archive: opts.archiveDir ? createRawArchive(opts.archiveDir) : createNullArchive(),
    hibp: opts.hibp === null ? createNullHibp() : createHibpClient(opts.hibp ?? {}),
    stripe: opts.stripe ? createStripeClient(opts.stripe) : createNullStripe(),
  };
}

export type { NascarCdnClient, CdnFetchResult, CdnClientOptions } from "./nascar-cdn.ts";
export type { RawArchive } from "./raw-archive.ts";
export type { HibpClient, HibpOptions } from "./hibp.ts";
export type { StripeClient, StripeOptions } from "./stripe.ts";
export { createDb } from "./db.ts";
export { createNullArchive } from "./raw-archive.ts";
export { createHibpClient, createNullHibp } from "./hibp.ts";
export { createStripeClient, createNullStripe } from "./stripe.ts";
