import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Real-time role check
  const currentUser = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!currentUser || currentUser.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sourceId } = await params;

  try {
    const body = await req.json();
    const { targetId } = body;

    if (!targetId || targetId === sourceId) {
      return NextResponse.json({ error: "目标机构无效" }, { status: 400 });
    }

    const [source, target] = await Promise.all([
      prisma.organization.findUnique({ where: { id: sourceId }, include: { aliases: true, sites: true } }),
      prisma.organization.findUnique({ where: { id: targetId }, include: { sites: true } }),
    ]);

    if (!source || source.deleted) return NextResponse.json({ error: "源机构不存在" }, { status: 404 });
    if (!target || target.deleted) return NextResponse.json({ error: "目标机构不存在" }, { status: 404 });

    // Build map of target's site normalized names -> {id, archived} for dedup + rebind
    const targetSiteMap = new Map(target.sites.map((s) => [s.normalizedSiteName, { id: s.id, archived: s.archived }]));

    await prisma.$transaction(async (tx) => {
      // Move customers from source to target
      await tx.customer.updateMany({
        where: { organizationId: sourceId },
        data: { organizationId: targetId, organization: target.canonicalName },
      });

      // Move aliases to target (add source canonical name as alias too)
      for (const alias of source.aliases) {
        await tx.organizationAlias.update({
          where: { id: alias.id },
          data: { organizationId: targetId },
        });
      }
      // Add source's canonical name as alias on target
      await tx.organizationAlias.create({
        data: {
          organizationId: targetId,
          alias: source.canonicalName,
          normalizedAlias: source.normalizedName,
          aliasType: "FORMER_NAME",
        },
      });

      // Move sites to target, handle duplicates and rebind customers
      for (const site of source.sites) {
        const targetSite = targetSiteMap.get(site.normalizedSiteName);
        if (targetSite) {
          // Collision — un-archive target site if needed, rebind customers, archive source site
          if (targetSite.archived) {
            await tx.organizationSite.update({
              where: { id: targetSite.id },
              data: { archived: false },
            });
          }
          await tx.customer.updateMany({
            where: { organizationSiteId: site.id },
            data: { organizationSiteId: targetSite.id },
          });
          await tx.organizationSite.update({
            where: { id: site.id },
            data: { archived: true },
          });
        } else {
          await tx.organizationSite.update({
            where: { id: site.id },
            data: { organizationId: targetId },
          });
          targetSiteMap.set(site.normalizedSiteName, { id: site.id, archived: false });
        }
      }

      // Soft-delete source
      await tx.organization.update({
        where: { id: sourceId },
        data: { deleted: true },
      });
    });

    return NextResponse.json({ merged: true, targetId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "合并机构失败" }, { status: 500 });
  }
}
