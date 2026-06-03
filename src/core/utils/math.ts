// Owner: @BE | Scope: Shared math utilities

/**
 * Calculates the percentage difference between two values.
 * Formula: ((a - b) / b) * 100
 * Returns null if b is null or 0 (division not possible).
 */
export function calcDiffPercent(a: number, b: number | null): number | null {
  if (b === null || b === 0) return null;
  return ((a - b) / b) * 100;
}
