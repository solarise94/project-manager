import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertCustomerEditable } from "@/lib/customers/permissions";
import { isRepresentative } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { validateOrg } from "@/lib/crm/customer-application-review";
import { syncEffectiveRepresentativeLinksForCustomer } from "@/lib/crm/customer-representative-sync";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const editable = await assertCustomerEditable(id, session.user.id, session.user.role);
  if (!editable.ok) {
    return NextResponse.json({ error: editable.message }, { status: editable.status });
  }

  const customer = await prisma.customer.findUnique({
    where: { id, deleted: false },
    select: {
      id: true, name: true, customerCode: true, organization: true,
      organizationId: true, organizationSiteId: true, organizationRawInput: true, email: true,
      wechat: true, address: true, principal: true, miniProgramId: true,
      labOrGroup: true,
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

  const { id } = await params;

  const editable = await assertCustomerEditable(id, session.user.id, session.user.role);
  if (!editable.ok) {
    return NextResponse.json({ error: editable.message }, { status: editable.status });
  }

  try {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing || existing.deleted) {
      return NextResponse.json({ error: "客户不存在" }, { status: 404 });
    }

    const body = await req.json();
    const { name, principal, email, wechat, organization, address, miniProgramId, archived, organizationId, organizationSiteId, organizationRawInput, labOrGroup } = body;

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
    if (labOrGroup !== undefined) data.labOrGroup = labOrGroup || null;

    const touchedOrganization =
      organization !== undefined ||
      organizationId !== undefined ||
      organizationSiteId !== undefined ||
      organizationRawInput !== undefined;

    if (touchedOrganization) {
      const rawOrgText = typeof organizationRawInput === "string"
        ? (organizationRawInput.trim() || (typeof organization === "string" ? organization.trim() : ""))
        : (typeof organization === "string" ? organization.trim() : "");
      const nextRawOrgText = rawOrgText || null;
      const requestedOrgId = organizationId !== undefined ? (organizationId || null) : existing.organizationId;
      const requestedSiteId = organizationSiteId !== undefined ? (organizationSiteId || null) : existing.organizationSiteId;

      if (!requestedOrgId && !nextRawOrgText) {
        data.organization = null;
        data.organizationId = null;
        data.organizationSiteId = null;
        data.organizationRawInput = null;
      } else {
        const orgValidation = await validateOrg(requestedOrgId, requestedSiteId, nextRawOrgText);
        if (orgValidation.error) {
          return NextResponse.json({ error: orgValidation.error }, { status: 400 });
        }

        data.organization = orgValidation.canonicalName || nextRawOrgText;
        data.organizationId = orgValidation.organizationId || null;
        data.organizationSiteId = orgValidation.organizationSiteId || null;
        data.organizationRawInput = nextRawOrgText;
      }
    }

    // Only ADMIN/USER can modify archived status
    if (archived !== undefined && (session.user.role === "ADMIN" || session.user.role === "USER")) {
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

    // Sync effective representative when organization/site changes
    if (touchedOrganization) {
      syncEffectiveRepresentativeLinksForCustomer(id).catch(() => {});
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
