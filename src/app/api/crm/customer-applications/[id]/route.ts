import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { validateOrg, buildCustomerData, createCustomerWithRetry, findDuplicateCustomers } from "@/lib/crm/customer-application-review";
import { getRegionalManagerUserIds } from "@/lib/crm/permissions";

const applicationInclude = {
  submittedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true } },
  createdCustomer: { select: { id: true, name: true, customerCode: true } },
  createdCrmProfile: { select: { id: true, sourceCustomerId: true } },
};

async function canReviewApplication(
  userId: string,
  role: string,
  application: { submittedByUserId: string },
): Promise<boolean> {
  if (role === "ADMIN") return true;
  if (role === "REGIONAL_MANAGER") {
    const repUserIds = await getRegionalManagerUserIds(userId);
    return repUserIds !== null && repUserIds.includes(application.submittedByUserId);
  }
  return false;
}

function pruneCandidate(c: {
  id: string; name: string; customerCodeLast6: string;
  organization: string | null; hasCrmProfile: boolean; matchReasons: string[];
}) {
  return {
    id: c.id,
    name: c.name,
    customerCodeLast6: c.customerCodeLast6,
    organization: c.organization,
    hasCrmProfile: c.hasCrmProfile,
    matchReasons: c.matchReasons,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Allow-list: only ADMIN, REPRESENTATIVE, REGIONAL_MANAGER
  const allowedRoles = ["ADMIN", "REPRESENTATIVE", "REGIONAL_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const application = await prisma.crmCustomerApplication.findUnique({
    where: { id },
    include: applicationInclude,
  });
  if (!application) {
    return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  }

  if (isRepresentative(session.user.role) && application.submittedByUserId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { blocking, weak } = await findDuplicateCustomers({
    name: application.name,
    email: application.email,
    wechat: application.wechat,
    organizationId: application.organizationId,
    organizationRawInput: application.organizationRawInput,
    organization: application.organization,
    principal: application.principal,
  });
  const allCandidates = [...blocking, ...weak];

  // Privacy: reviewers get full detail; reps get pruned candidates
  const isReviewer = await canReviewApplication(session.user.id, session.user.role, application);
  const responseCandidates = isReviewer ? allCandidates : allCandidates.map(pruneCandidate);

  return NextResponse.json({ application, candidates: responseCandidates });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Allow-list: only ADMIN and REGIONAL_MANAGER can perform review actions
  // REPRESENTATIVE and USER are blocked from all mutations
  const allowedRoles = ["ADMIN", "REGIONAL_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action } = body;

  const application = await prisma.crmCustomerApplication.findUnique({ where: { id } });
  if (!application) {
    return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  }

  // ── Supervisor review actions (confirm-review / reject-review) ──

  if (action === "confirm-review" || action === "reject-review") {
    if (!(await canReviewApplication(session.user.id, session.user.role, application))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  if (action === "confirm-review") {
    const reviewNote = body.reviewNote?.trim() || null;
    const claimed = await prisma.$transaction(async (tx) => {
      const result = await tx.crmCustomerApplication.updateMany({
        where: {
          id,
          OR: [
            { supervisorReviewStatus: "PENDING" },
            { adminReviewStatus: "PENDING", supervisorReviewStatus: "NONE" },
          ],
        },
        data: {
          supervisorReviewStatus: "CONFIRMED",
          supervisorReviewedByUserId: session.user.id,
          supervisorReviewedAt: new Date(),
          supervisorReviewNote: reviewNote,
          adminReviewStatus: "CONFIRMED",
          adminReviewedByUserId: session.user.id,
          adminReviewedAt: new Date(),
          adminReviewNote: reviewNote,
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          reviewNote,
        },
      });
      if (result.count === 0) return { claimed: false, application: null };

      const updated = await tx.crmCustomerApplication.findUnique({
        where: { id },
        include: applicationInclude,
      });
      return { claimed: true, application: updated };
    });

    if (!claimed.claimed) {
      return NextResponse.json({ error: "该申请已被处理" }, { status: 400 });
    }
    return NextResponse.json({ application: claimed.application });
  }

  if (action === "reject-review") {
    const reviewNote = body.reviewNote?.trim() || null;
    const claimed = await prisma.$transaction(async (tx) => {
      const claimResult = await tx.crmCustomerApplication.updateMany({
        where: {
          id,
          OR: [
            { supervisorReviewStatus: "PENDING" },
            { adminReviewStatus: "PENDING", supervisorReviewStatus: "NONE" },
          ],
        },
        data: {
          supervisorReviewStatus: "REJECTED",
          supervisorReviewedByUserId: session.user.id,
          supervisorReviewedAt: new Date(),
          supervisorReviewNote: reviewNote,
          adminReviewStatus: "REJECTED",
          adminReviewedByUserId: session.user.id,
          adminReviewedAt: new Date(),
          adminReviewNote: reviewNote,
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          reviewNote,
          status: "REJECTED",
        },
      });
      if (claimResult.count === 0) return { claimed: false };

      // Clean up auto-created customer/profile
      if (application.createdCrmProfileId) {
        await tx.crmCustomerProfile.deleteMany({
          where: { id: application.createdCrmProfileId },
        });
      }

      if (application.createdCustomerId) {
        const depCounts = await Promise.all([
          tx.project.count({ where: { customerId: application.createdCustomerId, deleted: false } }),
          tx.order.count({ where: { customerId: application.createdCustomerId } }),
          tx.financeCost.count({ where: { customerId: application.createdCustomerId } }),
          tx.customerRelation.count({ where: { OR: [{ fromCustomerId: application.createdCustomerId }, { toCustomerId: application.createdCustomerId }] } }),
        ]);
        const hasDeps = depCounts.some((c) => c > 0);
        if (hasDeps) {
          await tx.customer.update({
            where: { id: application.createdCustomerId },
            data: { deleted: true },
          });
        } else {
          await tx.customer.delete({ where: { id: application.createdCustomerId } });
        }
      }

      return { claimed: true };
    });

    if (!claimed.claimed) {
      return NextResponse.json({ error: "该申请已被处理" }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  }

  // ── Legacy actions for old PENDING applications ──
  if (application.status !== "PENDING") {
    return NextResponse.json({ error: "该申请已处理" }, { status: 400 });
  }

  if (action === "reject") {
    const reviewNote = body.reviewNote?.trim() || null;
    const updated = await prisma.crmCustomerApplication.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedByUserId: session.user.id,
        reviewedAt: new Date(),
        reviewNote,
      },
      include: applicationInclude,
    });
    return NextResponse.json({ application: updated });
  }

  if (action === "approve") {
    return handleApprove(session, application, body);
  }

  if (action === "approve-bind") {
    return handleApproveBind(session, application, body);
  }

  return NextResponse.json({ error: "无效操作" }, { status: 400 });
}

async function handleApprove(
  session: { user: { id: string; role: string } },
  application: { id: string; submittedByUserId: string; name: string; principal: string | null; email: string | null; wechat: string | null; organization: string | null; organizationId: string | null; organizationSiteId: string | null; organizationRawInput: string | null; address: string | null; miniProgramId: string | null; locationLat: number | null; locationLng: number | null; locationAddress: string | null },
  body: { ownerUserId?: string; reviewNote?: string }
) {
  const finalOwnerUserId = body.ownerUserId || application.submittedByUserId;
  const reviewNote = body.reviewNote?.trim() || null;

  if (body.ownerUserId) {
    const ownerUser = await prisma.user.findUnique({ where: { id: body.ownerUserId }, select: { id: true } });
    if (!ownerUser) {
      return NextResponse.json({ error: "指定的负责人不存在" }, { status: 400 });
    }
  }

  const rawOrgText = application.organizationRawInput || application.organization;
  const orgValidation = await validateOrg(
    application.organizationId,
    application.organizationSiteId,
    rawOrgText,
  );
  if (orgValidation.error) {
    return NextResponse.json({ error: orgValidation.error }, { status: 400 });
  }

  const location = (application.locationLat != null && application.locationLng != null)
    ? { lat: application.locationLat, lng: application.locationLng, address: application.locationAddress || application.address || "" }
    : null;

  const customerData = buildCustomerData(application, orgValidation);
  const result = await createCustomerWithRetry(prisma, customerData, application.id, finalOwnerUserId, session.user.id, reviewNote, location);
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: result.status || 500 });
  }
  return NextResponse.json({ application: result.application });
}

