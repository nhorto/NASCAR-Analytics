// feed_status persistence, failure streaks, outage detection, threshold-crossing
// alerts, and the app-level record-and-alert flow (canary v1, WS-C).
import { describe, expect, test } from "bun:test";
import { dataHealthService } from "../src/domains/data-health/index.ts";
import type { CanaryReport, CheckResult, FeedStatusRow } from "../src/domains/data-health/index.ts";
import { recordAndAlert } from "../src/app/canary.ts";
import type { EmailClient, EmailMessage } from "../src/providers/email.ts";
import { createNullEmailClient } from "../src/providers/email.ts";
import { testDb } from "./seed.ts";
import type { Providers } from "../src/providers/index.ts";

function result(id: string, ok: boolean, problem: string | null = ok ? null : "HTTP 403"): CheckResult {
  return { id, label: id, url: `https://cdn/${id}`, status: ok ? 200 : 403, ok, problem, ms: 5 };
}

function report(at: string, results: CheckResult[]): CanaryReport {
  const failures = results.filter((r) => !r.ok).length;
  return { at, results, failures, healthy: failures === 0 };
}

function db(): Pick<Providers, "db"> {
  return { db: testDb() };
}

describe("consecutiveFailures (pure)", () => {
  const row = (ok: boolean, runAt: string): FeedStatusRow => ({
    checkId: "c",
    runAt,
    ok,
    httpStatus: ok ? 200 : 403,
    problem: ok ? null : "HTTP 403",
    ms: 1,
  });
  test("counts the failing streak at the head only", () => {
    expect(dataHealthService.consecutiveFailures([])).toBe(0);
    expect(dataHealthService.consecutiveFailures([row(true, "d3")])).toBe(0);
    expect(dataHealthService.consecutiveFailures([row(false, "d3")])).toBe(1);
    expect(
      dataHealthService.consecutiveFailures([row(false, "d3"), row(false, "d2"), row(true, "d1")]),
    ).toBe(2);
    // An old failure behind a success does not count.
    expect(
      dataHealthService.consecutiveFailures([row(true, "d3"), row(false, "d2"), row(false, "d1")]),
    ).toBe(0);
  });
});

describe("outage detection over recorded runs", () => {
  test("one failure is not an outage; two consecutive are", () => {
    const p = db();
    dataHealthService.recordReport(p, report("2026-09-01T09:00:00Z", [result("loopstats", false)]));
    expect(dataHealthService.activeOutages(p)).toEqual([]);
    dataHealthService.recordReport(p, report("2026-09-02T09:00:00Z", [result("loopstats", false)]));
    expect(dataHealthService.activeOutages(p)).toEqual([
      {
        checkId: "loopstats",
        consecutiveFailures: 2,
        since: "2026-09-01T09:00:00Z",
        problem: "HTTP 403",
      },
    ]);
  });

  test("a recovery clears the outage", () => {
    const p = db();
    dataHealthService.recordReport(p, report("d1", [result("schedule", false)]));
    dataHealthService.recordReport(p, report("d2", [result("schedule", false)]));
    dataHealthService.recordReport(p, report("d3", [result("schedule", true)]));
    expect(dataHealthService.activeOutages(p)).toEqual([]);
  });

  test("newlyAlertableOutages fires exactly at the threshold crossing", () => {
    const p = db();
    dataHealthService.recordReport(p, report("d1", [result("laptimes", false)]));
    expect(dataHealthService.newlyAlertableOutages(p)).toEqual([]);
    dataHealthService.recordReport(p, report("d2", [result("laptimes", false)]));
    expect(dataHealthService.newlyAlertableOutages(p).map((o) => o.checkId)).toEqual(["laptimes"]);
    // Day three: still an outage, but not newly alertable — no second email.
    dataHealthService.recordReport(p, report("d3", [result("laptimes", false)]));
    expect(dataHealthService.activeOutages(p).length).toBe(1);
    expect(dataHealthService.newlyAlertableOutages(p)).toEqual([]);
  });

  test("checks fail independently", () => {
    const p = db();
    dataHealthService.recordReport(p, report("d1", [result("a", false), result("b", true)]));
    dataHealthService.recordReport(p, report("d2", [result("a", false), result("b", false)]));
    expect(dataHealthService.activeOutages(p).map((o) => o.checkId)).toEqual(["a"]);
  });
});

describe("formatAlertEmail", () => {
  test("names the failing checks, the streak, and the runbook", () => {
    const rep = report("d2", [result("loopstats", false)]);
    const msg = dataHealthService.formatAlertEmail(
      [{ checkId: "loopstats", consecutiveFailures: 2, since: "d1", problem: "HTTP 403" }],
      rep,
    );
    expect(msg.subject).toBe("[looplab canary] upstream feed outage: loopstats");
    expect(msg.text).toContain("loopstats: 2 consecutive failures since d1");
    expect(msg.text).toContain("HTTP 403");
    expect(msg.text).toContain("docs/runbooks/feed-loss.md");
  });
});

describe("recordAndAlert (app flow)", () => {
  function capturingEmail(): { client: EmailClient; sent: EmailMessage[] } {
    const sent: EmailMessage[] = [];
    return {
      sent,
      client: {
        configured: true,
        async send(msg) {
          sent.push(msg);
          return { ok: true, detail: "captured" };
        },
      },
    };
  }

  test("an injected 403 alerts on the second consecutive day, exactly once", async () => {
    const p = db();
    const email = capturingEmail();
    const to = { client: email.client, to: "owner@example.com" };

    const day1 = await recordAndAlert(p, report("d1", [result("weekend", false)]), to);
    expect(day1.alerted).toEqual([]);
    expect(email.sent.length).toBe(0);

    const day2 = await recordAndAlert(p, report("d2", [result("weekend", false)]), to);
    expect(day2.alerted.map((o) => o.checkId)).toEqual(["weekend"]);
    expect(email.sent.length).toBe(1);
    expect(email.sent[0]!.to).toBe("owner@example.com");
    expect(email.sent[0]!.subject).toContain("weekend");

    const day3 = await recordAndAlert(p, report("d3", [result("weekend", false)]), to);
    expect(day3.alerted).toEqual([]);
    expect(day3.outages.length).toBe(1); // still down, already alerted
    expect(email.sent.length).toBe(1);
  });

  test("recovery then a new streak alerts again", async () => {
    const p = db();
    const email = capturingEmail();
    const to = { client: email.client, to: "owner@example.com" };
    await recordAndAlert(p, report("d1", [result("live-feed", false)]), to);
    await recordAndAlert(p, report("d2", [result("live-feed", false)]), to);
    await recordAndAlert(p, report("d3", [result("live-feed", true)]), to);
    await recordAndAlert(p, report("d4", [result("live-feed", false)]), to);
    const second = await recordAndAlert(p, report("d5", [result("live-feed", false)]), to);
    expect(second.alerted.length).toBe(1);
    expect(email.sent.length).toBe(2);
  });

  test("without email config the alert degrades to a log line, not a crash", async () => {
    const p = db();
    const logged: string[] = [];
    const to = { client: createNullEmailClient((m) => logged.push(m)), to: null };
    await recordAndAlert(p, report("d1", [result("schedule", false)]), to);
    const day2 = await recordAndAlert(p, report("d2", [result("schedule", false)]), to);
    expect(day2.alerted.length).toBe(1);
    expect(day2.emailDetail).toContain("not configured");
    expect(logged.length).toBe(1);
  });
});
