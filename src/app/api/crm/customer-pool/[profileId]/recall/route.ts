import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { syncCustomerRepresentativeLinksByOwnerUser } from "@/lib/crm/customer-representative-sync";

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
  const { reason } = body;

  const profile = await prisma.crmCustomerProfile.findUnique({ where: { id: profileId } });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  if (profile.assignmentStatus !== "ASSIGNED" && profile.assignmentStatus !== "RECALL_CANDIDATE") {
    return NextResponse.json({ error: "只能收回已分配或待收回的客户" }, { status: 400 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.crmCustomerProfile.update({
      where: { id: profileId },
      data: {
        assignmentStatus: "RECALLED",
        recalledAt: new Date(),
        recalledByUserId: session.user.id,
        reflowReason: reason || null,
      },
      include: {
        sourceCustomer: { select: { id: true, name: true, customerCode: true } },
        ownerUser: { select: { id: true, name: true } },
      },
    });

    await tx.crmCustomerAssignmentLog.create({
      data: {
        profileId,
        fromOwnerUserId: profile.ownerUserId,
        toOwnerUserId: null,
        action: "RECALL",
        reason: reason || null,
        createdByUserId: session.user.id,
      },
    });

    await syncCustomerRepresentativeLinksByOwnerUser(
      profile.sourceCustomerId,
      profile.ownerUserId,
      false,
      tx,
    );

    return updated;
  });

  // Notify the original owner that their customer was recalled (skip self)
  if (profile.ownerUserId && profile.ownerUserId !== session.user.id) {
    const customerName = result.sourceCustomer?.name || "未知客户";
    prisma.notification.create({
      data: {
        userId: profile.ownerUserId,
        title: "客户已收回",
        content: `客户 ${customerName} 已被收回到客户池`,
        type: "CRM_CUSTOMER_RECALLED",
        link: "/crm/customer-pool?assignmentStatus=RECALLED",
      },
    }).catch(() => {});
  }

  return NextResponse.json({ profile: result });
}
