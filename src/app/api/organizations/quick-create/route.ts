import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { normalizeOrgName } from "@/lib/organization-normalize";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { canonicalName, address } = body;

    if (!canonicalName?.trim()) {
      return NextResponse.json({ error: "单位名称不能为空" }, { status: 400 });
    }

    const trimmedName = canonicalName.trim();
    const normalizedName = normalizeOrgName(trimmedName);

    // Dedup: check normalizedName AND approved aliases (both normalized)
    const existing = await prisma.organization.findFirst({
      where: {
        deleted: false,
        OR: [
          { normalizedName },
          { aliases: { some: { normalizedAlias: normalizedName, approved: true } } },
        ],
      },
      orderBy: [{ archived: "asc" }, { createdAt: "asc" }],
      select: { id: true, orgCode: true, canonicalName: true, address: true, archived: true },
    });

    if (existing) {
      if (existing.archived) {
        return NextResponse.json(
          { error: `同名单位 "${existing.canonicalName}" 已归档，请联系管理员恢复` },
          { status: 400 },
        );
      }
      return NextResponse.json({
        organization: { id: existing.id, orgCode: existing.orgCode, canonicalName: existing.canonicalName, address: existing.address },
        created: false,
      });
    }

    // Generate org code
    const count = await prisma.organization.count();
    let orgCode = "";
    for (let i = 0; i < 10; i++) {
      const code = `ORG-${String(count + 1 + i).padStart(5, "0")}`;
      const exists = await prisma.organization.findUnique({ where: { orgCode: code }, select: { id: true } });
      if (!exists) { orgCode = code; break; }
    }
    if (!orgCode) orgCode = `ORG-${String(Date.now() % 100000).padStart(5, "0")}`;

    const organization = await prisma.organization.create({
      data: {
        orgCode,
        canonicalName: trimmedName,
        normalizedName,
        address: address?.trim() || null,
      },
      select: { id: true, orgCode: true, canonicalName: true, address: true },
    });

    return NextResponse.json({ organization, created: true }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "创建单位失败" }, { status: 500 });
  }
}
