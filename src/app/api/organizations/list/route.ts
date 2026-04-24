import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search")?.trim() || "";

  const where: Prisma.OrganizationWhereInput = {
    deleted: false,
    archived: false,
  };

  if (search) {
    where.OR = [
      { canonicalName: { contains: search } },
      { orgCode: { contains: search } },
      { aliases: { some: { alias: { contains: search } } } },
    ];
  }

  const organizations = await prisma.organization.findMany({
    where,
    select: {
      id: true,
      orgCode: true,
      canonicalName: true,
      address: true,
    },
    orderBy: { canonicalName: "asc" },
    take: 50,
  });

  return NextResponse.json({ organizations });
}
