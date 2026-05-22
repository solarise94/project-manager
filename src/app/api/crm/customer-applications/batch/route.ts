import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateOrg, buildCustomerData, createCustomerWithRetry } from "@/lib/crm/customer-application-review";
import { assertRepresentativeBackedSalesUser } from "@/lib/representative-user";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Only ADMIN can batch; REPRESENTATIVE and REGIONAL_MANAGER cannot
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { action, ids, ownerUserId, reviewNote } = body as {
    action: string;
    ids: string[];
    ownerUserId?: string;
    reviewNote?: string;
  };

  if (!Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: "ids must be a non-empty array" }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'approve' or 'reject'" }, { status: 400 });
  }

  if (ownerUserId) {
    try {
      await assertRepresentativeBackedSalesUser(ownerUserId);
    } catch (error) {
      return NextResponse.json({ error: error instanceof Error ? error.message : "负责人无效" }, { status: 400 });
    }
  }

  const trimmedNote = reviewNote?.trim() || null;

  let approved = 0;
  let rejected = 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  const errors: Array<{ id: string; error: string }> = [];

  for (const id of ids) {
    try {
      const application = await prisma.crmCustomerApplication.findUnique({
        where: { id },
        select: {
          id: true,
          status: true,
          autoApproved: true,
          supervisorReviewStatus: true,
          submittedByUserId: true,
          name: true,
          principal: true,
          email: true,
          wechat: true,
          organization: true,
          organizationId: true,
          organizationSiteId: true,
          organizationRawInput: true,
          address: true,
          miniProgramId: true,
          locationLat: true,
          locationLng: true,
          locationAddress: true,
        },
      });

      if (!application) {
        skipped.push({ id, reason: "申请不存在" });
        continue;
      }
      if (application.autoApproved || application.supervisorReviewStatus !== "NONE") {
        skipped.push({ id, reason: "需主管逐条复核，不支持批量操作" });
        continue;
      }
      if (application.status !== "PENDING") {
        skipped.push({ id, reason: "该申请已处理" });
        continue;
      }

      if (action === "reject") {
        await prisma.crmCustomerApplication.update({
          where: { id },
          data: {
            status: "REJECTED",
            reviewedByUserId: session.user.id,
            reviewedAt: new Date(),
            reviewNote: trimmedNote,
          },
        });
        rejected++;
        continue;
      }

      // action === "approve"
      const finalOwnerUserId = ownerUserId || application.submittedByUserId;
      const orgValidation = await validateOrg(
        application.organizationId, application.organizationSiteId,
        application.organizationRawInput || application.organization,
      );
      if (orgValidation.error) {
        errors.push({ id, error: orgValidation.error });
        continue;
      }

      const location = (application.locationLat != null && application.locationLng != null)
        ? { lat: application.locationLat, lng: application.locationLng, address: application.locationAddress || application.address || "" }
        : null;

      const customerData = buildCustomerData(application, orgValidation);
      const result = await createCustomerWithRetry(
        prisma, customerData, application.id, finalOwnerUserId, session.user.id, trimmedNote, location,
      );

      if (result.error) {
        errors.push({ id, error: result.error || "审核失败" });
      } else {
        approved++;
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "未知错误";
      errors.push({ id, error: msg });
    }
  }

  return NextResponse.json({ ok: true, approved, rejected, skipped, errors });
}
