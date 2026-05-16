import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canReadFinanceAdvance, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { getOrderScopeWhere } from "@/lib/orders/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canReadFinanceAdvance(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const advance = await prisma.financeAdvance.findUnique({
    where: { id },
    include: {
      customer: { select: { id: true, name: true } },
      order: { select: { id: true, orderNo: true } },
      project: { select: { id: true, name: true } },
      refunds: { orderBy: { createdAt: "desc" } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  if (!advance) return NextResponse.json({ error: "垫付记录不存在" }, { status: 404 });

  if (session.user.role !== "ADMIN") {
    const orderScope = await getOrderScopeWhere(session.user.id, session.user.role);
    let orderOk = false;
    if (advance.orderId && orderScope) {
      const inScope = await prisma.order.count({
        where: { id: advance.orderId, deleted: false, AND: [orderScope] },
      });
      orderOk = inScope > 0;
    }

    if (session.user.role === "REPRESENTATIVE") {
      if (!orderOk) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    } else {
      const [custScope, projScope] = await Promise.all([
        getFinanceCustomerScopeWhere(session.user.id, session.user.role),
        getFinanceProjectScopeWhere(session.user.id, session.user.role),
      ]);
      const custOk = !custScope || (advance.customerId && custScope.id.in.includes(advance.customerId));
      const projOk = !projScope || (advance.projectId && projScope.id.in.includes(advance.projectId));
      if (!custOk && !projOk && !orderOk) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  return NextResponse.json({ advance });
}
