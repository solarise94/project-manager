import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
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
  assignedByUser: { select: { id: true, name: true } },
  recalledByUser: { select: { id: true, name: true } },
  _count: { select: { interactions: true, followUpTasks: true, visitCheckins: true, addresses: true } },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRegionalManagerRole(session.user.role) || session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("assignmentStatus") || "";
  const search = searchParams.get("search") || "";
  const stage = searchParams.get("stage") || "";
  const organizationId = searchParams.get("organizationId") || "";
  const siteId = searchParams.get("siteId") || "";
  const personCategory = searchParams.get("personCategory") || "";
  const jobTitle = searchParams.get("jobTitle") || "";
  const graduationStatus = searchParams.get("graduationStatus") || "";
  const graduationDateFrom = searchParams.get("graduationDateFrom") || "";
  const graduationDateTo = searchParams.get("graduationDateTo") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "20") || 20));
  const sort = searchParams.get("sort") || "updatedAt";
  const order = searchParams.get("order") || "desc";

  const andConditions: Record<string, unknown>[] = [{ archived: false }];
  if (status) {
    andConditions.push({ assignmentStatus: status });
  } else {
    andConditions.push({ assignmentStatus: { in: ["UNASSIGNED", "RECALL_CANDIDATE", "RECALLED"] } });
  }
  if (stage) andConditions.push({ stage });
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