async function handleApproveBind(
  session: { user: { id: string; role: string } },
  application: { id: string; submittedByUserId: string; name: string },
  body: { targetCustomerId?: string; ownerUserId?: string; reviewNote?: string }
) {
  const targetCustomerId = body.targetCustomerId;
  if (!targetCustomerId) {
    return NextResponse.json({ error: "targetCustomerId is required" }, { status: 400 });
  }

  const targetCustomer = await prisma.customer.findUnique({
    where: { id: targetCustomerId },
    select: { id: true, deleted: true },
  });
  if (!targetCustomer || targetCustomer.deleted) {
    return NextResponse.json({ error: "目标客户不存在" }, { status: 404 });
  }

  const existingProfile = await prisma.crmCustomerProfile.findUnique({
    where: { sourceCustomerId: targetCustomerId },
  });
  if (existingProfile) {
    return NextResponse.json({ error: "该客户已有 CRM 档案" }, { status: 409 });
  }

  const finalOwnerUserId = body.ownerUserId || application.submittedByUserId;

  if (body.ownerUserId) {
    const ownerUser = await prisma.user.findUnique({ where: { id: body.ownerUserId }, select: { id: true } });
    if (!ownerUser) {
      return NextResponse.json({ error: "指定的负责人不存在" }, { status: 400 });
    }
  }

  const reviewNote = body.reviewNote?.trim() || null;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.crmCustomerProfile.create({
        data: {
          sourceCustomerId: targetCustomerId,
          ownerUserId: finalOwnerUserId,
          stage: "NEW",
          importance: "NORMAL",
          lastFollowUpAt: new Date(),
        },
      });

      const updated = await tx.crmCustomerApplication.update({
        where: { id: application.id },
        data: {
          status: "APPROVED",
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          reviewNote,
          createdCustomerId: targetCustomerId,
          createdCrmProfileId: profile.id,
        },
        include: applicationInclude,
      });

      return updated;
    });

    return NextResponse.json({ application: result });
  } catch (error) {
    console.error("Approve-bind application error:", error);
    return NextResponse.json({ error: "审核操作失败" }, { status: 500 });
  }
}
