import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { validateOrg, buildCustomerData, createCustomerWithRetry } from "@/lib/crm/customer-application-review";

const applicationInclude = {
  submittedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true } },
  createdCustomer: { select: { id: true, name: true, customerCode: true } },
  createdCrmProfile: { select: { id: true, sourceCustomerId: true } },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  const candidates = await findCandidateCustomers(application);
  return NextResponse.json({ application, candidates });
}

async function findCandidateCustomers(app: {
  name: string;
  email: string | null;
  wechat: string | null;
  organization: string | null;
}) {
  const ors: Record<string, unknown>[] = [{ name: { equals: app.name } }];
  if (app.email) ors.push({ email: { equals: app.email } });
  if (app.wechat) ors.push({ wechat: { equals: app.wechat } });
  if (app.organization) {
    ors.push({ organization: { equals: app.organization } });
  }

  const candidates = await prisma.customer.findMany({
    where: { deleted: false, OR: ors },
    select: {
      id: true, name: true, customerCode: true, email: true, wechat: true,
      organization: true, principal: true, archived: true,
      crmProfile: { select: { id: true } },
      _count: { select: { projects: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
  });

  return candidates.map((c) => ({
    ...c,
    matchReasons: buildMatchReasons(app, c),
  }));
}

function buildMatchReasons(
  app: { name: string; email: string | null; wechat: string | null; organization: string | null },
  c: { name: string; email: string | null; wechat: string | null; organization: string | null }
): string[] {
  const reasons: string[] = [];
  if (c.name === app.name) reasons.push("姓名相同");
  if (app.email && c.email === app.email) reasons.push("邮箱相同");
  if (app.wechat && c.wechat === app.wechat) reasons.push("微信相同");
  if (app.organization && c.organization === app.organization) reasons.push("单位相同");
  return reasons;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = await req.json();
  const { action } = body;

  const application = await prisma.crmCustomerApplication.findUnique({ where: { id } });
  if (!application) {
    return NextResponse.json({ error: "申请不存在" }, { status: 404 });
  }
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
  application: { id: string; submittedByUserId: string; name: string; principal: string | null; email: string | null; wechat: string | null; organization: string | null; organizationId: string | null; organizationSiteId: string | null; address: string | null; miniProgramId: string | null },
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

  const orgValidation = await validateOrg(application.organizationId, application.organizationSiteId);
  if (orgValidation.error) {
    return NextResponse.json({ error: orgValidation.error }, { status: 400 });
  }

  const customerData = buildCustomerData(application, orgValidation);
  const result = await createCustomerWithRetry(prisma, customerData, application.id, finalOwnerUserId, session.user.id, reviewNote);
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
