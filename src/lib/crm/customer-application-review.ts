import { prisma } from "@/lib/prisma";
import { generateCustomerCode } from "@/lib/customer-code";
import { resolveOrganization } from "@/lib/organization-resolver";

// ── Duplicate detection ─────────────────────────────────────────────────────

export interface DuplicateCandidate {
  id: string;
  name: string;
  customerCodeLast6: string;
  organization: string | null;
  hasCrmProfile: boolean;
  matchReasons: string[];
  // Internal only — stripped from client response
  profileOwnerUserId: string | null;
}

function normalizeOrgForMatch(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

function buildDupMatchReasons(
  input: { name: string; email: string | null; wechat: string | null; organization: string | null; miniProgramId: string | null; principal: string | null },
  customer: { name: string; email: string | null; wechat: string | null; organization: string | null; miniProgramId: string | null; principal: string | null },
): string[] {
  const reasons: string[] = [];
  if (customer.name === input.name) reasons.push("姓名相同");
  if (input.email && customer.email === input.email) reasons.push("邮箱相同");
  if (input.wechat && customer.wechat === input.wechat) reasons.push("微信相同");
  if (input.miniProgramId && customer.miniProgramId === input.miniProgramId) reasons.push("小程序ID匹配");
  if (input.principal && customer.principal === input.principal) reasons.push("负责人相同");
  if (input.organization && customer.organization) {
    if (normalizeOrgForMatch(customer.organization) === normalizeOrgForMatch(input.organization)) {
      reasons.push("单位匹配");
    }
  }
  return reasons;
}

export async function findDuplicateCustomers(input: {
  name: string; email?: string | null; wechat?: string | null;
  miniProgramId?: string | null; organizationId?: string | null;
  organizationRawInput?: string | null; organization?: string | null;
  principal?: string | null;
}): Promise<{ blocking: DuplicateCandidate[]; weak: DuplicateCandidate[] }> {
  const t = {
    name: input.name?.trim(),
    email: input.email?.trim() || null,
    wechat: input.wechat?.trim() || null,
    miniProgramId: input.miniProgramId?.trim() || null,
    organizationId: input.organizationId || null,
    organizationRawInput: input.organizationRawInput?.trim() || null,
    organization: input.organization?.trim() || null,
    principal: input.principal?.trim() || null,
  };

  if (!t.name) return { blocking: [], weak: [] };

  const orgText = t.organizationRawInput || t.organization;

  // Blocking match conditions
  const blockingOrs: Record<string, unknown>[] = [];
  if (t.email) blockingOrs.push({ email: t.email, name: t.name });
  if (t.wechat) blockingOrs.push({ wechat: t.wechat, name: t.name });
  if (t.miniProgramId) blockingOrs.push({ miniProgramId: t.miniProgramId });
  if (t.organizationId) {
    blockingOrs.push({ organizationId: t.organizationId, name: t.name });
  }
  if (orgText) {
    blockingOrs.push({ organization: orgText, name: t.name });
  }
  if (t.principal) blockingOrs.push({ name: t.name, principal: t.principal });

  // Collect IDs from blocking matches to exclude from weak
  let blockingRaw: Array<{
    id: string; name: string; customerCode: string; email: string | null;
    wechat: string | null; organization: string | null; principal: string | null;
    miniProgramId: string | null;
    crmProfile: { id: string; ownerUserId: string } | null;
  }> = [];

  // Also query with normalized org text to catch spacing/case diffs
  let normalizedOrgMatches: typeof blockingRaw = [];
  if (orgText && blockingOrs.length > 0) {
    const nameMatched = await prisma.customer.findMany({
      where: { deleted: false, name: t.name },
      select: {
        id: true, name: true, customerCode: true, email: true,
        wechat: true, organization: true, principal: true,
        miniProgramId: true,
        crmProfile: { select: { id: true, ownerUserId: true } },
      },
      take: 20,
    });
    const normalizedInput = normalizeOrgForMatch(orgText);
    normalizedOrgMatches = nameMatched.filter((c) =>
      c.organization && normalizeOrgForMatch(c.organization) === normalizedInput,
    );
  }

  if (blockingOrs.length > 0) {
    blockingRaw = await prisma.customer.findMany({
      where: { deleted: false, OR: blockingOrs },
      select: {
        id: true, name: true, customerCode: true, email: true,
        wechat: true, organization: true, principal: true,
        miniProgramId: true,
        crmProfile: { select: { id: true, ownerUserId: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
    });
  }

  // Merge normalized-org matches that weren't already found
  for (const nm of normalizedOrgMatches) {
    if (!blockingRaw.some((b) => b.id === nm.id)) {
      blockingRaw.push(nm);
    }
  }

  const blockingIds = new Set(blockingRaw.map((c) => c.id));
  const blocking = blockingRaw.map((c) => ({
    id: c.id,
    name: c.name,
    customerCodeLast6: c.customerCode.slice(-6),
    organization: c.organization,
    hasCrmProfile: !!c.crmProfile,
    matchReasons: buildDupMatchReasons(t, c),
    profileOwnerUserId: c.crmProfile?.ownerUserId ?? null,
  }));

  // Weak signal: pure name match (excluding blocking IDs)
  const weakRaw = await prisma.customer.findMany({
    where: { deleted: false, name: t.name, id: { notIn: [...blockingIds] } },
    select: {
      id: true, name: true, customerCode: true, email: true,
      wechat: true, organization: true, principal: true,
      miniProgramId: true,
      crmProfile: { select: { id: true, ownerUserId: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  const weak = weakRaw.map((c) => ({
    id: c.id,
    name: c.name,
    customerCodeLast6: c.customerCode.slice(-6),
    organization: c.organization,
    hasCrmProfile: !!c.crmProfile,
    matchReasons: ["姓名相同（弱匹配）"],
    profileOwnerUserId: c.crmProfile?.ownerUserId ?? null,
  }));

  return { blocking, weak };
}

// ── Conflict checks (split: org independent, customer depends on candidates) ──

export async function checkOrgOwnership(
  submittedByUserId: string,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) return false;

  const submitter = await prisma.user.findUnique({
    where: { id: submittedByUserId },
    select: { email: true },
  });
  if (!submitter?.email) return true; // can't determine rep → treat as conflict

  const rep = await prisma.representative.findUnique({
    where: { email: submitter.email },
    select: { id: true },
  });
  if (!rep) return true;

  const binding = await prisma.representativeOrganization.findFirst({
    where: {
      representativeId: rep.id,
      organizationId,
      status: "ACTIVE",
    },
  });
  return !binding; // true = conflict (org not in rep's bindings)
}

export function checkCustomerOwnershipConflict(
  candidates: DuplicateCandidate[],
  submittedByUserId: string,
): boolean {
  return candidates.some(
    (c) => c.hasCrmProfile && c.profileOwnerUserId && c.profileOwnerUserId !== submittedByUserId,
  );
}

// ── Auto-assign shared helper ────────────────────────────────────────────────

export async function autoAssignOrgCustomersToRep(
  organizationId: string,
  representativeEmail: string,
  assignerUserId: string,
): Promise<number> {
  const repUser = await prisma.user.findFirst({
    where: { email: representativeEmail, role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] } },
    select: { id: true },
  });
  if (!repUser) return 0;

  const unassigned = await prisma.crmCustomerProfile.findMany({
    where: {
      sourceCustomer: { organizationId, deleted: false },
      OR: [
        { assignmentStatus: { not: "ASSIGNED" } },
        { ownerUserId: { not: repUser.id } },
      ],
    },
    select: { id: true, ownerUserId: true },
  });

  const operations = unassigned.flatMap((profile) => [
    prisma.crmCustomerProfile.update({
      where: { id: profile.id },
      data: { ownerUserId: repUser.id, assignmentStatus: "ASSIGNED" },
    }),
    prisma.crmCustomerAssignmentLog.create({
      data: {
        profileId: profile.id,
        action: "ASSIGN",
        reason: "organization_binding_auto_assign",
        fromOwnerUserId: profile.ownerUserId,
        toOwnerUserId: repUser.id,
        createdByUserId: assignerUserId,
      },
    }),
  ]);

  if (operations.length > 0) {
    await prisma.$transaction(operations);
  }

  return unassigned.length;
}

// ── Legacy helpers ───────────────────────────────────────────────────────────

interface OrgValidation {
  error?: string;
  organizationId: string | null;
  organizationSiteId: string | null;
  canonicalName: string | null;
  resolvedFromText?: boolean;
}

export async function validateOrg(
  organizationId: string | null | undefined,
  organizationSiteId: string | null | undefined,
  rawOrgText?: string | null,
): Promise<OrgValidation> {
  // If no organizationId, try to resolve from raw text
  if (!organizationId) {
    if (rawOrgText?.trim()) {
      const resolved = await resolveOrganization(rawOrgText.trim());
      if (resolved.status === "exact" && resolved.organizationId) {
        return {
          organizationId: resolved.organizationId,
          organizationSiteId: resolved.organizationSiteId,
          canonicalName: resolved.canonicalName,
          resolvedFromText: true,
        };
      }
    }
    return { organizationId: null, organizationSiteId: null, canonicalName: null };
  }

  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { id: true, canonicalName: true, deleted: true, archived: true },
  });
  if (!org || org.deleted) {
    return { error: "指定的单位不存在", organizationId: null, organizationSiteId: null, canonicalName: null };
  }
  if (org.archived) {
    return { error: "指定的单位已归档，无法关联", organizationId: null, organizationSiteId: null, canonicalName: null };
  }

  const effectiveSiteId = (organizationSiteId || null);
  if (effectiveSiteId) {
    const site = await prisma.organizationSite.findUnique({
      where: { id: effectiveSiteId },
      select: { organizationId: true },
    });
    if (!site || site.organizationId !== organizationId) {
      return { error: "院区不属于指定机构", organizationId: null, organizationSiteId: null, canonicalName: null };
    }
  }

  return {
    organizationId: org.id,
    organizationSiteId: effectiveSiteId,
    canonicalName: org.canonicalName,
  };
}

export function buildCustomerData(
  application: {
    name: string; principal: string | null; email: string | null; wechat: string | null;
    organization: string | null; address: string | null; miniProgramId: string | null;
    organizationId: string | null; organizationRawInput?: string | null;
  },
  orgValidation: OrgValidation
) {
  const rawInput = application.organizationRawInput?.trim() || application.organization?.trim() || null;
  return {
    name: application.name.trim(),
    principal: application.principal?.trim() || null,
    email: application.email?.trim() || null,
    wechat: application.wechat?.trim() || null,
    organization: orgValidation.canonicalName || application.organization?.trim() || null,
    address: application.address?.trim() || null,
    miniProgramId: application.miniProgramId?.trim() || null,
    organizationId: orgValidation.organizationId || null,
    organizationSiteId: orgValidation.organizationSiteId,
    organizationRawInput: rawInput,
  };
}

type PrismaClientLike = {
  $transaction: typeof prisma.$transaction;
  customer: typeof prisma.customer;
  crmCustomerProfile: typeof prisma.crmCustomerProfile;
  crmCustomerApplication: typeof prisma.crmCustomerApplication;
};

export async function createCustomerWithRetry(
  client: PrismaClientLike,
  customerData: ReturnType<typeof buildCustomerData>,
  applicationId: string,
  ownerUserId: string,
  reviewerUserId: string,
  reviewNote: string | null,
  location?: { lat: number; lng: number; address: string } | null,
): Promise<{ error?: string; status?: number; application?: unknown }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await client.$transaction(async (tx: any) => {
        // Atomically claim the application with a conditional write
        const claim = await tx.crmCustomerApplication.updateMany({
          where: { id: applicationId, status: "PENDING" },
          data: { reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
        });
        if (claim.count === 0) {
          return { skipped: true };
        }

        const customerCode = await generateCustomerCode(tx);

        const customer = await tx.customer.create({
          data: { customerCode, ...customerData },
        });

        const profile = await tx.crmCustomerProfile.create({
          data: {
            sourceCustomerId: customer.id,
            ownerUserId,
            stage: "NEW",
            importance: "NORMAL",
            lastFollowUpAt: new Date(),
          },
        });

        // Create CrmCustomerAddress from location data if available
        if (location?.address?.trim()) {
          await tx.crmCustomerAddress.create({
            data: {
              profileId: profile.id,
              sourceType: "CUSTOMER_APPLICATION",
              addressText: location.address.trim(),
              lat: location.lat,
              lng: location.lng,
              isPrimary: true,
            },
          });
        }

        const updated = await tx.crmCustomerApplication.update({
          where: { id: applicationId },
          data: {
            status: "APPROVED",
            reviewedByUserId: reviewerUserId,
            reviewedAt: new Date(),
            reviewNote,
            createdCustomerId: customer.id,
            createdCrmProfileId: profile.id,
          },
          include: {
            submittedByUser: { select: { id: true, name: true, email: true } },
            reviewedByUser: { select: { id: true, name: true } },
            createdCustomer: { select: { id: true, name: true, customerCode: true } },
            createdCrmProfile: { select: { id: true, sourceCustomerId: true } },
          },
        });

        return { skipped: false, application: updated };
      });

      if (result.skipped) {
        return { error: "申请已被处理", status: 400 };
      }
      return { application: result.application };
    } catch (e: unknown) {
      const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!isPrismaUnique || attempt === 2) {
        console.error("Approve application error:", e);
        return { error: "审核操作失败", status: 500 };
      }
    }
  }

  return { error: "审核操作失败", status: 500 };
}
