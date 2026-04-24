/**
 * Normalize organization names for consistent matching.
 * Handles: full/half-width, whitespace, common punctuation, parentheses.
 */
export function normalizeOrgName(input: string): string {
  let s = input.trim();

  // Full-width → half-width ASCII (letters, digits, common punctuation)
  s = s.replace(/[\uff01-\uff5e]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );

  // Full-width space → half-width
  s = s.replace(/\u3000/g, " ");

  // Chinese parentheses → ASCII
  s = s.replace(/（/g, "(").replace(/）/g, ")");

  // Collapse whitespace
  s = s.replace(/\s+/g, " ");

  // Remove leading/trailing whitespace
  s = s.trim();

  return s;
}
