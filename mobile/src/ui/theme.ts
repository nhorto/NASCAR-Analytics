// Color tokens — mirrors the web app's design tokens in src/app/style.css
// (source of truth: docs/design-docs/2026-07-05-phase3-ui-mockup.html). The
// two surfaces should read as one product.
export const colors = {
  bg: "#0a0c10",
  surface: "#12151c",
  surface2: "#191d26",
  border: "#262c38",
  text: "#e9edf4",
  muted: "#8b95a6",
  accent: "#ffd23f",
  pos: "#34d399",
  neg: "#f87171",
} as const;

export const flagColors: Record<string, string> = {
  green: colors.pos,
  yellow: colors.accent,
  red: colors.neg,
  white: colors.text,
  checkered: colors.text,
};
