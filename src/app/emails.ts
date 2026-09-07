// Every piece of mail the product sends, as pure builders (WS-G). Nothing here
// touches the network or the db: a template takes a view and returns the
// message, so the copy is unit-testable and the send path stays thin.
//
// v1 bodies are plain text on purpose — they render identically in every
// client, survive text-only readers, and carry no tracking pixel.
import type { EmailKind } from "../domains/accounts/index.ts";
import type { EmailMessage } from "../providers/email.ts";

export type BuiltEmail = Pick<EmailMessage, "subject" | "text" | "headers">;

const LIST_LABELS: Record<EmailKind, string> = {
  recap: "the Monday race recap",
  preview: "the Thursday race preview",
};

export function unsubscribeUrl(baseUrl: string, unsubToken: string, kind: EmailKind): string {
  return `${baseUrl}/unsubscribe/${unsubToken}?list=${kind}`;
}

/** Shared footer + the one-click header mail clients surface as "Unsubscribe". */
function digestFooter(baseUrl: string, unsubToken: string, kind: EmailKind): BuiltEmail["headers"] & object {
  return { "List-Unsubscribe": `<${unsubscribeUrl(baseUrl, unsubToken, kind)}>` };
}

function footerText(baseUrl: string, unsubToken: string, kind: EmailKind): string {
  return `\n\n—\nYou're getting this because you turned on ${LIST_LABELS[kind]} in your Looplab account.\nUnsubscribe: ${unsubscribeUrl(baseUrl, unsubToken, kind)}\nAccount settings: ${baseUrl}/account`;
}

// --- transactional (WS-D copy, moved here so all mail lives together) ---

export function verifyEmail(baseUrl: string, token: string): BuiltEmail {
  return {
    subject: "Verify your Looplab email",
    text: `Confirm your email address to finish setting up your Looplab account:\n\n${baseUrl}/verify/${token}\n\nThe link works once and expires in 48 hours. If you didn't create this account, ignore this email.`,
  };
}

export function resetEmail(baseUrl: string, token: string): BuiltEmail {
  return {
    subject: "Reset your Looplab password",
    text: `Someone (hopefully you) asked to reset your Looplab password:\n\n${baseUrl}/reset/${token}\n\nThe link works once and expires in 30 minutes. If this wasn't you, ignore this email — your password is unchanged.`,
  };
}

// --- digests ---

export interface RecapEmailView {
  raceId: number;
  raceName: string;
  season: number;
  seriesLabel: string;
  /** Finishing order, best first; the template takes the top five. */
  results: Array<{ finish: number; driver: string; start: number | null; lapsLed: number }>;
  /** Per-race proprietary-metric standouts (adjPE / Closer). */
  standouts: Array<{ driver: string; adjPassEfficiency: number | null; closerScore: number | null }>;
  /** Drivers who beat / missed their trailing form by the widest margin. */
  over: Array<{ driver: string; finish: number; delta: number }>;
  under: Array<{ driver: string; finish: number; delta: number }>;
}

function fmt1(n: number | null): string {
  return n === null ? "—" : n.toFixed(1);
}

function movement(start: number | null, finish: number): string {
  if (start === null || start <= 0) return "";
  const d = start - finish;
  if (d === 0) return " (even from P" + start + ")";
  return d > 0 ? ` (+${d} from P${start})` : ` (${d} from P${start})`;
}

export function recapEmail(view: RecapEmailView, links: { baseUrl: string; unsubToken: string }): BuiltEmail {
  const top = view.results.slice(0, 5);
  const winner = top[0];
  const podium = top
    .map((r) => `  ${r.finish}. ${r.driver}${movement(r.start, r.finish)}${r.lapsLed > 0 ? ` — ${r.lapsLed} lap${r.lapsLed === 1 ? "" : "s"} led` : ""}`)
    .join("\n");
  const standoutLines = view.standouts
    .slice(0, 3)
    .map(
      (s) =>
        `  ${s.driver} — adj pass efficiency ${fmt1(s.adjPassEfficiency)}, closer ${fmt1(s.closerScore)}`,
    )
    .join("\n");
  const overLines = view.over
    .slice(0, 2)
    .map((c) => `  ${c.driver} finished ${c.finish}, ${c.delta.toFixed(1)} better than his recent form`)
    .join("\n");
  const underLines = view.under
    .slice(0, 2)
    .map((c) => `  ${c.driver} finished ${c.finish}, ${Math.abs(c.delta).toFixed(1)} worse than his recent form`)
    .join("\n");

  const body = [
    `${view.raceName} — ${view.seriesLabel}, ${view.season}`,
    winner ? `\nWinner: ${winner.driver}` : "",
    `\nTop five:\n${podium}`,
    standoutLines ? `\nBeyond the box score (loop-data standouts):\n${standoutLines}` : "",
    overLines ? `\nBeat their form:\n${overLines}` : "",
    underLines ? `\nMissed their form:\n${underLines}` : "",
    `\nFull recap — standings movement, playoff picture, every metric:\n${links.baseUrl}/recap/${view.raceId}`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `${view.raceName}: ${winner ? `${winner.driver} wins` : "recap"} — the numbers behind it`,
    text: body + footerText(links.baseUrl, links.unsubToken, "recap"),
    headers: digestFooter(links.baseUrl, links.unsubToken, "recap"),
  };
}

export interface PreviewEmailView {
  raceId: number;
  raceName: string;
  season: number;
  trackType: string;
  stage: string;
  generatedAt: string;
  rows: Array<{ driver: string; pWin: number; pTop5: number; expFinish: number }>;
  /** Top DFS values for the platform we lead with; empty when none stored. */
  dfs: Array<{ driver: string; projectedPoints: number }>;
}

function pctString(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

export function previewEmail(
  view: PreviewEmailView,
  links: { baseUrl: string; unsubToken: string },
): BuiltEmail {
  const contenders = view.rows
    .slice(0, 5)
    .map(
      (r) =>
        `  ${r.driver} — win ${pctString(r.pWin)}, top 5 ${pctString(r.pTop5)}, expected finish ${r.expFinish.toFixed(1)}`,
    )
    .join("\n");
  const dfsLines = view.dfs
    .slice(0, 3)
    .map((d) => `  ${d.driver} — ${d.projectedPoints.toFixed(1)} projected points`)
    .join("\n");
  const stageNote =
    view.stage === "saturday"
      ? "This run includes the qualifying grid — it's the model's last word before the green flag."
      : "This is the Thursday form-based run; Saturday's run adds the qualifying grid and sharpens the win odds.";

  const body = [
    `${view.raceName} — ${view.season} (${view.trackType})`,
    `\n${stageNote}`,
    `\nModel's top five:\n${contenders}`,
    dfsLines ? `\nDFS value board (DraftKings scoring):\n${dfsLines}` : "",
    `\nFull board, all drivers, predicted-vs-actual after the race:\n${links.baseUrl}/predictions`,
    dfsLines ? `DFS projections and printable cheat sheet:\n${links.baseUrl}/dfs` : "",
    `\nHow the model works (and where it's weak): ${links.baseUrl}/predictions/methodology`,
  ]
    .filter(Boolean)
    .join("\n");

  return {
    subject: `${view.raceName}: what the model expects`,
    text: body + footerText(links.baseUrl, links.unsubToken, "preview"),
    headers: digestFooter(links.baseUrl, links.unsubToken, "preview"),
  };
}
