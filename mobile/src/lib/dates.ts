// Date rendering shared by the screens. Mirrors `fmtDate` in src/app/html.ts:
// date-only strings ("2027-12-31") parse as UTC midnight, so formatting them in
// local time shows the previous day anywhere west of UTC — a Pro expiry of
// Dec 31 read as "Dec 30". Those keep their calendar date; timestamps stay local.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** `pro_until` and friends: the calendar date the server meant, not a local shift. */
export function fmtProUntil(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, DATE_ONLY.test(iso) ? { timeZone: "UTC" } : {});
}
