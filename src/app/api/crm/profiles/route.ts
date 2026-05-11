import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCrmWhereForRole, isRegionalManagerRole, isRepresentativeRole, extractScopedUserIds } from "@/lib/crm/permissions";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
import { deriveGraduationStatus, buildGraduationStatusWhere } from "@/lib/crm/profile-filters";

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

  const andConditions: Record<string, unknown>[] = [{ ...roleWhere, archived: false }];
  if (sourceCustomerId) andConditions.push({ sourceCustomerId });
  if (stage) andConditions.push({ stage });
  if (importance) andConditions.push({ importance });
  if (assignee === "UNASSIGNED") {
    andConditions.push({ assignmentStatus: { in: ["UNASSIGNED", "RECALLED"] } });
  } else if (assignee) {
    if (isScoped) {
      const scopedIds = extractScopedUserIds(roleWhere);
      if (scopedIds && !scopedIds.includes(assignee)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    andConditions.push({ ownerUserId: assignee });
  } else if (ownerUserId) {
    if (isScoped) {
      const scopedIds = extractScopedUserIds(roleWhere);
      if (scopedIds && !scopedIds.includes(ownerUserId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    andConditions.push({ ownerUserId });
  }
  if (personCategory) andConditions.push({ personCategory });
  if (jobTitle) andConditions.push({ jobTitle: { contains: jobTitle } });
  if (graduationDateFrom || graduationDateTo) {
    const dateRange: Record<string, Date> = {};
    if (graduationDateFrom) dateRange.gte = new Date(graduationDateFrom);
    if (graduationDateTo) dateRange.lte = new Date(graduationDateTo);
    andConditions.push({ graduationDate: dateRange });
  }
  if (graduationStatus) {
    const gradWhere = buildGraduationStatusWhere(graduationStatus);
    if (gradWhere) andConditions.push(gradWhere);
  }

  const sourceCustomerWhere: Record<string, unknown> = {};
  if (search) {
    sourceCustomerWhere.OR = [
      { name: { contains: search } },
      { customerCode: { contains: search } },
      { organization: { contains: search } },
      { principal: { contains: search } },
    ];
  }
  if (organizationId) sourceCustomerWhere.organizationId = organizationId;
  if (siteId) sourceCustomerWhere.organizationSiteId = siteId;
  if (Object.keys(sourceCustomerWhere).length > 0) {
    andConditions.push({ sourceCustomer: sourceCustomerWhere });
  }

  const where: Record<string, unknown> = andConditions.length === 1 ? andConditions[0] : { AND: andConditions };

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
