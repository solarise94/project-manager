import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";
import { linkOrderToProject, OrderProjectCustomerConflictError } from "@/lib/orders/link-project";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.order.findUnique({ where: { id }, select: { id: true } });
  if (!order) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (session.user.role !== "ADMIN") {
    const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);
    if (scopeWhere) {
      const inScope = await prisma.order.count({ where: { id, AND: [scopeWhere] } });
      if (inScope === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const links = await prisma.orderProjectLink.findMany({
    where: { orderId: id },
    include: {
      project: { select: { id: true, name: true, status: true, customerId: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ links });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: orderId } = await params;
  const body = await req.json();
  const { projectId, treatment, allocatedAmount, isPrimary, note } = body as Record<string, unknown>;

  if (!projectId) return NextResponse.json({ error: "projectId is required" }, { status: 400 });

  const [order, project] = await Promise.all([
    prisma.order.findUnique({ where: { id: orderId }, select: { id: true, customerId: true } }),
    prisma.project.findUnique({ where: { id: projectId as string }, select: { id: true, customerId: true } }),
  ]);
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  // Check duplicate first — before any mutation
  const existing = await prisma.orderProjectLink.findUnique({
    where: { orderId_projectId: { orderId, projectId: projectId as string } },
  });
  if (existing) return NextResponse.json({ error: "Link already exists" }, { status: 409 });

  // Use shared helper for customer conflict check + CRM sync + link creation
  let link: Awaited<ReturnType<typeof prisma.orderProjectLink.create>>;
  try {
    link = await prisma.$transaction(async (tx) => {
      const linkResult = await linkOrderToProject(
        tx, orderId, projectId as string, session.user.id,
        {
          treatment: (treatment as string) || undefined,
          allocatedAmount: allocatedAmount != null ? Number(allocatedAmount) : undefined,
          isPrimary: isPrimary === true ? true : undefined,
          note: (note as string)?.trim() || undefined,
        },
        order.customerId,
      );
      if (linkResult.orderUpdateData) {
        await tx.order.update({
          where: { id: orderId },
          data: linkResult.orderUpdateData,
        });
      }
      return linkResult.link;
    });
  } catch (e) {
    if (e instanceof OrderProjectCustomerConflictError) {
      return NextResponse.json({
        error: "订单客户与项目客户不一致",
        orderCustomerId: e.orderCustomerId,
        projectCustomerId: e.projectCustomerId,
      }, { status: 409 });
    }
    throw e;
  }

  return NextResponse.json({ link }, { status: 201 });
}
