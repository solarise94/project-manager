import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { generateCustomerCode } from "@/lib/customer-code";
import { appendCustomerRepresentativeInfo, resolveSingleCustomerOption } from "@/lib/customers/customer-select-options";
import { ensureOrganizationFromInput } from "@/lib/organizations/ensure-organization";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const search = searchParams.get("search") || "";
  const showArchived = searchParams.get("archived") === "true";
  const limitParam = searchParams.get("limit");
  const excludeCrm = searchParams.get("excludeCrm") === "1";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

  if (isRepresentative(session.user.role)) {
    const projectIds = await getRepresentativeProjectIds(session.user.id);
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds }, customerId: { not: null } },
      select: { id: true, customerId: true },
    });
    const customerIds = [...new Set(projects.map((p) => p.customerId!))];

    // Scoped project count: only count projects the representative can see
    const countMap = new Map<string, number>();
    for (const p of projects) {
      countMap.set(p.customerId!, (countMap.get(p.customerId!) || 0) + 1);
    }

    const customers = await prisma.customer.findMany({
      where: {
        id: { in: customerIds },
        deleted: false,
        archived: false,
        ...(search ? { name: { contains: search } } : {}),
      },
      include: {
        org: { select: { canonicalName: true } },
        crmProfile: { select: { id: true, sourceCustomerId: true, assignmentStatus: true, ownerUser: { select: { email: true, role: true } } } },
      },
      orderBy: { createdAt: "desc" },
    });

    const withOrg = customers.map(({ org, ...c }) => ({
      ...c,
      organization: getCustomerOrganizationName({ organization: c.organization, org }),
      _count: { projects: countMap.get(c.id) ?? 0 },
    }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await appendCustomerRepresentativeInfo(withOrg as any);

    return NextResponse.json({ customers: result });
  }

  const where: Record<string, unknown> = { deleted: false };
  if (!showArchived) where.archived = false;
  if (excludeCrm) where.crmProfile = null;
  if (search) {
    where.OR = [
      { name: { contains: search } },
      { customerCode: { contains: search } },
      { organization: { contains: search } },
      { org: { canonicalName: { contains: search } } },
      { email: { contains: search } },
      { principal: { contains: search } },
      { wechat: { contains: search } },
    ];
  }

  const skip = limitParam ? 0 : (page - 1) * pageSize;
  const take = limitParam ? Math.min(parseInt(limitParam, 10) || 500, 500) : pageSize;

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: {
        _count: { select: { projects: true } },
        org: { select: { canonicalName: true } },
        crmProfile: { select: { id: true, sourceCustomerId: true, assignmentStatus: true, ownerUser: { select: { email: true, role: true } } } },
      },
      orderBy: [{ archived: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    prisma.customer.count({ where }),
  ]);

  const withOrg = customers.map(({ org, ...c }) => ({ ...c, organization: getCustomerOrganizationName({ organization: c.organization, org }) }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapped = await appendCustomerRepresentativeInfo(withOrg as any);
  return NextResponse.json({
    customers: mapped,
    total,
    page: limitParam ? 1 : page,
    pageSize: limitParam ? mapped.length : pageSize,
    totalPages: limitParam ? 1 : Math.ceil(total / pageSize),
  });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, principal, email, wechat, organization, address, miniProgramId, organizationId, organizationSiteId, organizationRawInput, autoCreateOrganization } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "客户姓名为必填项" }, { status: 400 });
    }

    let finalOrganizationId: string | null = organizationId || null;
    let finalOrganizationName: string | null = organization?.trim() || null;

    // Auto-create organization from raw input when no organizationId is provided
    if (!finalOrganizationId && autoCreateOrganization && organizationRawInput?.trim()) {
      try {
        const ensured = await ensureOrganizationFromInput(organizationRawInput.trim());
        finalOrganizationId = ensured.organizationId;
        finalOrganizationName = ensured.canonicalName;
      } catch (e) {
        console.error("ensureOrganizationFromInput failed:", e);
        return NextResponse.json({ error: `单位创建失败：${e instanceof Error ? e.message : "未知错误"}` }, { status: 400 });
      }
    }

    const customerData = {
      name: name.trim(),
      principal: principal?.trim() || null,
      email: email?.trim() || null,
      wechat: wechat?.trim() || null,
      organization: finalOrganizationName,
      address: address?.trim() || null,
      miniProgramId: miniProgramId?.trim() || null,
    };

    // Validate organizationId exists and is active
    if (finalOrganizationId) {
      const org = await prisma.organization.findUnique({
        where: { id: finalOrganizationId },
        select: { id: true, canonicalName: true, deleted: true, archived: true },
      });
      if (!org || org.deleted) {
        return NextResponse.json({ error: "指定的单位不存在" }, { status: 400 });
      }
      if (org.archived) {
        return NextResponse.json({ error: "指定的单位已归档，无法关联" }, { status: 400 });
      }
      // Server-side sync: always use canonical name as organization text
      customerData.organization = org.canonicalName;
      finalOrganizationName = org.canonicalName;
    }

    // Validate organizationSiteId belongs to organizationId
    // Auto-clear siteId if no orgId (prevent orphaned FK)
    const effectiveSiteId = organizationId ? (organizationSiteId || null) : null;
    if (effectiveSiteId && organizationId) {
      const site = await prisma.organizationSite.findUnique({ where: { id: effectiveSiteId }, select: { organizationId: true } });
      if (!site || site.organizationId !== organizationId) {
        return NextResponse.json({ error: "院区不属于指定机构" }, { status: 400 });
      }
    }

    // Retry on unique constraint collision (customerCode)
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const customerCode = await generateCustomerCode();
        const customer = await prisma.customer.create({
          data: {
            customerCode,
            ...customerData,
            organizationId: finalOrganizationId,
            organizationSiteId: effectiveSiteId,
            organizationRawInput: organizationRawInput || finalOrganizationName,
          },
          select: {
            id: true, customerCode: true, name: true,
            organization: true, organizationId: true,
            principal: true, wechat: true, address: true,
            org: { select: { canonicalName: true } },
            crmProfile: { select: { assignmentStatus: true, ownerUser: { select: { email: true, role: true } } } },
          },
        });

        const option = await resolveSingleCustomerOption({
          ...customer,
          organization: getCustomerOrganizationName({ organization: customer.organization, org: customer.org }),
        });

        return NextResponse.json({ customer: option }, { status: 201 });
      } catch (e: unknown) {
        const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
        if (!isPrismaUnique || attempt === 2) throw e;
      }
    }

    return NextResponse.json({ error: "创建客户失败" }, { status: 500 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "创建客户失败" }, { status: 500 });
  }
}
