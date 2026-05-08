import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCrmProfileScopeWhere, isRepresentativeRole, isRegionalManagerRole, extractScopedUserIds } from "@/lib/crm/permissions";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const task = await prisma.crmFollowUpTask.findUnique({
    where: { id },
    include: { profile: { select: { ownerUserId: true, assignmentStatus: true } } },
  });
  if (!task) return NextResponse.json({ error: "Task not found" }, { status: 404 });

  if (isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role)) {
    // Allow if task is directly assigned to this user (e.g. pushed from projects)
    if (task.ownerUserId === session.user.id) {
      // pass
    } else {
      const scope = await getCrmProfileScopeWhere(session.user.id, session.user.role);
      const ids = extractScopedUserIds(scope);
      if (!ids?.includes(task.profile.ownerUserId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      if (task.profile.assignmentStatus !== "ASSIGNED") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.title !== undefined) data.title = body.title;
  if (body.dueAt !== undefined) {
    data.dueAt = new Date(body.dueAt);
    data.reminderSent = false;
    data.reminderStatus = "PENDING";
    data.reminderLockedAt = null;
    data.reminderSentAt = null;
    data.reminderError = null;
  }

  if (body.status === "DONE") {
    data.status = "DONE";
    data.completedAt = new Date();
    data.sourceOpenKey = null;
    if (body.completedInteractionId) data.completedInteractionId = body.completedInteractionId;
  } else if (body.status === "CANCELLED") {
    data.status = "CANCELLED";
    data.sourceOpenKey = null;
  }

  const needsRecalc = body.status === "DONE" || body.status === "CANCELLED" || body.dueAt !== undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.crmFollowUpTask.update({
      where: { id },
      data,
      include: {
        ownerUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
        profile: {
          select: {
            id: true,
            sourceCustomerId: true,
            sourceCustomer: { select: { id: true, name: true, customerCode: true } },
          },
        },
      },
    });

    if (needsRecalc) {
      const nextOpen = await tx.crmFollowUpTask.findFirst({
        where: { profileId: task.profileId, status: "OPEN" },
        orderBy: { dueAt: "asc" },
      });
      await tx.crmCustomerProfile.update({
        where: { id: task.profileId },
        data: { nextFollowUpAt: nextOpen?.dueAt ?? null },
      });
    }

    return result;
  });

  return NextResponse.json({ task: updated });
}
