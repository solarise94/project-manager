import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { computeProjectReceivable } from "@/lib/finance/types";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const url = req.nextUrl;
  const type = url.searchParams.get("type") || "issued_unpaid";
  const search = url.searchParams.get("search")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const projectWhere: Record<string, unknown> = { deleted: false };
  if (session.user.role !== "ADMIN") {
    const projScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
    if (projScope) projectWhere.id = projScope.id;
  }
  if (search) {
    projectWhere.OR = [
      { name: { contains: search } },
      { cust: { name: { contains: search } } },
    ];
  }

  const allProjects = await prisma.project.findMany({
    where: projectWhere,
    select: {
      id: true, name: true, budgetAmount: true, projectType: true, status: true, progress: true,
      cust: { select: { id: true, name: true } },
      invoices: {
        where: { status: { not: "CANCELLED" } },
        select: { id: true, totalAmount: true, status: true, createdAt: true },
      },
      receipts: { where: { deleted: false }, select: { id: true, amount: true, projectInvoiceId: true } },
    },
  });

  const items: Array<Record<string, unknown>> = [];

  for (const proj of allProjects) {
    const invoicedAmount = proj.invoices.reduce((s, i) => s + i.totalAmount, 0);
    const issuedInvoices = proj.invoices.filter((i) => i.status === "ISSUED");
    const receivable = computeProjectReceivable(proj);

    if (type === "issued_unpaid") {
      // Find invoices where received amount < invoice amount
      for (const inv of issuedInvoices) {
        const invReceived = proj.receipts
          .filter((r) => r.projectInvoiceId === inv.id)
          .reduce((s, r) => s + r.amount, 0);
        if (invReceived < inv.totalAmount) {
          items.push({
            type: "issued_unpaid",
            projectId: proj.id, projectName: proj.name,
            customerId: proj.cust?.id, customerName: proj.cust?.name || "",
            invoiceId: inv.id, invoiceAmount: inv.totalAmount,
            receivedAmount: invReceived, unpaidAmount: inv.totalAmount - invReceived,
            invoiceDate: inv.createdAt.toISOString(),
            invoiceStatus: inv.status,
          });
        }
      }
    } else {
      // uninvoiced: receivable > invoiced
      if (receivable > invoicedAmount) {
        items.push({
          type: "uninvoiced",
          projectId: proj.id, projectName: proj.name,
          customerId: proj.cust?.id, customerName: proj.cust?.name || "",
          receivableAmount: receivable, invoicedAmount,
          uninvoicedAmount: receivable - invoicedAmount,
          progress: proj.progress, status: proj.status,
        });
      }
    }
  }

  const total = items.length;
  const paged = items.slice((page - 1) * pageSize, page * pageSize);

  return NextResponse.json({
    items: paged, total, page, pageSize, totalPages: Math.ceil(total / pageSize),
  });
}
