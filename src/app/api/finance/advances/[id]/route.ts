import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

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
    const [custScope, projScope] = await Promise.all([
      getFinanceCustomerScopeWhere(session.user.id, session.user.role),
      getFinanceProjectScopeWhere(session.user.id, session.user.role),
    ]);
    const custOk = !custScope || (advance.customerId && custScope.id.in.includes(advance.customerId));
    const projOk = !projScope || (advance.projectId && projScope.id.in.includes(advance.projectId));
    if (!custOk && !projOk) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ advance });
}
