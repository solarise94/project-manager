import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCrmWhereForRole, isRegionalManagerRole, isRepresentativeRole, extractScopedUserIds } from "@/lib/crm/permissions";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
import { GRADUATION_LOOKAHEAD_DAYS } from "@/lib/crm/constants";

const profileInclude = {
  sourceCustomer: {
    select: {
      id: true, name: true, customerCode: true, principal: true,
      email: true, wechat: true, organization: true, address: true,
      organizationId: true, organizationSiteId: true, labOrGroup: true,
      orgSite: { select: { id: true, siteName: true, siteType: true } },
    },
  },
  ownerUser: { select: { id: true, name: true } },
  _count: { select: { interactions: true, followUpTasks: true, visitCheckins: true, addresses: true } },
};

function deriveGraduationStatus(personCategory: string | null, graduationDate: Date | null): string {
  if (!personCategory || personCategory !== "STUDENT") return "NOT_APPLICABLE";
  if (!graduationDate) return "UNKNOWN";
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const grad = new Date(graduationDate);
  grad.setHours(0, 0, 0, 0);
  if (grad <= now) return "GRADUATED";
  const lookahead = new Date(now);
  lookahead.setDate(lookahead.getDate() + GRADUATION_LOOKAHEAD_DAYS);
  if (grad <= lookahead) return "GRADUATING_SOON";
  return "ENROLLED";
}

