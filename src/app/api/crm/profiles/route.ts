import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";
import { deriveGraduationStatus, buildGraduationStatusWhere } from "@/lib/crm/profile-filters";
import { syncCustomerRepresentativeLinksByOwnerUser } from "@/lib/crm/customer-representative-sync";
import { assertRepresentativeBackedSalesUser } from "@/lib/representative-user";
import { getCrmLifecycleSummariesForCustomers } from "@/lib/crm/lifecycle";
import { resolveEffectiveCustomerRepresentatives } from "@/lib/crm/customer-effective-representative";
import { isRegionalManagerRole, isRepresentativeRole, getRegionalManagerUserIds } from "@/lib/crm/permissions";

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

type LifecycleSummaryMap = Awaited<ReturnType<typeof getCrmLifecycleSummariesForCustomers>>;

function matchesLifecycleFilters(
  lifecycle: LifecycleSummaryMap extends Map<string, infer TValue> ? TValue | undefined : never,
  filters: {
    hasOrder: string;
    repeatCustomer: string;
    dormantRisk: string;
    communicationDue: string;
  },
) {
  const validOrderCount = lifecycle?.validOrderCount ?? 0;
  const isRepeat = lifecycle?.isRepeatCustomer ?? false;
  const isDormantRisk = lifecycle?.dormantRisk ?? false;
  const hasCommunicationDue = Boolean(lifecycle?.nextCommunicationTaskAt);

  if (filters.hasOrder === "true" && validOrderCount <= 0) return false;
  if (filters.hasOrder === "false" && validOrderCount > 0) return false;
  if (filters.repeatCustomer === "true" && !isRepeat) return false;
  if (filters.repeatCustomer === "false" && isRepeat) return false;
  if (filters.dormantRisk === "true" && !isDormantRisk) return false;
  if (filters.dormantRisk === "false" && isDormantRisk) return false;
  if (filters.communicationDue === "true" && !hasCommunicationDue) return false;
  if (filters.communicationDue === "false" && hasCommunicationDue) return false;

  return true;
}

function enrichProfiles(
  profiles: Array<{
    sourceCustomerId: string;
    personCategory: string | null;
    graduationDate: Date | null;
    lastOrderAt: Date | null;
  } & Record<string, unknown>>,
  lifecycleMap: LifecycleSummaryMap,
) {
  return profiles.map((profile) => {
    const lifecycle = lifecycleMap.get(profile.sourceCustomerId);
    return {
      ...profile,
      graduationStatus: deriveGraduationStatus(profile.personCategory, profile.graduationDate),
      validOrderCount: lifecycle?.validOrderCount ?? 0,
      lastOrderAt: lifecycle?.lastOrderAt?.toISOString() ?? null,
      isRepeatCustomer: lifecycle?.isRepeatCustomer ?? false,
      dormantRisk: lifecycle?.dormantRisk ?? false,
      nextCommunicationTaskAt: lifecycle?.nextCommunicationTaskAt?.toISOString() ?? null,
    };
  });
}

function compareNullableDates(left: Date | null, right: Date | null, sortOrder: "asc" | "desc") {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return sortOrder === "asc" ? left.getTime() - right.getTime() : right.getTime() - left.getTime();
}

