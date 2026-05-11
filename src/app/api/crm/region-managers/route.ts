import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const managers = await prisma.crmRegionManager.findMany({
    include: {
      user: { select: { id: true, name: true, email: true } },
      region: { select: { id: true, name: true } },
      reps: { include: { representative: { select: { id: true, name: true, email: true } } } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ managers });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = await req.json();
  const { userId, regionId, repIds } = body;

  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  // Validate regionId if provided
  if (regionId) {
    const region = await prisma.representativeRegion.findFirst({
      where: { id: regionId, archived: false },
    });
    if (!region) return NextResponse.json({ error: "指定地区不存在或已归档" }, { status: 400 });
  }

  const existing = await prisma.crmRegionManager.findUnique({ where: { userId } });
  if (existing) return NextResponse.json({ error: "该用户已是地区经理" }, { status: 409 });

  const manager = await prisma.$transaction(async (tx) => {
    // Set the user's role to REGIONAL_MANAGER if not already
    if (user.role !== "ADMIN") {
      await tx.user.update({ where: { id: userId }, data: { role: "REGIONAL_MANAGER" } });
    }

    const created = await tx.crmRegionManager.create({
      data: {
        userId,
        regionId: regionId || null,
        reps: repIds?.length
          ? { create: repIds.map((repId: string) => ({ representativeId: repId })) }
          : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        region: { select: { id: true, name: true } },
        reps: { include: { representative: { select: { id: true, name: true, email: true } } } },
      },
    });

    return created;
  });

  return NextResponse.json({ manager }, { status: 201 });
}
