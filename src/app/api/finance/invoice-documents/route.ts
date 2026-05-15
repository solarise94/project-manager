import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { assertOrderInvoiceReadable } from "@/lib/finance/order-invoice-access";
import fs from "fs/promises";
import path from "path";

const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/tiff",
]);

const ALLOWED_EXTENSIONS = new Set([".pdf", ".jpg", ".jpeg", ".png", ".webp", ".tiff", ".tif"]);

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

async function checkInvoiceAccess(
  userId: string,
  role: string,
  projectInvoiceId: string | null,
  externalOrderInvoiceRequestId: string | null,
): Promise<boolean> {
  if (role === "ADMIN") return true;

  const [custScope, projScope] = await Promise.all([
    getFinanceCustomerScopeWhere(userId, role),
    getFinanceProjectScopeWhere(userId, role),
  ]);

  if (projectInvoiceId) {
    const inv = await prisma.projectInvoice.findUnique({
      where: { id: projectInvoiceId },
      select: { project: { select: { customerId: true, id: true } } },
    });
    if (!inv) return false;
    if (projScope && !projScope.id.in.includes(inv.project.id)) return false;
    if (custScope && inv.project.customerId && !custScope.id.in.includes(inv.project.customerId)) return false;
    return true;
  }

  if (externalOrderInvoiceRequestId) {
    try {
      await assertOrderInvoiceReadable(externalOrderInvoiceRequestId, userId, role);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { searchParams } = req.nextUrl;
  const projectInvoiceId = searchParams.get("projectInvoiceId");
  const externalOrderInvoiceRequestId = searchParams.get("externalOrderInvoiceRequestId");

  // Require at least one filter to prevent full enumeration
  if (!projectInvoiceId && !externalOrderInvoiceRequestId) {
    return NextResponse.json({ error: "必须指定 projectInvoiceId 或 externalOrderInvoiceRequestId" }, { status: 400 });
  }

  // Verify access to the parent invoice
  const hasAccess = await checkInvoiceAccess(
    session.user.id, session.user.role, projectInvoiceId, externalOrderInvoiceRequestId,
  );
  if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const where: Record<string, unknown> = {};
  if (projectInvoiceId) where.projectInvoiceId = projectInvoiceId;
  if (externalOrderInvoiceRequestId) where.externalOrderInvoiceRequestId = externalOrderInvoiceRequestId;

  const documents = await prisma.invoiceDocument.findMany({
    where,
    include: { uploadedBy: { select: { id: true, name: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ documents });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN" && session.user.role !== "USER") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const form = await req.formData();
  const file = form.get("file") as File | null;
  const projectInvoiceId = (form.get("projectInvoiceId") as string)?.trim() || null;
  const externalOrderInvoiceRequestId = (form.get("externalOrderInvoiceRequestId") as string)?.trim() || null;
  const actualInvoiceNo = (form.get("actualInvoiceNo") as string)?.trim() || null;
  const actualIssuedAt = (form.get("actualIssuedAt") as string)?.trim() || null;

  if (!file) return NextResponse.json({ error: "缺少文件" }, { status: 400 });
  if (projectInvoiceId) {
    return NextResponse.json({ error: "项目发票已停用上传，请使用订单发票" }, { status: 410 });
  }
  if (!externalOrderInvoiceRequestId) {
    return NextResponse.json({ error: "缺少发票 ID" }, { status: 400 });
  }

  // File validation
  if (file.size === 0) return NextResponse.json({ error: "文件为空" }, { status: 400 });
  if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: "文件大小不能超过 20 MB" }, { status: 400 });

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: `不支持的文件类型: ${ext}` }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.has(file.type) && file.type !== "") {
    return NextResponse.json({ error: `不支持的 MIME 类型: ${file.type}` }, { status: 400 });
  }

  // Scope check
  const hasAccess = await checkInvoiceAccess(
    session.user.id, session.user.role, projectInvoiceId, externalOrderInvoiceRequestId,
  );
  if (!hasAccess) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Status gate: only REQUESTED (or ISSUED without documents) can accept uploads
  let invoiceStatus: string | null = null;
  if (externalOrderInvoiceRequestId) {
    const invoice = await prisma.externalOrderInvoiceRequest.findUnique({
      where: { id: externalOrderInvoiceRequestId },
      select: {
        status: true,
        adjustmentsAsOriginal: { select: { kind: true } },
        _count: { select: { documents: true } },
      },
    });
    if (!invoice) return NextResponse.json({ error: "发票不存在" }, { status: 404 });
    invoiceStatus = invoice.status;
    if (invoice.status === "DRAFT") {
      return NextResponse.json({ error: "草稿状态的发票不能登记已开票，请先提交" }, { status: 400 });
    }
    if (invoice.status === "CANCELLED") {
      return NextResponse.json({ error: "已取消的发票不能登记已开票" }, { status: 400 });
    }
    if (invoice.adjustmentsAsOriginal.some((a) => a.kind === "RED")) {
      return NextResponse.json({ error: "已冲红的发票不能登记附件" }, { status: 400 });
    }
    if (invoice.status === "ISSUED" && invoice._count.documents > 0) {
      return NextResponse.json({ error: "该发票已登记过附件" }, { status: 400 });
    }
    if (invoice.status !== "REQUESTED" && invoice.status !== "ISSUED") {
      return NextResponse.json({ error: "只有待开票状态的发票才能登记已开票" }, { status: 400 });
    }
  }

  const invoiceId = projectInvoiceId || externalOrderInvoiceRequestId!;
  const invoiceType = projectInvoiceId ? "project" : "order";
  const uploadDir = path.join(process.cwd(), "public/uploads/invoices", invoiceType, invoiceId);
  await fs.mkdir(uploadDir, { recursive: true });

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fileName = `${timestamp}_${safeName}`;
  const filePath = path.join(uploadDir, fileName);

  const buf = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filePath, buf);

  const fileUrl = `/uploads/invoices/${invoiceType}/${invoiceId}/${fileName}`;

  const doc = await prisma.invoiceDocument.create({
    data: {
      projectInvoiceId,
      externalOrderInvoiceRequestId,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
      uploadedById: session.user.id,
    },
  });

  // Update parent invoice: always auto-advance REQUESTED → ISSUED on first upload
  const updateData: Record<string, unknown> = {};
  if (actualInvoiceNo) updateData.actualInvoiceNo = actualInvoiceNo;
  if (actualIssuedAt) updateData.actualIssuedAt = new Date(actualIssuedAt);

  if (externalOrderInvoiceRequestId) {
    if (invoiceStatus === "REQUESTED") updateData.status = "ISSUED";
    if (Object.keys(updateData).length > 0) {
      await prisma.externalOrderInvoiceRequest.update({ where: { id: externalOrderInvoiceRequestId }, data: updateData });
    }
  }

  return NextResponse.json({ document: doc }, { status: 201 });
}
