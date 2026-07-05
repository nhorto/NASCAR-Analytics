// Shared HTML-building helpers for app-level page templates.

/**
 * Series lives in the URL PATH (not a query param) so each series is its own
 * static file: Cup at the root, Xfinity under /xfinity, Trucks under /trucks.
 */
const SERIES_PREFIX: Record<number, string> = { 1: "", 2: "/xfinity", 3: "/trucks" };

export function seriesPrefix(seriesId: number): string {
  return SERIES_PREFIX[seriesId] ?? "";
}

/** Prefix an absolute app path with the series segment. href always starts "/". */
export function withSeries(href: string, seriesId: number): string {
  return seriesPrefix(seriesId) + href;
}

export function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Format a number with fixed digits; em-dash for missing values. */
export function fmt(n: number | null | undefined, digits = 1): string {
  return n === null || n === undefined ? "—" : n.toFixed(digits);
}

/** Signed format for residual metrics: +4.0 / −1.2. */
export function signed(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return "—";
  const v = n.toFixed(digits);
  return n > 0 ? `+${v}` : v.replace("-", "−");
}

export function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : `${Math.round(n * 100)}%`;
}

/** Start→finish delta arrow cell, colored by direction. */
export function deltaArrow(start: number | null, finish: number): string {
  if (start === null || start <= 0) return `<span class="mut">·</span>`;
  const d = start - finish;
  if (d > 0) return `<span class="pos">▲${d}</span>`;
  if (d < 0) return `<span class="neg">▼${-d}</span>`;
  return `<span class="mut">–</span>`;
}

const TEAM_COLORS: Array<[RegExp, string]> = [
  [/hendrick/i, "#1c5bd4"],
  [/gibbs/i, "#d4541c"],
  [/penske/i, "#b09725"],
  [/trackhouse/i, "#c8102e"],
  [/23xi/i, "#3b3f4a"],
  [/haas/i, "#8a1111"],
  [/rfk|roush/i, "#123f7a"],
  [/richard childress|rcr/i, "#a37b12"],
  [/wood brothers/i, "#7a1230"],
  [/legacy/i, "#4a4f5a"],
  [/kaulig/i, "#0f7a5a"],
  [/spire/i, "#5a3f7a"],
  [/front row/i, "#2d6a8a"],
  [/braun|brawn/i, "#6a5a2d"],
];

export function teamColor(team: string | null): string {
  if (team) {
    for (const [re, color] of TEAM_COLORS) if (re.test(team)) return color;
  }
  return "#39404d";
}

/** Car-number badge, team-colored. */
export function badge(carNumber: string | null, team: string | null, size = 30): string {
  const font = Math.round(size / 2);
  return `<span class="badge" style="background:${teamColor(team)};width:${size}px;height:${size}px;font-size:${font}px">${esc(carNumber ?? "?")}</span>`;
}

/** Inline SVG sparkline; dot + label on the latest point. */
export function sparkline(values: number[], width = 340, height = 72): string {
  if (values.length < 2) return `<p class="note">Not enough races yet for a trend.</p>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => 10 + (i * (width - 20)) / (values.length - 1);
  const py = (v: number) => 6 + (1 - (v - min) / span) * (height - 20);
  const pts = values.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const last = values[values.length - 1]!;
  const first = values[0]!;
  const lx = px(values.length - 1);
  const ly = py(last);
  const anchor = "end";
  const labelY = ly > height / 2 ? ly - 8 : ly + 14;
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" role="img" aria-label="trend">
  <polyline fill="none" stroke="#34d399" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>
  <circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.5" fill="#34d399"/>
  <text x="${lx.toFixed(1)}" y="${labelY.toFixed(1)}" fill="#8b95a6" font-size="10" text-anchor="${anchor}" font-family="sans-serif">${last.toFixed(1)}</text>
  <text x="10" y="${(py(first) > height / 2 ? py(first) - 8 : py(first) + 14).toFixed(1)}" fill="#8b95a6" font-size="10" font-family="sans-serif">${first.toFixed(1)}</text>
</svg>`;
}

/** Card with the standard accent-tick header. */
export function card(title: string, body: string, more?: { href: string; label: string }): string {
  const moreLink = more ? `<a class="more" href="${esc(more.href)}">${esc(more.label)}</a>` : "";
  return `<div class="card"><div class="card-h"><h3>${esc(title)}</h3>${moreLink}</div>${body}</div>`;
}

export function statChips(chips: Array<{ label: string; value: string }>): string {
  return `<div class="chips">${chips
    .map((c) => `<div class="chip"><b class="num">${c.value}</b><span>${esc(c.label)}</span></div>`)
    .join("")}</div>`;
}

/** Label / bar / value row. */
export function barRow(label: string, width: number, value: string, tone?: "good" | "bad" | "acc"): string {
  const w = Math.max(2, Math.min(100, Math.round(width)));
  return `<div class="bar-row"><span class="lbl">${esc(label)}</span><span class="bar"><i class="${tone ?? ""}" style="width:${w}%"></i></span><span class="num val">${value}</span></div>`;
}

export function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export const TRACK_TYPE_LABELS: Record<string, string> = {
  superspeedway: "Superspeedway",
  intermediate: "Intermediate",
  short: "Short Track",
  road: "Road Course",
  dirt: "Dirt",
  unknown: "Unknown",
};
