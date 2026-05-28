import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateOrg, buildCustomerData, findDuplicateCustomers, checkOrgOwnership, checkCustomerOwnershipConflict } from "@/lib/crm/customer-application-review";
import { generateCustomerCode } from "@/lib/customer-code";
import { notifyApplicationSupervisors, getManagedSubmitterUserIds } from "@/lib/crm/supervisor";

const applicationInclude = {
  submittedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true } },
  createdCustomer: { select: { id: true, name: true, customerCode: true } },
  createdCrmProfile: { select: { id: true, sourceCustomerId: true } },
};

// Privacy-safe candidate shape for 409 / non-reviewer responses
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

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || "";
  const review = searchParams.get("review") || "";
  const view = searchParams.get("view") || "";

  const where: Record<string, unknown> = {};

  // ── Role-based access (allow-list) ──
  if (session.user.role === "ADMIN" || session.user.role === "USER") {
    // no restriction
  } else if (session.user.role === "REPRESENTATIVE") {
    where.submittedByUserId = session.user.id;
  } else if (session.user.role === "REGIONAL_MANAGER") {
    const repUserIds = await getManagedSubmitterUserIds(session.user.id);
    if (repUserIds.length > 0) {
      where.submittedByUserId = { in: repUserIds };
    } else {
      where.submittedByUserId = session.user.id;
    }
  } else {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (status) where.status = status;
  if (review === "PENDING") {
    where.status = "APPROVED";
    where.OR = [
      { supervisorReviewStatus: "PENDING" },
      { adminReviewStatus: "PENDING", supervisorReviewStatus: "NONE" },
    ];
  }
  if (view === "pending") {
    where.status = "PENDING";
  } else if (view === "review") {
    where.status = "APPROVED";
    where.OR = [
      { supervisorReviewStatus: "PENDING" },
      { adminReviewStatus: "PENDING", supervisorReviewStatus: "NONE" },
    ];
  }

  const applications = await prisma.crmCustomerApplication.findMany({
    where,
    include: applicationInclude,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ applications });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Allow-list: only ADMIN, REPRESENTATIVE, REGIONAL_MANAGER can submit
  const allowedRoles = ["ADMIN", "REPRESENTATIVE", "REGIONAL_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    name, principal, email, wechat, organization,
    organizationId, organizationSiteId, organizationRawInput, address, miniProgramId, notes,
    locationLat, locationLng, locationAddress,
    duplicateDecision,
  } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "客户姓名为必填项" }, { status: 400 });
  }

  // Resolve organization
  const rawOrgText = organizationRawInput?.trim() || organization?.trim() || null;
  const orgValidation = await validateOrg(organizationId || null, organizationSiteId || null, rawOrgText);
  if (orgValidation.error) {
    return NextResponse.json({ error: orgValidation.error }, { status: 400 });
  }

  // ── Duplicate detection ──
  const { blocking, weak } = await findDuplicateCustomers({
    name: name.trim(),
    email,
    wechat,
    miniProgramId,
    organizationId: orgValidation.organizationId || null,
    organizationRawInput: rawOrgText,
    organization,
    principal,
  });
  const allCandidates = [...blocking, ...weak];

  if (blocking.length > 0 && duplicateDecision !== "CREATE_NEW") {
    return NextResponse.json({
      error: "检测到可能重复的客户",
      code: "DUPLICATE_CANDIDATES",
      candidates: blocking.map(pruneCandidate),
    }, { status: 409 });
  }

  // ── Conflict checks ──
  const hasOrgConflict = await checkOrgOwnership(session.user.id, orgValidation.organizationId, orgValidation.organizationSiteId);
  const hasCustConflict = checkCustomerOwnershipConflict(allCandidates, session.user.id);

  let conflictType: string | null = null;
  if (hasOrgConflict && hasCustConflict) conflictType = "BOTH";
  else if (hasOrgConflict) conflictType = "ORG_CONFLICT";
  else if (hasCustConflict) conflictType = "CUSTOMER_CONFLICT";

  const isOverride = blocking.length > 0 && duplicateDecision === "CREATE_NEW";
  const duplicateCheckStatus = isOverride ? "OVERRIDDEN_NEW" : (blocking.length > 0 ? "CANDIDATES_FOUND" : "CLEAN");
  const supervisorReviewReason = isOverride ? "DUPLICATE_OVERRIDE" : (conflictType || "NORMAL");

  const appData = {
    name: name.trim(),
    principal: principal?.trim() || null,
    email: email?.trim() || null,
    wechat: wechat?.trim() || null,
    organization: orgValidation.canonicalName || organization?.trim() || null,
    organizationId: orgValidation.organizationId || null,
    organizationSiteId: orgValidation.organizationSiteId || null,
    organizationRawInput: rawOrgText,
    address: address?.trim() || null,
    miniProgramId: miniProgramId?.trim() || null,
    notes: notes?.trim() || null,
  };

  const customerData = buildCustomerData(appData, orgValidation);
  const location = (typeof locationLat === "number" && typeof locationLng === "number")
    ? { lat: locationLat, lng: locationLng, address: locationAddress?.trim() || address?.trim() || "" }
    : null;

  // Auto-approve: create Customer + CrmCustomerProfile in a transaction
  let application: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        const customer = await tx.customer.create({
          data: { customerCode, ...customerData },
        });

        const profile = await tx.crmCustomerProfile.create({
          data: {
            sourceCustomerId: customer.id,
            ownerUserId: session.user.id,
            stage: "LEAD",
            importance: "NORMAL",
            lastFollowUpAt: new Date(),
          },
        });

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

        const app = await tx.crmCustomerApplication.create({
          data: {
            name: appData.name,
            principal: appData.principal,
            email: appData.email,
            wechat: appData.wechat,
            organization: appData.organization,
            organizationId: appData.organizationId,
            organizationSiteId: appData.organizationSiteId,
            organizationRawInput: appData.organizationRawInput,
            address: appData.address,
            miniProgramId: appData.miniProgramId,
            notes: appData.notes,
            locationLat: typeof locationLat === "number" ? locationLat : null,
            locationLng: typeof locationLng === "number" ? locationLng : null,
            locationAddress: locationAddress?.trim() || null,
            status: "APPROVED",
            autoApproved: true,
            autoApprovedAt: new Date(),
            submittedByUserId: session.user.id,
            createdCustomerId: customer.id,
            createdCrmProfileId: profile.id,
            // ── Supervisor review fields ──
            supervisorReviewStatus: "PENDING",
            supervisorReviewReason,
            duplicateCheckStatus,
            duplicateCandidatesJson: allCandidates.length > 0 ? JSON.stringify(allCandidates.map(pruneCandidate)) : null,
            conflictType,
            // Backward compat
            adminReviewStatus: "PENDING",
          },
          include: applicationInclude,
        });

        return app;
      });
      application = result;
      break;
    } catch (e: unknown) {
      const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!isPrismaUnique || attempt === 2) {
        console.error("Auto-approve application error:", e);
        return NextResponse.json({ error: "申请提交失败" }, { status: 500 });
      }
    }
  }

  // Notify supervisors (in-app only; email is cron-only)
  const app = application as { id: string } | undefined;
  if (app?.id) {
    notifyApplicationSupervisors(app.id, supervisorReviewReason).catch(() => {});
  }

  return NextResponse.json({ application }, { status: 201 });
}