function buildGraduationStatusWhere(status: string): Record<string, unknown> | null {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const lookahead = new Date(now);
  lookahead.setDate(lookahead.getDate() + GRADUATION_LOOKAHEAD_DAYS);
  switch (status) {
    case "NOT_APPLICABLE":
      return {
        OR: [
          { personCategory: null },
          { personCategory: { not: "STUDENT" } },
        ],
      };
    case "UNKNOWN":
      return { personCategory: "STUDENT", graduationDate: null };
    case "ENROLLED":
      return { personCategory: "STUDENT", graduationDate: { gt: lookahead } };
    case "GRADUATING_SOON":
      return { personCategory: "STUDENT", graduationDate: { gt: now, lte: lookahead } };
    case "GRADUATED":
      return { personCategory: "STUDENT", graduationDate: { lte: now } };
    default:
      return null;
  }
}

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const search = searchParams.get("search") || "";
  const stage = searchParams.get("stage") || "";
  const importance = searchParams.get("importance") || "";
  const ownerUserId = searchParams.get("ownerUserId") || "";
  const assignee = searchParams.get("assignee") || "";
  const sourceCustomerId = searchParams.get("sourceCustomerId") || "";
  const organizationId = searchParams.get("organizationId") || "";
  const siteType = searchParams.get("siteType") || "";
  const siteId = searchParams.get("siteId") || "";
  const personCategory = searchParams.get("personCategory") || "";
  const jobTitle = searchParams.get("jobTitle") || "";
  const graduationStatus = searchParams.get("graduationStatus") || "";
  const graduationDateFrom = searchParams.get("graduationDateFrom") || "";
  const graduationDateTo = searchParams.get("graduationDateTo") || "";
  const sort = searchParams.get("sort") || "updatedAt";
  const order = searchParams.get("order") || "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "50") || 50));

  const hasAssigneeFilter = assignee !== "";
  const roleWhere = await buildCrmWhereForRole(session.user.id, session.user.role, { includeUnassigned: hasAssigneeFilter });
  const isScoped = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);

  const where: Record<string, unknown> = { ...roleWhere, archived: false };
  if (sourceCustomerId) where.sourceCustomerId = sourceCustomerId;
  if (stage) where.stage = stage;
  if (importance) where.importance = importance;
  if (assignee === "UNASSIGNED") {
    where.assignmentStatus = { in: ["UNASSIGNED", "RECALLED"] };
  } else if (assignee) {
    if (isScoped) {
      const scopedIds = extractScopedUserIds(roleWhere);
      if (scopedIds && !scopedIds.includes(assignee)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    where.ownerUserId = assignee;
  } else if (ownerUserId) {
    if (isScoped) {
      const scopedIds = extractScopedUserIds(roleWhere);
      if (scopedIds && !scopedIds.includes(ownerUserId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    where.ownerUserId = ownerUserId;
  }
  if (personCategory) where.personCategory = personCategory;
  if (jobTitle) where.jobTitle = { contains: jobTitle };
  if (graduationDateFrom || graduationDateTo) {
    const dateRange: Record<string, Date> = {};
    if (graduationDateFrom) dateRange.gte = new Date(graduationDateFrom);
    if (graduationDateTo) dateRange.lte = new Date(graduationDateTo);
    where.graduationDate = dateRange;
  }
  if (graduationStatus) {
    const gradWhere = buildGraduationStatusWhere(graduationStatus);
    if (gradWhere) Object.assign(where, gradWhere);
  }

  const sourceCustomerWhere: Record<string, unknown> = {};
  if (search) {
    Object.assign(sourceCustomerWhere, {
      OR: [
        { name: { contains: search } },
        { customerCode: { contains: search } },
        { organization: { contains: search } },
        { principal: { contains: search } },
      ],
    });
  }
  if (organizationId) Object.assign(sourceCustomerWhere, { organizationId });
  if (siteId) Object.assign(sourceCustomerWhere, { organizationSiteId: siteId });
  if (siteType) {
    Object.assign(sourceCustomerWhere, { orgSite: { siteType } });
  }
  if (Object.keys(sourceCustomerWhere).length > 0) {
    where.sourceCustomer = sourceCustomerWhere;
  }

  const validSorts = ["updatedAt", "createdAt", "lastFollowUpAt", "nextFollowUpAt", "stage"];
  const sortField = validSorts.includes(sort) ? sort : "updatedAt";
  const sortOrder = order === "asc" ? "asc" : "desc";

  const [profiles, total] = await Promise.all([
    prisma.crmCustomerProfile.findMany({
      where,
      include: profileInclude,
      orderBy: { [sortField]: sortOrder },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.crmCustomerProfile.count({ where }),
  ]);

  const enriched = profiles.map((p) => ({
    ...p,
    graduationStatus: deriveGraduationStatus(p.personCategory, p.graduationDate),
  }));

  return NextResponse.json({ profiles: enriched, total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { sourceCustomerId, ownerUserId, stage, importance, summary, tagsJson } = body;

  if (!sourceCustomerId) {
    return NextResponse.json({ error: "sourceCustomerId is required" }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: sourceCustomerId } });
  if (!customer || customer.deleted) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  if (isRegionalManagerRole(session.user.role)) {
    return NextResponse.json({ error: "地区经理不能创建客户档案，只能管理已分配的客户" }, { status: 403 });
  }

  if (isRepresentative(session.user.role)) {
    const projectIds = await getRepresentativeProjectIds(session.user.id);
    const linked = await prisma.project.findFirst({
      where: { id: { in: projectIds }, customerId: sourceCustomerId },
    });
    if (!linked) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const existing = await prisma.crmCustomerProfile.findUnique({ where: { sourceCustomerId } });
  if (existing) {
    return NextResponse.json({ error: "CRM profile already exists for this customer" }, { status: 409 });
  }

  const finalOwner = session.user.role === "REPRESENTATIVE" ? session.user.id : (ownerUserId || session.user.id);

  const profile = await prisma.crmCustomerProfile.create({
    data: {
      sourceCustomerId,
      ownerUserId: finalOwner,
      stage: session.user.role === "REPRESENTATIVE" ? "NEW" : (stage || "NEW"),
      importance: session.user.role === "REPRESENTATIVE" ? "NORMAL" : (importance || "NORMAL"),
      summary: summary || null,
      tagsJson: tagsJson || null,
      lastFollowUpAt: new Date(),
    },
    include: profileInclude,
  });

  return NextResponse.json({ profile }, { status: 201 });
}
