// Digest orchestration (WS-G): who gets mail, who doesn't, and what happens
// when a send fails. Every guarantee in mail.ts has a negative case here —
// these are the tests that stand between a subscriber and a duplicate (or
// unwanted) email.
import { beforeEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import type { EmailClient, EmailMessage } from "../src/providers/email.ts";
import { accountsService } from "../src/domains/accounts/index.ts";
import { billingService } from "../src/domains/billing/index.ts";
import { analyticsService } from "../src/domains/analytics/index.ts";
import { predictionsService } from "../src/domains/predictions/index.ts";
import { sendPreviewDigest, sendRecapDigest, recapView, previewView } from "../src/app/mail.ts";
import { testDb, seedDriver, seedRace, seedResult, seedLoop, seedUser } from "./seed.ts";

const NOW = new Date("2026-09-07T12:00:00Z");

function capturingClient(failFor: string[] = []): EmailClient & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    configured: true,
    sent,
    async send(msg) {
      if (failFor.includes(msg.to)) return { ok: false, detail: "hard bounce (test)" };
      sent.push(msg);
      return { ok: true, detail: "sent" };
    },
  };
}

function makeUser(
  p: { db: Database },
  email: string,
  opts: { verified?: boolean; recap?: boolean; preview?: boolean; pro?: boolean } = {},
): number {
  const userId = seedUser(p.db, { email, verified: opts.verified !== false });
  if (opts.recap) accountsService.setEmailPref(p, userId, "recap", true, NOW);
  if (opts.preview) accountsService.setEmailPref(p, userId, "preview", true, NOW);
  if (opts.pro) billingService.grantPro(p, userId, "2027-12-31T00:00:00Z", "grant", NOW);
  return userId;
}

function seedRaceWorld(db: Database): void {
  seedDriver(db, 10, "Alpha Driver");
  seedDriver(db, 11, "Beta Driver");
  for (const [i, season] of [2025, 2026].entries()) {
    const raceId = 700 + i;
    seedRace(db, { raceId, season, raceName: `Test ${season}`, raceDateUtc: `${season}-05-01T18:00:00` });
    seedResult(db, { raceId, driverId: 10, finish: 1, start: 4, lapsLed: 88, points: 45 });
    seedResult(db, { raceId, driverId: 11, finish: 2, start: 1, lapsLed: 12, points: 40 });
    seedLoop(db, { raceId, driverId: 10, avgPs: 3, passesGf: 40, passedGf: 20, fastLaps: 30, top15Laps: 90, rating: 110 });
    seedLoop(db, { raceId, driverId: 11, avgPs: 5, passesGf: 30, passedGf: 28, fastLaps: 8, top15Laps: 70, rating: 92 });
  }
  analyticsService.computeAll({ db });
}

let db: Database;
let p: { db: Database };

beforeEach(() => {
  db = testDb();
  p = { db };
  seedRaceWorld(db);
});

function deps(email: EmailClient, extra: Record<string, unknown> = {}) {
  return { email, baseUrl: "https://looplab.test", now: () => NOW, ...extra };
}

