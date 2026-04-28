import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id, deleted: false },
    select: {
      id: true, name: true, customerCode: true, organization: true,
      organizationId: true, organizationSiteId: true, email: true,
      wechat: true, address: true, principal: true, miniProgramId: true,
      org: { select: { canonicalName: true } },
    },
  });

  if (!customer) {
    return NextResponse.json({ error: "客户不存在" }, { status: 404 });
  }

  const { org, ...rest } = customer;
  return NextResponse.json({ customer: { ...rest, organization: getCustomerOrganizationName({ organization: rest.organization, org }) } });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing || existing.deleted) {
      return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    }

    const body = await req.json();
    const { name, principal, email, wechat, organization, address, miniProgramId, archived, organizationId, organizationSiteId, organizationRawInput } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) {
      if (!name.trim()) {
        return NextResponse.json({ error: "客户姓名不能为空" }, { status: 400 });
      }
      data.name = name.trim();
    }
    if (principal !== undefined) data.principal = principal?.trim() || null;
    if (email !== undefined) data.email = email?.trim() || null;
    if (wechat !== undefined) data.wechat = wechat?.trim() || null;
    if (organization !== undefined) data.organization = organization?.trim() || null;
    if (address !== undefined) data.address = address?.trim() || null;
    if (miniProgramId !== undefined) data.miniProgramId = miniProgramId?.trim() || null;
    if (organizationId !== undefined) data.organizationId = organizationId || null;
    if (organizationSiteId !== undefined) data.organizationSiteId = organizationSiteId || null;
    if (organizationRawInput !== undefined) data.organizationRawInput = organizationRawInput || null;

    // Validate organizationId exists and is active
    const effectiveOrgId = (organizationId !== undefined ? organizationId : existing.organizationId) || null;
    if (effectiveOrgId && organizationId !== undefined && organizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: effectiveOrgId },
        select: { id: true, canonicalName: true, deleted: true, archived: true },
      });
      if (!org || org.deleted) {
        return NextResponse.json({ error: "指定的单位不存在" }, { status: 400 });
      }
      if (org.archived) {
        return NextResponse.json({ error: "指定的单位已归档，无法关联" }, { status: 400 });
      }
      // Server-side sync: always use canonical name as organization text
      data.organization = org.canonicalName;
    }

    // When explicitly clearing organizationId, also clear organization text
    if (organizationId !== undefined && !organizationId) {
      data.organization = null;
    }

    // Auto-clear siteId when orgId is absent (prevent orphaned FK)
    if (!effectiveOrgId) {
      data.organizationSiteId = null;
    }

    // Validate organizationSiteId belongs to organizationId
    const effectiveSiteId = !effectiveOrgId ? null : (organizationSiteId !== undefined ? organizationSiteId : existing.organizationSiteId) || null;
    if (effectiveSiteId && effectiveOrgId) {
      const site = await prisma.organizationSite.findUnique({ where: { id: effectiveSiteId }, select: { organizationId: true } });
      if (!site || site.organizationId !== effectiveOrgId) {
        return NextResponse.json({ error: "院区不属于指定机构" }, { status: 400 });
      }
    }

    if (archived !== undefined) {
      data.archived = archived;
      data.archivedAt = archived ? new Date() : null;
    }

    const updated = await prisma.customer.update({ where: { id }, data });

    // Sync project client snapshot when name changes (organization is independently editable per project)
    if (name !== undefined && name.trim() !== existing.name) {
      await prisma.project.updateMany({
        where: { customerId: id },
        data: { client: name.trim() },
      });
    }

    return NextResponse.json({ customer: updated });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "更新客户失败" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const existing = await prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { projects: true } } },
    });
    if (!existing || existing.deleted) {
      return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    }

    if (existing._count.projects > 0) {
      return NextResponse.json(
        { error: "该客户仍关联项目，请先归档或合并" },
        { status: 400 },
      );
    }

    const deleted = await prisma.customer.update({
      where: { id },
      data: { deleted: true, deletedAt: new Date() },
    });

    return NextResponse.json({ customer: deleted });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "删除客户失败" }, { status: 500 });
  }
}
