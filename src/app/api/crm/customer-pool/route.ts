import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";
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
  assignedByUser: { select: { id: true, name: true } },
  recalledByUser: { select: { id: true, name: true } },
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
      return { OR: [{ personCategory: null }, { personCategory: { not: "STUDENT" } }] };
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
  if (isRegionalManagerRole(session.user.role) || session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("assignmentStatus") || "";
  const search = searchParams.get("search") || "";
  const stage = searchParams.get("stage") || "";
  const organizationId = searchParams.get("organizationId") || "";
  const siteType = searchParams.get("siteType") || "";
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

  const where: Record<string, unknown> = { archived: false };
  if (status) {
    where.assignmentStatus = status;
  } else {
    where.assignmentStatus = { in: ["UNASSIGNED", "RECALL_CANDIDATE", "RECALLED"] };
  }
  if (stage) where.stage = stage;
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
