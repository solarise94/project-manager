/**
 * Resolve the display name for a customer's organization.
 * Prefers the canonical name from the org relation (source of truth)
 * over the denormalized text snapshot on the customer record.
 */
export function getCustomerOrganizationName(customer: {
  organization?: string | null;
  org?: { canonicalName: string } | null;
}): string | null {
  return customer.org?.canonicalName?.trim() || customer.organization?.trim() || null;
}
