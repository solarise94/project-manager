import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { resolveBindingReviewers } from "@/lib/crm/supervisor";
import { autoAssignOrgCustomersToRep } from "@/lib/crm/customer-application-review";

async function canReviewBinding(userId: string, role: string, representativeId: string): Promise<boolean> {
  if (role === "ADMIN") return true;
  const reviewers = await resolveBindingReviewers(representativeId);
  return reviewers.some((r) => r.id === userId);
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();
  const { action, reviewNote } = body as { action: "approve" | "reject"; reviewNote?: string };

  const binding = await prisma.representativeOrganization.findUnique({
    where: { id },
    include: { representative: { select: { id: true, email: true } } },
  });
  if (!binding) return NextResponse.json({ error: "绑定不存在" }, { status: 404 });

  if (!(await canReviewBinding(session.user.id, session.user.role, binding.representativeId))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (action === "approve") {
    // If organizationId is null (new-org request), it must be resolved first
    if (!binding.organizationId) {
      if (!binding.organizationReviewTaskId) {
        return NextResponse.json({ error: "该绑定缺少单位信息，无法审批" }, { status: 400 });
      }
      const task = await prisma.organizationReviewTask.findUnique({
        where: { id: binding.organizationReviewTaskId },
        select: { suggestedOrganizationId: true, status: true },
      });
      if (task?.status !== "APPROVED" || !task.suggestedOrganizationId) {
        return NextResponse.json({ error: "单位审核任务尚未完成，请先通过单位主数据审核" }, { status: 400 });
      }
      // Backfill organizationId
      await prisma.representativeOrganization.update({
        where: { id },
        data: { organizationId: task.suggestedOrganizationId },
      });
      binding.organizationId = task.suggestedOrganizationId;
    }

    const updated = await prisma.representativeOrganization.update({
      where: { id },
      data: {
        status: "ACTIVE",
        reviewedByUserId: session.user.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote?.trim() || null,
      },
    });

    let autoAssigned = 0;
    if (binding.organizationId) {
      autoAssigned = await autoAssignOrgCustomersToRep(
        binding.organizationId,
        binding.representative.email,
        session.user.id,
      );
    }

    return NextResponse.json({ binding: updated, autoAssigned });
  }

  if (action === "reject") {
    const updated = await prisma.representativeOrganization.update({
      where: { id },
      data: {
        status: "REJECTED",
        reviewedByUserId: session.user.id,
        reviewedAt: new Date(),
        reviewNote: reviewNote?.trim() || null,
      },
    });
    return NextResponse.json({ binding: updated });
  }

  return NextResponse.json({ error: "无效操作" }, { status: 400 });
}
