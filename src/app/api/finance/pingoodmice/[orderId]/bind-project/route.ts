import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { orderId } = await params;
  const body = await req.json();
  const { projectId } = body;

  if (!projectId) {
    return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
  }

  const order = await prisma.externalOrder.findUnique({ where: { id: orderId } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, name: true, customerId: true },
  });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Cross-validate customer consistency
  if (order.customerId && project.customerId && order.customerId !== project.customerId) {
    return NextResponse.json({
      error: `订单客户与项目客户不一致。订单客户: ${order.customerId}, 项目客户: ${project.customerId}`,
    }, { status: 409 });
  }

  const updateData: Record<string, unknown> = { projectId };
  // Inherit customer from project if order has none
  if (!order.customerId && project.customerId) {
    updateData.customerId = project.customerId;
    updateData.customerMatchStatus = "MANUAL_MATCHED";
    updateData.customerMatchReason = "inherited_from_project_bind";
  }

  const updated = await prisma.externalOrder.update({
    where: { id: orderId },
    data: updateData,
    select: {
      id: true, externalOrderNo: true,
      projectId: true, project: { select: { id: true, name: true } },
      customerId: true, customer: { select: { id: true, name: true } },
    },
  });

  // Inherit customer from order to project if project has none
  if (order.customerId && !project.customerId) {
    await prisma.project.update({
      where: { id: projectId },
      data: { customerId: order.customerId },
    });
  }

  return NextResponse.json(updated);
}
