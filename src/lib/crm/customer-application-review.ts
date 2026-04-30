import { prisma } from "@/lib/prisma";
import { generateCustomerCode } from "@/lib/customer-code";

interface OrgValidation {
  error?: string;
  organizationId: string | null;
  organizationSiteId: string | null;
  canonicalName: string | null;
}

export async function validateOrg(
  organizationId: string | null | undefined,
  organizationSiteId: string | null | undefined
): Promise<OrgValidation> {
  if (!organizationId) {
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
    organizationId: string | null;
  },
  orgValidation: OrgValidation
) {
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
    organizationRawInput: application.organization || null,
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
  reviewNote: string | null
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
