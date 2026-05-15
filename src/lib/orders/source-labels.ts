/**
 * Unified source-label helpers for order imports.
 *
 * Internal `source` codes (MANUAL, PINGOODMICE, OTHER_IMPORT) are stable
 * and MUST NOT be exposed in UI. Use these functions for all user-facing
 * source display so brand names stay out of pages, menus, and exports.
 */

const INTERNAL_LABELS: Record<string, string> = {
  MANUAL: "手动",
  PINGOODMICE: "平台导入",
  OTHER_IMPORT: "外部导入",
};

const PUBLIC_LABELS: Record<string, string> = {
  MANUAL: "手动",
  PINGOODMICE: "平台导入",
  OTHER_IMPORT: "外部导入",
};

/** Internal label for admin-only / debugging contexts (may still reference the raw code). */
export function getOrderSourceLabel(source: string): string {
  return INTERNAL_LABELS[source] || source;
}

/** Public-facing label: never exposes brand names. */
export function getOrderSourcePublicLabel(source: string): string {
  return PUBLIC_LABELS[source] || "外部导入";
}

/**
 * Best-effort display label for an order's source:
 * prefers sourceRemark when available, otherwise falls back to the public label.
 */
export function getOrderSourceDisplay(
  source: string,
  sourceRemark?: string | null,
): string {
  if (sourceRemark?.trim()) return sourceRemark.trim();
  return getOrderSourcePublicLabel(source);
}