function compareNumbers(left: number, right: number, sortOrder: "asc" | "desc") {
  return sortOrder === "asc" ? left - right : right - left;
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
  const siteId = searchParams.get("siteId") || "";
  const personCategory = searchParams.get("personCategory") || "";
  const jobTitle = searchParams.get("jobTitle") || "";
  const graduationStatus = searchParams.get("graduationStatus") || "";
  const graduationDateFrom = searchParams.get("graduationDateFrom") || "";
  const graduationDateTo = searchParams.get("graduationDateTo") || "";
  const hasOrder = searchParams.get("hasOrder") || "";
  const repeatCustomer = searchParams.get("repeatCustomer") || "";
  const dormantRisk = searchParams.get("dormantRisk") || "";
  const communicationDue = searchParams.get("communicationDue") || "";
  const sort = searchParams.get("sort") || "updatedAt";
  const order = searchParams.get("order") || "desc";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1") || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(searchParams.get("pageSize") || "50") || 50));

  const isScoped = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);

  // Build filters that can be expressed in Prisma WHERE
  const andConditions: Record<string, unknown>[] = [{ archived: false }];
  if (sourceCustomerId) andConditions.push({ sourceCustomerId });
  if (stage) andConditions.push({ stage });
  if (importance) andConditions.push({ importance });
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

  // Note: we no longer filter by ownerUserId/assignee at the DB level.
  // Effective representative filtering is applied after resolution.

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

  const validSorts = ["updatedAt", "createdAt", "lastFollowUpAt", "nextFollowUpAt", "stage", "lastOrderAt", "validOrderCount"];
  const sortField = validSorts.includes(sort) ? sort : "updatedAt";
  const sortOrder = order === "asc" ? "asc" : "desc";
  const lifecycleFilters = { hasOrder, repeatCustomer, dormantRisk, communicationDue };
  const hasLifecycleFilters = Object.values(lifecycleFilters).some(Boolean);
  const usesLifecycleSort = sortField === "lastOrderAt" || sortField === "validOrderCount";

  // Step 1: Query all candidate profiles (without owner filter)
  const candidates = await prisma.crmCustomerProfile.findMany({
    where,
    select: {
      id: true,
      sourceCustomerId: true,
      updatedAt: true,
    },
    orderBy: usesLifecycleSort
      ? [{ updatedAt: "desc" }]
      : [{ [sortField]: sortOrder }],
  });

  // Step 2: Resolve effective representatives for all candidates
  const candidateCustomerIds = [...new Set(candidates.map((p) => p.sourceCustomerId))];
  const effectiveMap = await resolveEffectiveCustomerRepresentatives(candidateCustomerIds);

  // Step 3: Filter by effective owner for scoped roles and assignee filter
  let allowedOwnerIds: string[] | null = null;
  if (isScoped) {
    if (session.user.role === "REPRESENTATIVE") {
      allowedOwnerIds = [session.user.id];
    } else if (session.user.role === "REGIONAL_MANAGER") {
      const repUserIds = await getRegionalManagerUserIds(session.user.id);
      allowedOwnerIds = repUserIds && repUserIds.length > 0 ? [session.user.id, ...repUserIds] : [session.user.id];
    }
  }

  // Apply assignee/ownerUserId/scope filtering (effective owner)
  let filteredCandidates = candidates.filter((p) => {
    const effective = effectiveMap.get(p.sourceCustomerId);
    const effOwnerId = effective?.ownerUserId;

    if (assignee === "UNASSIGNED") {
      if (effOwnerId) return false;
    } else if (assignee) {
      if (effOwnerId !== assignee) return false;
    } else if (ownerUserId) {
      if (effOwnerId !== ownerUserId) return false;
    }

    // Scoped roles must also intersect with allowedOwnerIds
    if (allowedOwnerIds) {
      if (!effOwnerId || !allowedOwnerIds.includes(effOwnerId)) return false;
    }

    return true;
  });

  // Step 4: Lifecycle filtering
  let lifecycleMap: LifecycleSummaryMap;
  if (hasLifecycleFilters || usesLifecycleSort) {
    lifecycleMap = await getCrmLifecycleSummariesForCustomers(
      filteredCandidates.map((p) => p.sourceCustomerId),
    );

    if (hasLifecycleFilters) {
      filteredCandidates = filteredCandidates.filter((p) =>
        matchesLifecycleFilters(lifecycleMap.get(p.sourceCustomerId), lifecycleFilters),
      );
    }

    if (usesLifecycleSort) {
      filteredCandidates.sort((left, right) => {
        const leftLifecycle = lifecycleMap.get(left.sourceCustomerId);
        const rightLifecycle = lifecycleMap.get(right.sourceCustomerId);
        const primary = sortField === "lastOrderAt"
          ? compareNullableDates(leftLifecycle?.lastOrderAt ?? null, rightLifecycle?.lastOrderAt ?? null, sortOrder as "asc" | "desc")
          : compareNumbers(leftLifecycle?.validOrderCount ?? 0, rightLifecycle?.validOrderCount ?? 0, sortOrder as "asc" | "desc");
        if (primary !== 0) return primary;
        return right.updatedAt.getTime() - left.updatedAt.getTime();
      });
    }
  } else {
    lifecycleMap = await getCrmLifecycleSummariesForCustomers(
      filteredCandidates.map((p) => p.sourceCustomerId),
    );
  }

  // Step 5: Pagination
  const total = filteredCandidates.length;
  const pageCandidateIds = filteredCandidates.slice((page - 1) * pageSize, page * pageSize);

  let pagedProfiles: Awaited<ReturnType<typeof prisma.crmCustomerProfile.findMany>>;
  if (pageCandidateIds.length === 0) {
    pagedProfiles = [];
  } else {
    const pageOrder = new Map(pageCandidateIds.map((c, index) => [c.id, index]));
    const fetchedProfiles = await prisma.crmCustomerProfile.findMany({
      where: {
        AND: [
          where,
          { id: { in: pageCandidateIds.map((c) => c.id) } },
        ],
      },
      include: profileInclude,
      orderBy: usesLifecycleSort ? { updatedAt: "desc" } : { [sortField]: sortOrder },
    });
    pagedProfiles = fetchedProfiles.sort(
      (left, right) =>
        (pageOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER)
        - (pageOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  const enriched = enrichProfiles(pagedProfiles, lifecycleMap);

  return NextResponse.json({
    profiles: enriched,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  });
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

  const finalOwner = session.user.role === "REPRESENTATIVE" ? session.user.id : ownerUserId;
  if (!finalOwner) {
    return NextResponse.json({ error: "ownerUserId is required" }, { status: 400 });
  }
  try {
    await assertRepresentativeBackedSalesUser(finalOwner);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "负责人无效" }, { status: 400 });
  }

  const profile = await prisma.$transaction(async (tx) => {
    const created = await tx.crmCustomerProfile.create({
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

    await syncCustomerRepresentativeLinksByOwnerUser(
      sourceCustomerId,
      created.ownerUserId,
      created.assignmentStatus === "ASSIGNED",
      tx,
    );

    return created;
  });

  return NextResponse.json({ profile }, { status: 201 });
}
