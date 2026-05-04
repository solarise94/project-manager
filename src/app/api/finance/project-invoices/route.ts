import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFinanceBlocked, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const search = url.searchParams.get("search") || "";
  const status = url.searchParams.get("status") || "";
  const projectId = url.searchParams.get("projectId") || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10) || 20));

  const projectScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);

  const where: Record<string, unknown> = {};
  if (projectScope) {
    if (projectId) {
      if (!projectScope.id.in.includes(projectId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      where.projectId = projectId;
    } else {
      where.projectId = projectScope.id;
    }
  } else if (projectId) {
    where.projectId = projectId;
  }
  if (status) where.status = status;

  const searchWhere = search ? {
    OR: [
      { buyerOrganizationName: { contains: search } },
      { project: { name: { contains: search } } },
      { project: { cust: { name: { contains: search } } } },
      { contactName: { contains: search } },
    ],
  } : {};

  const finalWhere = { ...where, ...searchWhere };

  const [invoices, total] = await Promise.all([
    prisma.projectInvoice.findMany({
      where: finalWhere,
      include: {
        items: { orderBy: { sortOrder: "asc" } },
        createdBy: { select: { id: true, name: true } },
        project: {
          select: { id: true, name: true, cust: { select: { id: true, name: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.projectInvoice.count({ where: finalWhere }),
  ]);

  return NextResponse.json({ invoices, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}
