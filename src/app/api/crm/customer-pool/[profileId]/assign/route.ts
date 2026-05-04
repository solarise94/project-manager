import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { ensureSalesUserForRepresentative } from "@/lib/representative-user";
import { getAppUrl } from "@/lib/app-url";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { profileId } = await params;
  const body = await req.json();
  const { representativeId, reason } = body;

  if (!representativeId) return NextResponse.json({ error: "representativeId is required" }, { status: 400 });

  const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
  if (!rep || rep.archived) return NextResponse.json({ error: "代表未找到或已归档" }, { status: 400 });

  let targetUserId: string;
  try {
    ({ userId: targetUserId } = await ensureSalesUserForRepresentative(rep));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "代表账号同步失败" },
      { status: 409 }
    );
  }
  const targetUserEmail = rep.email;

  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { id: profileId },
    include: { sourceCustomer: { select: { name: true } } },
  });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmCustomerProfile.update({
      where: { id: profileId },
      data: {
        ownerUserId: targetUserId,
        assignmentStatus: "ASSIGNED",
        assignedAt: new Date(),
        assignedByUserId: session.user.id,
        recalledAt: null,
        recalledByUserId: null,
        reflowReason: null,
      },
      include: {
        sourceCustomer: { select: { id: true, name: true, customerCode: true } },
        ownerUser: { select: { id: true, name: true } },
      },
    });

    await tx.crmCustomerAssignmentLog.create({
      data: {
        profileId,
        fromOwnerUserId: profile.ownerUserId !== targetUserId ? profile.ownerUserId : null,
        toOwnerUserId: targetUserId,
        action: "ASSIGN",
        reason: reason || null,
        createdByUserId: session.user.id,
      },
    });

    return updated;
  });

  // Create notification for the assignee
  const customerName = profile.sourceCustomer?.name || "未知客户";
  prisma.notification.create({
    data: {
      userId: targetUserId,
      title: "有新的客户线索待查看",
      content: `客户 ${customerName} 已分配给您`,
      type: "CRM_ASSIGNMENT",
      link: `/crm/customers/${profile.sourceCustomerId}`,
    },
  }).catch(() => {});

  // Send email notification (fire-and-forget, no customer details in email)
  const loginUrl = getAppUrl("/login");
  sendMail({
    to: targetUserEmail,
    subject: "【SciManage】有新的客户线索待查看",
    text: `您好，\n\n有新的客户线索已分配给您，请登录系统查看。\n\n${loginUrl}`,
    html: `<p>您好，</p><p>有新的客户线索已分配给您，请登录系统查看。</p><p><a href="${loginUrl}">登录 SciManage</a></p>`,
  }).catch((err) => console.error("Failed to send assignment email:", err));

  return NextResponse.json({ profile: result });
}
