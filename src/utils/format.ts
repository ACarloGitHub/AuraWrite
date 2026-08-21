/**
 * Pure formatting utilities shared across the app.
 * Extracted from main.ts / model-catalog.ts / ai-wizard.ts (2026-08-21,
 * refactoring plan step 1.1) to remove duplication.
 */

/** Format a byte count as a human-readable string (B / KB / MB / GB). */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Convert a #RRGGBB hex color to an rgba() string with the given alpha.
 * Falls back to yellow on invalid input (same behavior as the original
 * highlight-color logic in main.ts).
 */
export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  if (isNaN(r) || isNaN(g) || isNaN(b)) return `rgba(255, 255, 0, ${alpha})`;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
