// Digest orchestration (WS-G): who gets the Monday recap / Thursday preview,
// and the guarantees around actually sending it. This is app-layer because it
// joins three domains — accounts (preferences, suppression, the send ledger),
// billing (preview is Pro-only), and analytics/predictions (the content) —
// which domain services may not do themselves.
//
// Guarantees:
//   * a (user, kind, race) triple is sent at most once, claimed in the db
//     BEFORE the attempt, so re-running a refresh never double-mails;
//   * one recipient's failure never aborts the batch (the outcome is recorded
//     and the loop continues);
//   * nothing is sent to unverified, suppressed, or opted-out addresses;
//   * `dryRun` builds everything and sends nothing.
import type { Providers } from "../providers/index.ts";
import type { EmailClient } from "../providers/email.ts";
import { accountsService, type EmailKind } from "../domains/accounts/index.ts";
import { billingService } from "../domains/billing/index.ts";
import { ingestionService, ingestionConfig } from "../domains/data-ingestion/index.ts";
import { analyticsService } from "../domains/analytics/index.ts";
import { predictionsService } from "../domains/predictions/index.ts";
import { seriesLabel } from "./layout.ts";
import { logLine } from "./http.ts";
import {
  previewEmail,
  recapEmail,
  type BuiltEmail,
  type PreviewEmailView,
  type RecapEmailView,
} from "./emails.ts";

type P = Pick<Providers, "db">;

const CUP = ingestionConfig.SERIES.cup;

export interface DigestDeps {
  email: EmailClient;
  /** Absolute origin for links (same value auth emails use). */
  baseUrl: string;
  now?: () => Date;
  log?: { info: (m: string) => void; warn: (m: string) => void };
  /** Build and report, send nothing. */
  dryRun?: boolean;
  /** Send only to this address (the owner's test-list acceptance run). */
  onlyTo?: string | null;
}

export interface DigestOutcome {
  kind: EmailKind;
  refId: number;
  subject: string;
  /** Opted-in verified non-suppressed users for this list. */
  considered: number;
  /** Dropped because the preview list is Pro-only. */
  skippedNotPro: number;
  /** Dropped because this exact digest was already sent to them. */
  skippedAlreadySent: number;
  sent: number;
  failed: number;
  dryRun: boolean;
}

/** Human summary for CLI/cron logs. */
export function formatOutcome(o: DigestOutcome): string {
  return (
    `${o.kind} digest for race ${o.refId}${o.dryRun ? " (dry run)" : ""}: ` +
    `${o.sent} sent, ${o.failed} failed, ${o.skippedAlreadySent} already sent, ` +
    `${o.skippedNotPro} not Pro, of ${o.considered} subscribers`
  );
}

// --- content builders ---

export function recapView(p: P, raceId: number): RecapEmailView | null {
  const race = ingestionService.raceDetails(p, raceId);
  if (!race) return null;
  const results = ingestionService.raceResults(p, raceId);
  if (results.length === 0) return null;
  const callouts = analyticsService.formCallouts(p, {
    seriesId: race.seriesId,
    season: race.season,
    raceId: race.raceId,
    raceDateUtc: race.raceDateUtc,
  });
  return {
    raceId: race.raceId,
    raceName: race.raceName,
    season: race.season,
    seriesLabel: seriesLabel(race.seriesId),
    results: results.map((r) => ({
      finish: r.finish,
      driver: r.fullName,
      start: r.start,
      lapsLed: r.lapsLed,
    })),
    standouts: analyticsService.raceStandouts(p, raceId).map((s) => ({
      driver: s.fullName,
      adjPassEfficiency: s.adjPassEfficiency,
      closerScore: s.closerScore,
    })),
    over: callouts.over.map((c) => ({ driver: c.fullName, finish: c.finish, delta: c.delta })),
    under: callouts.under.map((c) => ({ driver: c.fullName, finish: c.finish, delta: c.delta })),
  };
}

