import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type DbLike = typeof prisma | Prisma.TransactionClient;

const SALES_USER_ROLES = new Set(["REPRESENTATIVE", "REGIONAL_MANAGER"]);

export type EffectiveRepresentativeSource =
  | "EXPLICIT_ASSIGNMENT"
  | "SITE_BINDING"
  | "ORG_BINDING"
  | "NONE";

export type EffectiveCustomerRepresentative = {
  customerId: string;
  representativeId: string | null;
  representativeName: string | null;
  ownerUserId: string | null;
  source: EffectiveRepresentativeSource;
  anchorAt: Date | null;
};

/**
 * Resolve the effective representative for a batch of customers.
 *
 * Resolution priority:
 * 1. EXPLICIT_ASSIGNMENT: profile.assignmentStatus === "ASSIGNED" and ownerUser
 *    maps to a non-archived Representative with matching email and sales role.
 * 2. SITE_BINDING: customer has organizationSiteId and an ACTIVE
 *    RepresentativeOrganization exists for that site.
 * 3. ORG_BINDING: customer has organizationId (no site binding hit) and an ACTIVE
 *    RepresentativeOrganization exists at org-level (organizationSiteId = null).
 * 4. NONE: no match.
 *
 * This function performs a fixed number of queries regardless of batch size.
 */