describe("recap digest", () => {
  test("goes to opted-in verified subscribers only", async () => {
    makeUser(p, "in@example.com", { recap: true });
    makeUser(p, "out@example.com", { recap: false });
    makeUser(p, "unverified@example.com", { recap: true, verified: false });
    const client = capturingClient();

    const outcome = (await sendRecapDigest(p, deps(client)))!;

    expect(outcome.considered).toBe(1);
    expect(outcome.sent).toBe(1);
    expect(client.sent.map((m) => m.to)).toEqual(["in@example.com"]);
    expect(client.sent[0]!.subject).toContain("Alpha Driver wins");
  });

  test("the same race is never sent twice, even if the refresh re-runs", async () => {
    makeUser(p, "in@example.com", { recap: true });
    const client = capturingClient();

    const first = (await sendRecapDigest(p, deps(client)))!;
    const second = (await sendRecapDigest(p, deps(client)))!;

    expect(first.sent).toBe(1);
    expect(second.sent).toBe(0);
    expect(second.skippedAlreadySent).toBe(1);
    expect(client.sent.length).toBe(1);
  });

  test("a suppressed address is dropped, and the rest of the batch still goes", async () => {
    makeUser(p, "bounced@example.com", { recap: true });
    makeUser(p, "fine@example.com", { recap: true });
    accountsService.suppressAddress(p, "bounced@example.com", "bounced", NOW);
    const client = capturingClient();

    const outcome = (await sendRecapDigest(p, deps(client)))!;

    expect(outcome.considered).toBe(1);
    expect(client.sent.map((m) => m.to)).toEqual(["fine@example.com"]);
  });

  test("a failed delivery is retried on the next run, then settles", async () => {
    makeUser(p, "flaky@example.com", { recap: true });
    const failing = capturingClient(["flaky@example.com"]);

    const first = (await sendRecapDigest(p, deps(failing)))!;
    expect(first.failed).toBe(1);

    // The provider key arrives / the outage ends — the retry must go through.
    const working = capturingClient();
    const second = (await sendRecapDigest(p, deps(working)))!;
    expect(second.sent).toBe(1);
    expect(working.sent.map((m) => m.to)).toEqual(["flaky@example.com"]);

    const third = (await sendRecapDigest(p, deps(working)))!;
    expect(third.sent).toBe(0);
    expect(third.skippedAlreadySent).toBe(1);
  });

  test("one failing send is recorded without aborting the batch", async () => {
    makeUser(p, "broken@example.com", { recap: true });
    makeUser(p, "ok@example.com", { recap: true });
    const client = capturingClient(["broken@example.com"]);

    const outcome = (await sendRecapDigest(p, deps(client)))!;

    expect(outcome.failed).toBe(1);
    expect(outcome.sent).toBe(1);
    expect(client.sent.map((m) => m.to)).toEqual(["ok@example.com"]);
  });

  test("dry run reports the batch and sends nothing, leaving no claim behind", async () => {
    makeUser(p, "in@example.com", { recap: true });
    const client = capturingClient();

    const dry = (await sendRecapDigest(p, deps(client, { dryRun: true })))!;
    expect(dry.dryRun).toBe(true);
    expect(dry.sent).toBe(1);
    expect(client.sent.length).toBe(0);

    // A dry run must not consume the idempotency claim for the real send.
    const real = (await sendRecapDigest(p, deps(client)))!;
    expect(real.sent).toBe(1);
    expect(client.sent.length).toBe(1);
  });

  test("--to narrows the batch to a single address (owner test list)", async () => {
    makeUser(p, "owner@example.com", { recap: true });
    makeUser(p, "someone@example.com", { recap: true });
    const client = capturingClient();

    const outcome = (await sendRecapDigest(p, deps(client, { onlyTo: "owner@example.com" })))!;

    expect(outcome.considered).toBe(1);
    expect(client.sent.map((m) => m.to)).toEqual(["owner@example.com"]);
  });

  test("nothing to report yields null instead of an empty send", async () => {
    const emptyDb = testDb();
    expect(await sendRecapDigest({ db: emptyDb }, deps(capturingClient()))).toBeNull();
  });

  test("each subscriber gets their own unsubscribe token", async () => {
    makeUser(p, "a@example.com", { recap: true });
    makeUser(p, "b@example.com", { recap: true });
    const client = capturingClient();

    await sendRecapDigest(p, deps(client));

    const tokens = client.sent.map((m) => /unsubscribe\/([A-Za-z0-9_-]+)/.exec(m.text)![1]);
    expect(tokens[0]).not.toBe(tokens[1]);
    expect(new Set(tokens).size).toBe(2);
  });
});

describe("preview digest", () => {
  function seedPrediction(): number {
    const raceId = 800;
    seedRace(db, { raceId, season: 2026, raceName: "Future 400", raceDateUtc: "2026-09-13T18:00:00" });
    const { run } = predictionsService.generatePredictions(p, {
      raceId,
      stage: "thursday",
      now: NOW,
      write: true,
    });
    expect(run.predictions.length).toBeGreaterThan(0);
    return raceId;
  }

  test("opting in isn't enough — the preview list is a Pro capability", async () => {
    seedPrediction();
    makeUser(p, "free@example.com", { preview: true });
    makeUser(p, "pro@example.com", { preview: true, pro: true });
    const client = capturingClient();

    const outcome = (await sendPreviewDigest(p, deps(client)))!;

    expect(outcome.considered).toBe(2);
    expect(outcome.skippedNotPro).toBe(1);
    expect(client.sent.map((m) => m.to)).toEqual(["pro@example.com"]);
  });

  test("an expired Pro entitlement stops the preview mail", async () => {
    seedPrediction();
    const userId = makeUser(p, "lapsed@example.com", { preview: true });
    billingService.grantPro(p, userId, "2026-09-01T00:00:00Z", "subscription", NOW); // already past
    const client = capturingClient();

    const outcome = (await sendPreviewDigest(p, deps(client)))!;

    expect(outcome.skippedNotPro).toBe(1);
    expect(client.sent.length).toBe(0);
  });

  test("no stored prediction run means no mail at all", async () => {
    makeUser(p, "pro@example.com", { preview: true, pro: true });
    expect(await sendPreviewDigest(p, deps(capturingClient()))).toBeNull();
  });
});

describe("digest content builders", () => {
  test("recapView refuses a race that has no results yet", () => {
    seedRace(db, { raceId: 900, season: 2026, raceName: "Unrun 500" });
    expect(recapView(p, 900)).toBeNull();
    expect(recapView(p, 12345)).toBeNull();
  });

  test("recapView reports the finishing order and the series label", () => {
    const view = recapView(p, 701)!;
    expect(view.seriesLabel).toBe("Cup Series");
    expect(view.results[0]!.driver).toBe("Alpha Driver");
    expect(view.results[0]!.lapsLed).toBe(88);
  });

  test("previewView refuses a race with no stored run", () => {
    expect(previewView(p, 701)).toBeNull();
  });
});
