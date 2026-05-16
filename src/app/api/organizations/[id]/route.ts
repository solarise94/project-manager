import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { normalizeOrgName } from "@/lib/organization-normalize";
import { isRepresentative } from "@/lib/permissions";

async function assertAdmin(session: { user: { id: string; role: string } } | null) {
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { role: true } });
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const org = await prisma.organization.findUnique({
    where: { id },
    select: { id: true, orgCode: true, canonicalName: true, address: true, taxId: true, sites: { select: { id: true, siteName: true, siteType: true }, where: { archived: false }, orderBy: { siteName: "asc" } } },
  });
  if (!org) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({
      organization: {
        id: org.id,
        canonicalName: org.canonicalName,
        address: org.address,
        sites: org.sites,
      },
    });
  }

  return NextResponse.json({ organization: org });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;

  try {
    const existing = await prisma.organization.findUnique({ where: { id } });
    if (!existing || existing.deleted) {
      return NextResponse.json({ error: "机构不存在" }, { status: 404 });
    }

    const body = await req.json();
    const { canonicalName, address, taxId, archived, addAlias, removeAliasId, addSite, removeSiteId } = body;

    const data: Record<string, unknown> = {};
    if (canonicalName !== undefined) {
      if (!canonicalName.trim()) {
        return NextResponse.json({ error: "标准名称不能为空" }, { status: 400 });
      }
      data.canonicalName = canonicalName.trim();
      data.normalizedName = normalizeOrgName(canonicalName.trim());
    }
    if (address !== undefined) data.address = address?.trim() || null;
    if (taxId !== undefined) data.taxId = taxId?.trim() || null;
    if (archived !== undefined) data.archived = archived;

    await prisma.organization.update({ where: { id }, data });

    // Add alias
    if (addAlias?.trim()) {
      await prisma.organizationAlias.create({
        data: {
          organizationId: id,
          alias: addAlias.trim(),
          normalizedAlias: normalizeOrgName(addAlias.trim()),
        },
      });
    }

    // Remove alias (verify it belongs to this organization)
    if (removeAliasId) {
      const alias = await prisma.organizationAlias.findUnique({ where: { id: removeAliasId } });
      if (!alias || alias.organizationId !== id) {
        return NextResponse.json({ error: "别名不属于该机构" }, { status: 400 });
      }
      await prisma.organizationAlias.delete({ where: { id: removeAliasId } });
    }

    // Add site
    if (addSite?.siteName?.trim()) {
      // Validate parentSiteId belongs to the same organization
      if (addSite.parentSiteId) {
        const parentSite = await prisma.organizationSite.findUnique({ where: { id: addSite.parentSiteId }, select: { organizationId: true } });
        if (!parentSite || parentSite.organizationId !== id) {
          return NextResponse.json({ error: "父级院区不属于同一单位" }, { status: 400 });
        }
      }
      const normalizedSiteName = normalizeOrgName(addSite.siteName.trim());
      const existingSite = await prisma.organizationSite.findFirst({
        where: { organizationId: id, normalizedSiteName },
      });
      if (existingSite && !existingSite.archived) {
        return NextResponse.json({ error: `已存在同名院区: ${existingSite.siteName}` }, { status: 409 });
      }
      if (existingSite && existingSite.archived) {
        // Un-archive the existing site
        await prisma.organizationSite.update({
          where: { id: existingSite.id },
          data: { archived: false, siteName: addSite.siteName.trim(), siteType: addSite.siteType || "CAMPUS", parentSiteId: addSite.parentSiteId || null, address: addSite.address?.trim() || null },
        });
      } else {
        await prisma.organizationSite.create({
          data: {
            organizationId: id,
            siteName: addSite.siteName.trim(),
            normalizedSiteName,
            siteType: addSite.siteType || "CAMPUS",
            parentSiteId: addSite.parentSiteId || null,
            address: addSite.address?.trim() || null,
          },
        });
      }
    }

    // Remove site (verify it belongs to this organization)
    if (removeSiteId) {
      const site = await prisma.organizationSite.findUnique({ where: { id: removeSiteId } });
      if (!site || site.organizationId !== id) {
        return NextResponse.json({ error: "院区不属于该机构" }, { status: 400 });
      }
      await prisma.organizationSite.update({
        where: { id: removeSiteId },
        data: { archived: true },
      });
    }

    // Re-fetch with relations
    const result = await prisma.organization.findUnique({
      where: { id },
      include: {
        aliases: true,
        sites: { where: { archived: false } },
        _count: { select: { customers: true } },
      },
    });

    return NextResponse.json({ organization: result });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "更新机构失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;

  try {
    const existing = await prisma.organization.findUnique({
      where: { id },
      include: { _count: { select: { customers: true } } },
    });
    if (!existing || existing.deleted) {
      return NextResponse.json({ error: "机构不存在" }, { status: 404 });
    }

    if (existing._count.customers > 0) {
      return NextResponse.json({ error: "该机构仍有关联客户，请先归档" }, { status: 400 });
    }

    await prisma.organization.update({
      where: { id },
      data: { deleted: true },
    });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "删除机构失败" }, { status: 500 });
  }
}