export async function resolveEffectiveCustomerRepresentatives(
  customerIds: string[],
  db: DbLike = prisma,
): Promise<Map<string, EffectiveCustomerRepresentative>> {
  type BindingInfo = {
    representativeId: string;
    reviewedAt: Date | null;
    createdAt: Date;
  };

  const uniqueIds = [...new Set(customerIds.filter(Boolean))];
  const result = new Map<string, EffectiveCustomerRepresentative>();

  if (uniqueIds.length === 0) return result;

  // Pre-populate result with NONE for all customers
  for (const customerId of uniqueIds) {
    result.set(customerId, {
      customerId,
      representativeId: null,
      representativeName: null,
      ownerUserId: null,
      source: "NONE",
      anchorAt: null,
    });
  }

  // 1. Fetch all non-archived CRM profiles for these customers
  const profiles = await db.crmCustomerProfile.findMany({
    where: {
      sourceCustomerId: { in: uniqueIds },
      archived: false,
    },
    select: {
      sourceCustomerId: true,
      ownerUserId: true,
      assignmentStatus: true,
      assignedAt: true,
      createdAt: true,
    },
  });

  const profileMap = new Map(profiles.map((p) => [p.sourceCustomerId, p]));

  // Separate explicitly assigned customers from unassigned
  const explicitAssignedCustomerIds: string[] = [];
  const unassignedCustomerIds: string[] = [];

  for (const customerId of uniqueIds) {
    const profile = profileMap.get(customerId);
    if (profile && profile.assignmentStatus === "ASSIGNED" && profile.ownerUserId) {
      explicitAssignedCustomerIds.push(customerId);
    } else {
      unassignedCustomerIds.push(customerId);
    }
  }

  // ── Priority 1: Explicit assignment ──────────────────────────────
  if (explicitAssignedCustomerIds.length > 0) {
    const ownerUserIds = [...new Set(
      explicitAssignedCustomerIds
        .map((id) => profileMap.get(id)!.ownerUserId)
        .filter(Boolean),
    )];

    const ownerUsers = await db.user.findMany({
      where: { id: { in: ownerUserIds } },
      select: { id: true, email: true, role: true },
    });

    const ownerUserMap = new Map(ownerUsers.map((u) => [u.id, u]));

    // Find matching representatives for owner users
    const ownerEmails = ownerUsers
      .filter((u) => SALES_USER_ROLES.has(u.role) && u.email)
      .map((u) => u.email!);

    const reps = ownerEmails.length > 0
      ? await db.representative.findMany({
          where: { email: { in: ownerEmails }, archived: false },
          select: { id: true, name: true, email: true },
        })
      : [];

    const repByEmail = new Map(reps.map((r) => [r.email, r]));

    for (const customerId of explicitAssignedCustomerIds) {
      const profile = profileMap.get(customerId)!;
      const ownerUser = ownerUserMap.get(profile.ownerUserId);
      if (!ownerUser || !ownerUser.email || !SALES_USER_ROLES.has(ownerUser.role)) continue;

      const rep = repByEmail.get(ownerUser.email);
      if (!rep) continue;

      result.set(customerId, {
        customerId,
        representativeId: rep.id,
        representativeName: rep.name,
        ownerUserId: ownerUser.id,
        source: "EXPLICIT_ASSIGNMENT",
        anchorAt: profile.assignedAt ?? profile.createdAt,
      });
    }
  }

  // ── Priority 2/3: Binding fallback ───────────────────────────────
  if (unassignedCustomerIds.length === 0) return result;

  // Fetch customers to get organizationId / organizationSiteId
  const customers = await db.customer.findMany({
    where: { id: { in: unassignedCustomerIds }, deleted: false },
    select: { id: true, organizationId: true, organizationSiteId: true },
  });

  const customerMap = new Map(customers.map((c) => [c.id, c]));

  // Site-level bindings
  const siteIds = [...new Set(
    customers
      .map((c) => c.organizationSiteId)
      .filter((id): id is string => !!id),
  )];

  const siteBindings = siteIds.length > 0
    ? await db.representativeOrganization.findMany({
        where: {
          organizationSiteId: { in: siteIds },
          status: "ACTIVE",
        },
        select: {
          organizationSiteId: true,
          representativeId: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Build siteId -> first binding map
  const siteBindingMap = new Map<string, BindingInfo>();
  for (const binding of siteBindings) {
    if (!siteBindingMap.has(binding.organizationSiteId!)) {
      siteBindingMap.set(binding.organizationSiteId!, binding);
    }
  }

  // Org-level bindings (for customers without site binding)
  const customersNeedingOrgBinding = customers.filter((c) => {
    if (!c.organizationId) return false;
    if (c.organizationSiteId && siteBindingMap.has(c.organizationSiteId)) return false;
    return true;
  });

  const orgIds = [...new Set(
    customersNeedingOrgBinding
      .map((c) => c.organizationId)
      .filter((id): id is string => !!id),
  )];

  const orgBindings = orgIds.length > 0
    ? await db.representativeOrganization.findMany({
        where: {
          organizationId: { in: orgIds },
          organizationSiteId: null,
          status: "ACTIVE",
        },
        select: {
          organizationId: true,
          representativeId: true,
          reviewedAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Build orgId -> first binding map
  const orgBindingMap = new Map<string, BindingInfo>();
  for (const binding of orgBindings) {
    if (!orgBindingMap.has(binding.organizationId!)) {
      orgBindingMap.set(binding.organizationId!, binding);
    }
  }

  // Collect all representative IDs from bindings
  const bindingRepIds = new Set<string>();
  for (const binding of siteBindings) bindingRepIds.add(binding.representativeId);
  for (const binding of orgBindings) bindingRepIds.add(binding.representativeId);

  // Fetch representatives and their linked users
  const bindingReps = bindingRepIds.size > 0
    ? await db.representative.findMany({
        where: { id: { in: [...bindingRepIds] }, archived: false },
        select: { id: true, name: true, email: true },
      })
    : [];

  const bindingRepEmails = bindingReps
    .map((r) => r.email)
    .filter((e): e is string => !!e);

  const bindingRepUsers = bindingRepEmails.length > 0
    ? await db.user.findMany({
        where: {
          email: { in: bindingRepEmails },
          role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] },
        },
        select: { id: true, email: true },
      })
    : [];

  const userIdByRepEmail = new Map(bindingRepUsers.map((u) => [u.email, u.id]));
  const repById = new Map(bindingReps.map((r) => [r.id, r]));

  for (const customerId of unassignedCustomerIds) {
    const customer = customerMap.get(customerId);
    if (!customer) continue;

    const profile = profileMap.get(customerId);
    let binding: BindingInfo | undefined;
    let source: EffectiveRepresentativeSource = "NONE";

    // Try site binding first
    if (customer.organizationSiteId) {
      binding = siteBindingMap.get(customer.organizationSiteId);
      if (binding) source = "SITE_BINDING";
    }

    // Fall back to org binding
    if (!binding && customer.organizationId) {
      binding = orgBindingMap.get(customer.organizationId);
      if (binding) source = "ORG_BINDING";
    }

    if (!binding) continue;

    const rep = repById.get(binding.representativeId);
    if (!rep || !rep.email) continue;

    const ownerUserId = userIdByRepEmail.get(rep.email);
    if (!ownerUserId) continue;

    const bindingAnchor = binding.reviewedAt ?? binding.createdAt;
    const profileCreatedAt = profile?.createdAt ?? new Date(0);
    const anchorAt = bindingAnchor > profileCreatedAt ? bindingAnchor : profileCreatedAt;

    result.set(customerId, {
      customerId,
      representativeId: rep.id,
      representativeName: rep.name,
      ownerUserId,
      source,
      anchorAt,
    });
  }

  return result;
}

/**
 * Resolve the effective representative for a single customer.
 */
export async function resolveEffectiveCustomerRepresentative(
  customerId: string,
  db: DbLike = prisma,
): Promise<EffectiveCustomerRepresentative> {
  const map = await resolveEffectiveCustomerRepresentatives([customerId], db);
  return map.get(customerId) ?? {
    customerId,
    representativeId: null,
    representativeName: null,
    ownerUserId: null,
    source: "NONE",
    anchorAt: null,
  };
}
