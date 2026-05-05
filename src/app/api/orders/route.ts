import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isOrderAccessBlocked, getOrderScopeWhere } from "@/lib/orders/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isOrderAccessBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const search = url.searchParams.get("search")?.trim() || "";
  const source = url.searchParams.get("source")?.trim() || "";
  const status = url.searchParams.get("status")?.trim() || "";
  const deliveryStatus = url.searchParams.get("deliveryStatus")?.trim() || "";
  const category = url.searchParams.get("category")?.trim() || "";
  const customerMatchStatus = url.searchParams.get("customerMatchStatus")?.trim() || "";
  const financeTreatment = url.searchParams.get("financeTreatment")?.trim() || "";
  const customerId = url.searchParams.get("customerId")?.trim() || "";
  const projectId = url.searchParams.get("projectId")?.trim() || "";
  const representativeId = url.searchParams.get("representativeId")?.trim() || "";
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));

  const scopeWhere = await getOrderScopeWhere(session.user.id, session.user.role);

  const andConditions: Record<string, unknown>[] = [];

  if (scopeWhere) andConditions.push(scopeWhere);

  if (search) {
    andConditions.push({
      OR: [
        { orderNo: { contains: search } },
        { externalOrderNo: { contains: search } },
        { title: { contains: search } },
        { buyerNameSnapshot: { contains: search } },
        { buyerPhoneSnapshot: { contains: search } },
        { buyerOrgNameSnapshot: { contains: search } },
        { buyerAddressSnapshot: { contains: search } },
      ],
    });
  }

  const filters: Record<string, unknown> = {};
  if (source) filters.source = source;
  if (status) filters.status = status;
  if (deliveryStatus) filters.deliveryStatus = deliveryStatus;
  if (category) filters.category = category;
  if (customerMatchStatus) filters.customerMatchStatus = customerMatchStatus;
  if (financeTreatment) filters.financeTreatment = financeTreatment;
  if (customerId) filters.customerId = customerId;
  if (representativeId) filters.representativeId = representativeId;
  if (Object.keys(filters).length > 0) andConditions.push(filters);

  if (projectId) andConditions.push({ projectLinks: { some: { projectId } } });

  andConditions.push({ deleted: false });

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: [{ orderedAt: "desc" }, { createdAt: "desc" }],
      skip: (page - 1) * pageSize, take: pageSize,
      select: {
        id: true, orderNo: true, source: true, sourcePlatform: true, externalOrderNo: true,
        title: true, category: true, status: true, deliveryStatus: true,
        orderedAt: true, confirmedAt: true,
        customerId: true, customer: { select: { id: true, name: true, customerCode: true } },
        buyerNameSnapshot: true, buyerPhoneSnapshot: true, buyerOrgNameSnapshot: true, buyerAddressSnapshot: true,
        customerMatchStatus: true, customerMatchScore: true, customerMatchReason: true,
        totalAmount: true, financeAmountOverride: true, financeTreatment: true, financeNote: true,
        ownerUserId: true, representativeId: true,
        representative: { select: { id: true, name: true } },
        createdById: true, createdAt: true, updatedAt: true,
        projectLinks: { select: { id: true, treatment: true, allocatedAmount: true, isPrimary: true, project: { select: { id: true, name: true } } } },
        _count: { select: { lines: true, receipts: true } },
      },
    }),
    prisma.order.count({ where }),
  ]);

  return NextResponse.json({ orders, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const {
    title, description, category, status, orderedAt,
    customerId, representativeId, lines, totalAmount,
    projectAction, projectId, financeTreatment, financeNote,
  } = body as Record<string, unknown>;

  if (!title || typeof title !== "string" || !title.trim()) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  const orderCategory = (typeof category === "string" && category) ? category : "SERVICE";
  const orderStatus = (typeof status === "string" && status) ? status : "DRAFT";

  // Generate orderNo
  const today = new Date();
  const prefix = "SO";
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const lastOrder = await prisma.order.findFirst({
    where: { orderNo: { startsWith: `${prefix}-${dateStr}` } },
    orderBy: { orderNo: "desc" },
    select: { orderNo: true },
  });
  let seq = 1;
  if (lastOrder) {
    const parts = lastOrder.orderNo.split("-");
    seq = parseInt(parts[parts.length - 1] || "0", 10) + 1;
  }
  const orderNo = `${prefix}-${dateStr}-${String(seq).padStart(4, "0")}`;

  const lineItems = Array.isArray(lines) ? lines.filter((l: Record<string, unknown>) => l.itemName?.toString().trim()) : [];
  const computedAmount = lineItems.length > 0
    ? lineItems.reduce((s: number, l: Record<string, unknown>) => s + (Number(l.amount) || 0), 0)
    : (Number(totalAmount) || 0);

  const order = await prisma.order.create({
    data: {
      orderNo,
      source: "MANUAL",
      title: title.trim(),
      description: (description as string)?.trim() || null,
      category: orderCategory,
      status: orderStatus,
      orderedAt: orderedAt ? new Date(orderedAt as string) : new Date(),
      confirmedAt: orderStatus === "CONFIRMED" ? new Date() : null,
      customerId: (customerId as string) || null,
      representativeId: (representativeId as string) || null,
      totalAmount: computedAmount,
      financeTreatment: (financeTreatment as string) || "AUTO",
      financeNote: (financeNote as string)?.trim() || null,
      createdById: session.user.id,
      lines: lineItems.length > 0 ? {
        create: lineItems.map((l: Record<string, unknown>, i: number) => ({
          itemName: String(l.itemName).trim(),
          spec: l.spec?.toString().trim() || null,
          unit: l.unit?.toString().trim() || null,
          quantity: l.quantity != null ? Number(l.quantity) : null,
          unitPrice: l.unitPrice != null ? Number(l.unitPrice) : null,
          amount: Number(l.amount) || 0,
          category: orderCategory,
          sortOrder: i,
        })),
      } : undefined,
    },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      customer: { select: { id: true, name: true } },
    },
  });

  // Handle project generation
  if (projectAction === "GENERATE" && customerId) {
    const project = await prisma.project.create({
      data: {
        name: title.trim(),
        customerId: customerId as string,
        representativeId: (representativeId as string) || null,
        budgetAmount: computedAmount,
        status: "NOT_STARTED",
      },
    });
    await prisma.orderProjectLink.create({
      data: {
        orderId: order.id,
        projectId: project.id,
        relationType: "GENERATED",
        treatment: "PROJECT_INCLUDED",
        isPrimary: true,
        createdById: session.user.id,
      },
    });
  } else if (projectAction === "LINK" && projectId) {
    await prisma.orderProjectLink.create({
      data: {
        orderId: order.id,
        projectId: projectId as string,
        relationType: "LINKED",
        treatment: "PROJECT_INCLUDED",
        isPrimary: true,
        createdById: session.user.id,
      },
    });
  }

  return NextResponse.json({ order }, { status: 201 });
}
