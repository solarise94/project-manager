import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getReadableProjectIds, isRepresentative } from "@/lib/permissions";
import { getCustomerOrganizationName } from "@/lib/customer-organization";
import { resolveCustomerRepresentative } from "@/lib/crm/customer-owner-representative";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const dateRange = searchParams.get("dateRange");
  const archived = searchParams.get("archived");
  const includeDeleted = searchParams.get("includeDeleted");

  const isAdmin = session.user.role === "ADMIN";

  let projectIds: string[] | null = null; // null = no filter (admin)
  if (!isAdmin) {
    projectIds = await getReadableProjectIds(session.user.id, session.user.role);
    if (!projectIds || projectIds.length === 0) return NextResponse.json({ projects: [] });
  }

  const where: Prisma.ProjectWhereInput = {};
  if (projectIds) {
    where.id = { in: projectIds };
  }

  if (includeDeleted === "true") {
    if (!isAdmin) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    where.deleted = true;
  } else {
    where.deleted = false;
  }

  if (archived === "true") {
    where.archived = true;
  } else if (archived === "false") {
    where.archived = false;
  }

  if (status) {
    if (status.includes(",")) {
      where.status = { in: status.split(",") };
    } else {
      where.status = status;
    }
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
    ];
  }

  if (dateRange) {
    const now = new Date();
    const gte = new Date();
    switch (dateRange) {
      case "7d":
        gte.setDate(now.getDate() - 7);
        break;
      case "30d":
        gte.setDate(now.getDate() - 30);
        break;
      case "90d":
        gte.setDate(now.getDate() - 90);
        break;
      case "1y":
        gte.setFullYear(now.getFullYear() - 1);
        break;
    }
    where.createdAt = { gte };
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      rep: {
        select: { id: true, name: true, email: true },
      },
      cust: {
        select: { id: true, name: true, customerCode: true, organization: true, organizationId: true, org: { select: { canonicalName: true } } },
      },
      _count: {
        select: { tickets: true, comments: true },
      },
    },
    orderBy: [
      { deleted: "asc" },
      { archived: "asc" },
      { updatedAt: "desc" },
    ],
  });

  // Resolve customer organization name from relation
  const resolved = projects.map((p) => {
    if (!p.cust) return p;
    const { org, ...custRest } = p.cust;
    return { ...p, cust: { ...custRest, organization: getCustomerOrganizationName({ organization: custRest.organization, org }) } };
  });

  return NextResponse.json({ projects: resolved });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { name, description, orderNumber, organization, client, representativeId, customerId, status, progress, startDate, endDate, projectType, projectContent, quantity, procurementSource, brand, techSupport, budgetAmount, budgetCost } = body;

    // Derive representative from customer CRM owner when customerId is present.
    // Customer-bound projects always follow the CRM owner; manual representative is only
    // allowed when there is no customer.
    let resolvedRepId: string | null = null;
    let resolvedRepName: string | null = null;
    if (customerId) {
      const resolved = await resolveCustomerRepresentative(customerId);
      resolvedRepId = resolved.representativeId;
      resolvedRepName = resolved.representativeName;
    } else if (representativeId) {
      // No customer — allow manual representative
      const rep = await prisma.representative.findUnique({ where: { id: representativeId } });
      if (!rep) {
        return NextResponse.json({ error: "指定的代表不存在" }, { status: 400 });
      }
      resolvedRepId = rep.id;
      resolvedRepName = rep.name;
    }

    // Derive client/organization from customer when customerId is provided
    // Only override organization if customer has one; otherwise keep user-supplied value
    let custClient: string | null = null;
    let custOrg: string | null = null;
    if (customerId) {
      const cust = await prisma.customer.findUnique({
        where: { id: customerId },
        include: { org: { select: { canonicalName: true } } },
      });
      if (!cust) {
        return NextResponse.json({ error: "指定的客户不存在" }, { status: 400 });
      }
      custClient = cust.name;
      custOrg = getCustomerOrganizationName(cust);
    }

    const bc = budgetCost != null && budgetCost !== "" ? Number(budgetCost) : null;

    // Transaction: project + budget cost sync + activity log — all-or-nothing
    const { syncProjectBudgetCost } = await import("@/lib/finance/ledger");
    const project = await prisma.$transaction(async (tx) => {
      const created = await tx.project.create({
        data: {
          name,
          description,
          orderNumber,
          organization: (customerId && custOrg) ? custOrg : (organization || null),
          client: custClient || client || null,
          representative: resolvedRepName,
          representativeId: resolvedRepId,
          customerId: customerId || null,
          status: status || "NOT_STARTED",
          progress: Number.isFinite(Number(progress)) ? Math.max(0, Math.min(100, Number(progress))) : 0,
          startDate: startDate ? new Date(startDate) : null,
          endDate: endDate ? new Date(endDate) : null,
          projectType: projectType || null,
          projectContent: projectContent || null,
          quantity: quantity != null && quantity !== "" ? Number(quantity) : null,
          procurementSource: procurementSource || null,
          brand: brand || null,
          techSupport: techSupport || null,
          budgetAmount: budgetAmount != null && budgetAmount !== "" ? Number(budgetAmount) : null,
          budgetCost: bc,
          members: {
            create: {
              userId: session.user.id,
              role: "OWNER",
            },
          },
        },
      });

      if (bc) {
        await syncProjectBudgetCost(created.id, bc, session.user.id, tx);
      }

      await tx.activityLog.create({
        data: {
          type: "PROJECT_CREATED",
          content: `创建了项目 "${name}"`,
          projectId: created.id,
          userId: session.user.id,
        },
      });

      return created;
    });

    // Notify new representative if assigned
    if (project.representativeId) {
      const rep = await prisma.representative.findUnique({
        where: { id: project.representativeId, archived: false },
      });
      if (rep?.email) {
        const { notifyRepresentative } = await import("@/lib/representative-link");
        const result = await notifyRepresentative(rep.email, `/projects/${project.id}`, [
          {
            subject: `【SciManage】您已被指定为项目代表: ${project.name}`,
            text: `您好 ${rep.name || ""}，\n\n您已被指定为项目 "${project.name}" 的代表。\n\n---\nSciManage`,
            html: `<p>您好 <strong>${rep.name || ""}</strong>，</p>
<p>您已被指定为项目 <strong>"${project.name}"</strong> 的代表。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
          },
        ]);
        if (!result.ok) {
          console.error("Failed to notify representative for new project");
        }
      }
    }

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
