import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import fs from "fs/promises";
import path from "path";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const doc = await prisma.invoiceDocument.findUnique({ where: { id } });
  if (!doc) return NextResponse.json({ error: "文件不存在" }, { status: 404 });

  const filePath = path.join(process.cwd(), "public", doc.fileUrl);
  try { await fs.unlink(filePath); } catch { /* file may already be gone */ }

  await prisma.invoiceDocument.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
