// Owner: @BE | Scope: Shared formatting utilities

// ─── Table output helpers ─────────────────────────────────────────────────────

/** Pad string to exactly n chars (truncates if longer) */
export function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

/** Truncate string to n chars with trailing ellipsis */
export function trunc(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

/** Format a number as Indian-locale currency (default prefix ₹) */
export function fmtCurrency(n: number, prefix = '₹'): string {
  return `${prefix}${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

// ─── Date range helpers ───────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] as const;

/**
 * Format a date-range object for display.
 * { startDate: "2026-03-01", endDate: "2026-03-07" } → "01 Mar – 07 Mar 2026"
 */
export function fmtRange(p: { startDate: string; endDate: string }): string {
  const parts      = p.endDate.split('-');
  const ey         = parts[0] ?? '';
  const em         = Number(parts[1] ?? '1') - 1;
  const ed         = parts[2] ?? '';
  const startParts = p.startDate.split('-');
  const sd         = startParts[2] ?? '';
  const sm         = Number(startParts[1] ?? '1') - 1;
  return `${sd} ${MONTHS[sm] ?? ''} – ${ed} ${MONTHS[em] ?? ''} ${ey}`;
}

/**
 * Format a nullable number for comparison tables.
 * Null → "N/A"; integers → no decimals; floats → 2 decimal places.
 */
export function fmtValue(v: number | null): string {
  if (v === null) return 'N/A';
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
