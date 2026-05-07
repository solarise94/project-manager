/**
 * Client-safe role guard predicates.
 * These are pure functions with no server-only dependencies.
 * Always use explicit allow-lists so undefined role defaults to false.
 */

export function isAdmin(role?: string | null): boolean {
  return role === "ADMIN";
}

export function isInternalStaff(role?: string | null): boolean {
  return role === "ADMIN" || role === "USER";
}

export function isSalesRole(role?: string | null): boolean {
  return role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER";
}

export function canAccessOrders(role?: string | null): boolean {
  return role === "ADMIN" || role === "USER" || role === "REPRESENTATIVE" || role === "REGIONAL_MANAGER";
}

export function canAccessFinance(role?: string | null): boolean {
  return role === "ADMIN" || role === "USER" || role === "REGIONAL_MANAGER";
}
