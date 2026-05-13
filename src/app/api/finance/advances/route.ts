import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";

async function resolveAndValidateAdvance(
  userId: string,
  role: string,
  customerId?: string | null,
  orderId?: string | null,
  projectId?: string | null,
): Promise<{ valid: boolean; resolvedCustomerId: string | null; resolvedProjectId: string | null }> {
  let resolvedCustId = customerId || null;
  let resolvedProjId = projectId || null;

  // Resolve from order
  if (orderId) {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { customerId: true, projectLinks: { select: { projectId: true } } },
    });
    if (!order) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (!resolvedCustId && order.customerId) resolvedCustId = order.customerId;
    if (!resolvedProjId && order.projectLinks.length > 0) resolvedProjId = order.projectLinks[0].projectId;
    if (customerId && order.customerId && order.customerId !== customerId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (projectId && order.projectLinks.length > 0) {
      if (!order.projectLinks.some((l) => l.projectId === projectId)) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    }
  }

  // Resolve from project
  if (projectId) {
    const proj = await prisma.project.findUnique({
      where: { id: projectId },
      select: { customerId: true },
    });
    if (!proj) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    if (!resolvedCustId && proj.customerId) resolvedCustId = proj.customerId;
    if (!resolvedProjId) resolvedProjId = projectId;
    if (customerId && proj.customerId && proj.customerId !== customerId) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  }

  // Cross-validate
  if (resolvedCustId && resolvedProjId) {
    const proj = await prisma.project.findUnique({
      where: { id: resolvedProjId },
      select: { customerId: true },
    });
    if (proj?.customerId && proj.customerId !== resolvedCustId) {
      return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
    }
  }

  if (role === "ADMIN") return { valid: true, resolvedCustomerId: resolvedCustId, resolvedProjectId: resolvedProjId };

  const [custScope, projScope] = await Promise.all([
    getFinanceCustomerScopeWhere(userId, role),
    getFinanceProjectScopeWhere(userId, role),
  ]);

  if (resolvedCustId && custScope && !custScope.id.in.includes(resolvedCustId)) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  if (resolvedProjId && projScope && !projScope.id.in.includes(resolvedProjId)) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };
  if (!resolvedCustId && !resolvedProjId && custScope) return { valid: false, resolvedCustomerId: null, resolvedProjectId: null };

  return { valid: true, resolvedCustomerId: resolvedCustId, resolvedProjectId: resolvedProjId };
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    // Sales roles (REPRESENTATIVE / REGIONAL_MANAGER) can read advances
    // for orders they can access, but cannot write.
    if (session.user.role !== "REPRESENTATIVE" && session.user.role !== "REGIONAL_MANAGER") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const { searchParams } = req.nextUrl;
  const customerId = searchParams.get("customerId");
  const orderId = searchParams.get("orderId");
  const projectId = searchParams.get("projectId");
  const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20")));

  const where: Record<string, unknown> = {};
  if (customerId) where.customerId = customerId;
  if (orderId) where.orderId = orderId;
  if (projectId) where.projectId = projectId;

  if (session.user.role !== "ADMIN") {
    const isSales = session.user.role === "REPRESENTATIVE" || session.user.role === "REGIONAL_MANAGER";

    if (isSales) {
      // Sales roles: only orderId filter is supported
      if (!orderId) {
        return NextResponse.json({ error: "请通过订单筛选" }, { status: 400 });
      }
      if (customerId || projectId) {
        return NextResponse.json({ error: "只能通过订单筛选" }, { status: 400 });
      }

      const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);
      if (!orderScope) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      const inScope = await prisma.order.count({
        where: { id: orderId, AND: [orderScope] },
      });
      if (inScope === 0) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      where.orderId = orderId;
    } else {
      // USER role: standard finance scope
      const orConditions: Record<string, unknown>[] = [];
      const [custScope, projScope] = await Promise.all([
        getFinanceCustomerScopeWhere(session.user.id, session.user.role),
        getFinanceProjectScopeWhere(session.user.id, session.user.role),
      ]);
      if (custScope) orConditions.push({ customerId: { in: custScope.id.in } });
      if (projScope) orConditions.push({ projectId: { in: projScope.id.in } });
      if (orConditions.length > 0) {
        where.OR = orConditions;
      } else {
        return NextResponse.json({ advances: [], total: 0, page, pageSize });
      }
    }
  }

  const [advances, total] = await Promise.all([
    prisma.financeAdvance.findMany({
      where,
      include: {
        customer: { select: { id: true, name: true } },
        order: { select: { id: true, orderNo: true } },
        project: { select: { id: true, name: true } },
        refunds: { select: { id: true, amount: true, refundedAt: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.financeAdvance.count({ where }),
  ]);

  return NextResponse.json({ advances, total, page, pageSize });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { customerId, orderId, projectId, amount, advancedAt, remark } = body;

  if (!amount || typeof amount !== "number" || amount <= 0) {
    return NextResponse.json({ error: "金额必须大于 0" }, { status: 400 });
  }

  const { valid, resolvedCustomerId, resolvedProjectId } = await resolveAndValidateAdvance(
    session.user.id, session.user.role, customerId, orderId, projectId,
  );
  if (!valid) return NextResponse.json({ error: "实体引用不一致或权限不足" }, { status: 400 });

  const advance = await prisma.financeAdvance.create({
    data: {
      customerId: resolvedCustomerId,
      orderId: orderId || null,
      projectId: resolvedProjectId,
      amount,
      advancedAt: advancedAt ? new Date(advancedAt) : new Date(),
      remark: remark?.trim() || null,
      createdById: session.user.id,
    },
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      refunds: true,
    },
  });

  return NextResponse.json({ advance }, { status: 201 });
}