export function previewView(p: P, raceId: number): PreviewEmailView | null {
  const race = predictionsService.raceInfo(p, raceId);
  const run = predictionsService.latestPredictions(p, raceId);
  if (!race || !run || run.rows.length === 0) return null;
  return {
    raceId,
    raceName: race.raceName,
    season: race.season,
    trackType: race.trackType,
    stage: run.stage,
    generatedAt: run.rows[0]!.generatedAt,
    rows: run.rows.map((r) => ({
      driver: r.fullName,
      pWin: r.pWin,
      pTop5: r.pTop5,
      expFinish: r.expFinish,
    })),
    dfs: predictionsService
      .latestProjections(p, raceId, "dk")
      .map((d) => ({ driver: d.fullName, projectedPoints: d.projectedPoints })),
  };
}

// --- send loop ---

async function sendDigest(
  p: P,
  kind: EmailKind,
  refId: number,
  build: (unsubToken: string) => BuiltEmail,
  deps: DigestDeps,
): Promise<DigestOutcome> {
  const now = deps.now?.() ?? new Date();
  const recipients = accountsService.digestRecipients(p, kind).filter(
    (r) => !deps.onlyTo || r.email === deps.onlyTo.toLowerCase(),
  );
  const outcome: DigestOutcome = {
    kind,
    refId,
    subject: build("sample").subject,
    considered: recipients.length,
    skippedNotPro: 0,
    skippedAlreadySent: 0,
    sent: 0,
    failed: 0,
    dryRun: deps.dryRun === true,
  };

  for (const r of recipients) {
    // The preview list is a Pro capability (spec §4) — opting in doesn't grant it.
    if (kind === "preview" && !billingService.isPro(p, r.userId, now)) {
      outcome.skippedNotPro++;
      continue;
    }
    if (deps.dryRun) {
      outcome.sent++;
      continue;
    }
    if (!accountsService.claimDigestSend(p, r.userId, kind, refId, now)) {
      outcome.skippedAlreadySent++;
      continue;
    }
    const message = build(r.unsubToken);
    const result = await deps.email.send({
      to: r.email,
      subject: message.subject,
      text: message.text,
      headers: message.headers,
    });
    accountsService.recordDigestOutcome(p, r.userId, kind, refId, result.ok, result.detail);
    if (result.ok) outcome.sent++;
    else {
      outcome.failed++;
      deps.log?.warn(
        logLine("error", "digest send failed", { kind, refId, userId: r.userId, detail: result.detail }),
      );
    }
  }
  deps.log?.info(logLine("info", formatOutcome(outcome), { kind, refId }));
  return outcome;
}

/**
 * Monday recap for the latest completed race in a series (free list, opt-in).
 * Null when there is nothing to report yet.
 */
export async function sendRecapDigest(
  p: P,
  deps: DigestDeps,
  seriesId = CUP,
  raceId?: number,
): Promise<DigestOutcome | null> {
  const targetId = raceId ?? ingestionService.latestCompletedRace(p, seriesId)?.raceId ?? null;
  if (targetId === null) return null;
  const view = recapView(p, targetId);
  if (!view) return null;
  return sendDigest(p, "recap", targetId, (token) => recapEmail(view, { baseUrl: deps.baseUrl, unsubToken: token }), deps);
}

/**
 * Thursday preview for the most recent prediction run (Pro list, opt-in).
 * Null when no run is stored.
 */
export async function sendPreviewDigest(
  p: P,
  deps: DigestDeps,
  seriesId = CUP,
  raceId?: number,
): Promise<DigestOutcome | null> {
  const targetId = raceId ?? predictionsService.latestPredictedRaceId(p, seriesId);
  if (targetId === null) return null;
  const view = previewView(p, targetId);
  if (!view) return null;
  return sendDigest(p, "preview", targetId, (token) => previewEmail(view, { baseUrl: deps.baseUrl, unsubToken: token }), deps);
}
