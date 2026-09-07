// Email copy (WS-G). Templates are pure, so the exact strings a subscriber
// receives — including every unsubscribe affordance — are pinned here.
import { describe, expect, test } from "bun:test";
import {
  previewEmail,
  recapEmail,
  resetEmail,
  unsubscribeUrl,
  verifyEmail,
  type PreviewEmailView,
  type RecapEmailView,
} from "../src/app/emails.ts";

const LINKS = { baseUrl: "https://looplab.test", unsubToken: "tok-123" };

const RECAP: RecapEmailView = {
  raceId: 5555,
  raceName: "Coca-Cola 600",
  season: 2026,
  seriesLabel: "Cup Series",
  results: [
    { finish: 1, driver: "Alpha Driver", start: 7, lapsLed: 120 },
    { finish: 2, driver: "Beta Driver", start: 1, lapsLed: 40 },
    { finish: 3, driver: "Gamma Driver", start: 3, lapsLed: 0 },
    { finish: 4, driver: "Delta Driver", start: 4, lapsLed: 0 },
    { finish: 5, driver: "Epsilon Driver", start: 12, lapsLed: 0 },
    { finish: 6, driver: "Zeta Driver", start: 6, lapsLed: 0 },
  ],
  standouts: [{ driver: "Alpha Driver", adjPassEfficiency: 4.2, closerScore: 1.35 }],
  over: [{ driver: "Epsilon Driver", finish: 5, delta: 9.4 }],
  under: [{ driver: "Beta Driver", finish: 2, delta: -1.2 }],
};

const PREVIEW: PreviewEmailView = {
  raceId: 6000,
  raceName: "Southern 500",
  season: 2026,
  trackType: "intermediate",
  stage: "thursday",
  generatedAt: "2026-09-03T16:00:00.000Z",
  rows: [
    { driver: "Alpha Driver", pWin: 0.154, pTop5: 0.42, expFinish: 9.6 },
    { driver: "Beta Driver", pWin: 0.121, pTop5: 0.38, expFinish: 11.2 },
  ],
  dfs: [{ driver: "Alpha Driver", projectedPoints: 48.25 }],
};

describe("transactional email copy", () => {
  test("verify mail links the token and states the single-use window", () => {
    const mail = verifyEmail("https://looplab.test", "abc");
    expect(mail.subject).toBe("Verify your Looplab email");
    expect(mail.text).toContain("https://looplab.test/verify/abc");
    expect(mail.text).toContain("works once and expires in 48 hours");
  });

  test("reset mail reassures the non-requester their password is unchanged", () => {
    const mail = resetEmail("https://looplab.test", "xyz");
    expect(mail.text).toContain("https://looplab.test/reset/xyz");
    expect(mail.text).toContain("expires in 30 minutes");
    expect(mail.text).toContain("your password is unchanged");
  });

  test("transactional mail carries no unsubscribe link — it isn't a list", () => {
    // Unsubscribing from verification mail would lock a user out of their
    // own account, so these two deliberately have no List-Unsubscribe.
    expect(verifyEmail("https://x", "a").headers).toBeUndefined();
    expect(resetEmail("https://x", "a").headers).toBeUndefined();
  });
});

describe("recap digest", () => {
  const mail = recapEmail(RECAP, LINKS);

  test("subject names the race and the winner", () => {
    expect(mail.subject).toBe("Coca-Cola 600: Alpha Driver wins — the numbers behind it");
  });

  test("body lists exactly the top five with start-to-finish movement", () => {
    expect(mail.text).toContain("1. Alpha Driver (+6 from P7) — 120 laps led");
    expect(mail.text).toContain("2. Beta Driver (-1 from P1) — 40 laps led");
    expect(mail.text).toContain("5. Epsilon Driver (+7 from P12)");
    expect(mail.text).not.toContain("Zeta Driver");
  });

  test("a single led lap reads as one lap, not '1 laps'", () => {
    const one = recapEmail(
      { ...RECAP, results: [{ finish: 1, driver: "Alpha Driver", start: 1, lapsLed: 1 }] },
      LINKS,
    );
    expect(one.text).toContain("— 1 lap led");
    expect(one.text).not.toContain("1 laps led");
  });

  test("loop-data standouts and form callouts make the body", () => {
    expect(mail.text).toContain("adj pass efficiency 4.2, closer 1.4");
    expect(mail.text).toContain("Epsilon Driver finished 5, 9.4 better than his recent form");
    expect(mail.text).toContain("Beta Driver finished 2, 1.2 worse than his recent form");
  });

  test("links point at the race's own recap and the unsubscribe is one tap", () => {
    expect(mail.text).toContain("https://looplab.test/recap/5555");
    expect(mail.text).toContain("Unsubscribe: https://looplab.test/unsubscribe/tok-123?list=recap");
    expect(mail.headers?.["List-Unsubscribe"]).toBe(
      "<https://looplab.test/unsubscribe/tok-123?list=recap>",
    );
  });

  test("a race with no results still renders (no winner claim)", () => {
    const empty = recapEmail({ ...RECAP, results: [], standouts: [], over: [], under: [] }, LINKS);
    expect(empty.subject).toBe("Coca-Cola 600: recap — the numbers behind it");
    expect(empty.text).not.toContain("Winner:");
  });
});

describe("preview digest", () => {
  test("Thursday runs disclose that the win odds firm up after qualifying", () => {
    const mail = previewEmail(PREVIEW, LINKS);
    expect(mail.subject).toBe("Southern 500: what the model expects");
    expect(mail.text).toContain("Thursday form-based run");
    expect(mail.text).toContain("Alpha Driver — win 15.4%, top 5 42.0%, expected finish 9.6");
    expect(mail.text).toContain("Alpha Driver — 48.3 projected points");
    expect(mail.text).toContain("https://looplab.test/predictions/methodology");
  });

  test("Saturday runs say they are the last word before the green flag", () => {
    const mail = previewEmail({ ...PREVIEW, stage: "saturday" }, LINKS);
    expect(mail.text).toContain("includes the qualifying grid");
    expect(mail.text).toContain("last word before the green flag");
  });

  test("no stored DFS projections drops the DFS section entirely", () => {
    const mail = previewEmail({ ...PREVIEW, dfs: [] }, LINKS);
    expect(mail.text).not.toContain("DFS value board");
    expect(mail.text).not.toContain("/dfs");
  });

  test("the preview list unsubscribes independently of the recap list", () => {
    const mail = previewEmail(PREVIEW, LINKS);
    expect(mail.text).toContain("/unsubscribe/tok-123?list=preview");
    expect(unsubscribeUrl("https://looplab.test", "tok-123", "recap")).toBe(
      "https://looplab.test/unsubscribe/tok-123?list=recap",
    );
  });
});
