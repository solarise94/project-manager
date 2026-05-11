import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ siteId: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { siteId } = await params;

  const site = await prisma.organizationSite.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      siteName: true,
      siteType: true,
      organizationId: true,
      organization: { select: { canonicalName: true } },
    },
  });

  if (!site) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    site: {
      id: site.id,
      siteName: site.siteName,
      siteType: site.siteType,
      organizationId: site.organizationId,
      organizationName: site.organization.canonicalName,
    },
  });
}
