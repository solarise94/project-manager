import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generateCustomerCode } from "@/lib/customer-code";
import { resolveOrganization } from "@/lib/organization-resolver";
import { ensureOrganizationFromInput } from "@/lib/organizations/ensure-organization";
import { matchImportRow } from "@/lib/orders/source-order-match";
import { normalizeOrgName } from "@/lib/organization-normalize";
import type { MatchInput, MatchCandidate } from "@/lib/orders/source-order-match";

export type CustomerMode = "MATCH_ONLY" | "CREATE_IF_MISSING" | "SKIP";
export type OrganizationMode = "RESOLVE_ONLY" | "CREATE_IF_MISSING" | "SKIP";

type DbLike = Prisma.TransactionClient | typeof prisma;

export interface OrgResolveResult {
  organizationId: string | null;
  canonicalName: string | null;
  created: boolean;
}

async function createOrgInTx(
  db: DbLike,
  orgName: string,
): Promise<{ organizationId: string; canonicalName: string }> {
  const count = await db.organization.count();
  let orgCode = "";
  for (let i = 0; i < 10; i++) {
    const code = `ORG-${String(count + 1 + i).padStart(5, "0")}`;
    const exists = await db.organization.findUnique({ where: { orgCode: code }, select: { id: true } });
    if (!exists) { orgCode = code; break; }
  }
  if (!orgCode) orgCode = `ORG-${String(Date.now() % 100000).padStart(5, "0")}`;

  const normalized = normalizeOrgName(orgName.trim());
  const org = await db.organization.create({
    data: {
      orgCode,
      canonicalName: orgName.trim(),
      normalizedName: normalized,
    },
  });
  return { organizationId: org.id, canonicalName: org.canonicalName };
}

export async function resolveOrCreateOrganizationForImport(
  orgName: string | null | undefined,
  mode: OrganizationMode,
  db: DbLike = prisma,
): Promise<OrgResolveResult> {
  if (!orgName?.trim() || mode === "SKIP") {
    return { organizationId: null, canonicalName: null, created: false };
  }

  const resolved = await resolveOrganization(orgName.trim());
  if (resolved.status === "exact" && resolved.organizationId) {
    return { organizationId: resolved.organizationId, canonicalName: resolved.canonicalName, created: false };
  }

  if (mode === "CREATE_IF_MISSING") {
    // Use db for the actual creation (supports tx), fall back to ensureOrganizationFromInput for non-tx calls
    if (db !== prisma) {
      const created = await createOrgInTx(db, orgName.trim());
      return { organizationId: created.organizationId, canonicalName: created.canonicalName, created: true };
    }
    const created = await ensureOrganizationFromInput(orgName.trim());
    return { organizationId: created.organizationId, canonicalName: created.canonicalName, created: true };
  }

  return { organizationId: null, canonicalName: resolved.canonicalName || orgName.trim(), created: false };
}

export interface CustResolveResult {
  customerId: string | null;
  created: boolean;
  matchStatus: "AUTO_MATCHED" | "UNMATCHED";
  matchScore: number | null;
  matchReason: string | null;
}

export async function resolveOrCreateCustomerForImport(
  input: MatchInput,
  mode: CustomerMode,
  organizationId: string | null,
  ownerUserId?: string | null,
  createCrmProfile?: boolean,
  db: DbLike = prisma,
): Promise<CustResolveResult> {
  if (!input.buyerName?.trim() || mode === "SKIP") {
    return { customerId: null, created: false, matchStatus: "UNMATCHED", matchScore: null, matchReason: null };
  }

  // Try matching against existing customers
  const candidateRecords = await db.customer.findMany({
    where: {
      deleted: false,
      OR: [
        { name: input.buyerName.trim() },
        ...(input.buyerWechat?.trim() ? [{ wechat: input.buyerWechat.trim() }] : []),
        ...(input.buyerPhone?.trim() ? [{ principal: { contains: input.buyerPhone.trim() } }] : []),
        ...(organizationId ? [{ organizationId }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      wechat: true,
      principal: true,
      organization: true,
      address: true,
      org: { select: { canonicalName: true, normalizedName: true, aliases: { select: { alias: true } } } },
    },
    take: 20,
  });

  const candidates: MatchCandidate[] = candidateRecords.map((c) => ({
    id: c.id,
    name: c.name,
    wechat: c.wechat,
    principal: c.principal,
    organization: c.organization,
    address: c.address,
    orgCanonicalName: c.org?.canonicalName,
    orgNormalizedName: c.org?.normalizedName,
    orgAliases: c.org?.aliases?.map((a) => a.alias) || [],
  }));

  const match = matchImportRow(input, candidates);

  if (match && match.score >= 60) {
    return {
      customerId: match.customerId,
      created: false,
      matchStatus: "AUTO_MATCHED",
      matchScore: match.score,
      matchReason: match.reason,
    };
  }

  if (mode === "CREATE_IF_MISSING") {
    const customerCode = await generateCustomerCode(db);
    const customer = await db.customer.create({
      data: {
        customerCode,
        name: input.buyerName!.trim(),
        principal: input.buyerPhone?.trim() || null,
        wechat: input.buyerWechat?.trim() || null,
        organization: input.buyerOrgName?.trim() || null,
        organizationId: organizationId,
        address: input.buyerAddress?.trim() || null,
      },
    });

    if (createCrmProfile && ownerUserId) {
      await db.crmCustomerProfile.create({
        data: {
          sourceCustomerId: customer.id,
          ownerUserId,
          stage: "LEAD",
          importance: "NORMAL",
          assignmentStatus: "ASSIGNED",
          lastFollowUpAt: new Date(),
        },
      });
    }

    return {
      customerId: customer.id,
      created: true,
      matchStatus: "AUTO_MATCHED",
      matchScore: 0,
      matchReason: "created_during_import",
    };
  }

  return { customerId: null, created: false, matchStatus: "UNMATCHED", matchScore: match?.score || null, matchReason: match?.reason || null };
}
