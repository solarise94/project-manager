import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ organizationId: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { organizationId } = await params;

  const org = await prisma.organization.findFirst({
    where: { id: organizationId, deleted: false },
    include: {
      aliases: true,
      sites: { where: { archived: false } },
      _count: { select: { customers: true } },
    },
  });
  if (!org) return NextResponse.json({ error: "Organization not found" }, { status: 404 });

  // CRM profiles for this org
  const profiles = await prisma.crmCustomerProfile.findMany({
    where: {
      archived: false,
      sourceCustomer: { organizationId, deleted: false },
    },
    select: {
      id: true,
      ownerUserId: true,
      stage: true,
      importance: true,
      personCategory: true,
      sourceCustomer: {
        select: {
          id: true,
          name: true,
          customerCode: true,
          principal: true,
          labOrGroup: true,
          organization: true,
          orgSite: { select: { id: true, siteName: true, siteType: true } },
        },
      },
      ownerUser: { select: { id: true, name: true } },
    },
  });

  const profileIds = profiles.map((p) => p.id);
  const ownerUserIds = [...new Set(profiles.map((p) => p.ownerUserId))];

  // Representative user mapping
  const salesUsers = await prisma.user.findMany({
    where: { id: { in: ownerUserIds }, role: { in: ["REPRESENTATIVE", "REGIONAL_MANAGER"] } },
    select: { id: true, name: true, email: true },
  });
  const userIdToSales = new Map(salesUsers.map((u) => [u.id, u]));

  const reps = await prisma.representative.findMany({
    where: { email: { in: salesUsers.map((u) => u.email) }, archived: false },
    select: { id: true, name: true, email: true },
  });
  const emailToRep = new Map(reps.map((r) => [r.email, r]));

  // Per-representative: group profiles by owner
  const repProfileMap = new Map<string, string[]>(); // repId → profileIds
  for (const p of profiles) {
    const sales = userIdToSales.get(p.ownerUserId);
    if (!sales) continue;
    const rep = emailToRep.get(sales.email);
    if (!rep) continue;
    const ids = repProfileMap.get(rep.id) || [];
    ids.push(p.id);
    repProfileMap.set(rep.id, ids);
  }

  // Interaction counts per profile (30d)
  const d30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const interactionAgg = profileIds.length > 0
    ? await prisma.crmInteraction.groupBy({
        by: ["profileId"],
        where: { profileId: { in: profileIds }, happenedAt: { gte: d30 }, type: { not: "VISIT" } },
        _count: true,
      })
    : [];
  const profileInteractionMap = new Map(interactionAgg.map((r) => [r.profileId, r._count]));

  // Checkin counts per profile (30d) — NOT per user, so each checkin belongs to its profile's org
  const checkinAgg = profileIds.length > 0
    ? await prisma.crmVisitCheckin.groupBy({
        by: ["profileId"],
        where: { profileId: { in: profileIds }, createdAt: { gte: d30 }, status: "COMPLETED" },
        _count: true,
      })
    : [];
  const profileCheckinMap = new Map(checkinAgg.map((r) => [r.profileId, r._count]));

  // Last checkin per profile
  const lastCheckinAgg = profileIds.length > 0
    ? await prisma.crmVisitCheckin.groupBy({
        by: ["profileId"],
        where: { profileId: { in: profileIds }, status: "COMPLETED" },
        _max: { createdAt: true },
      })
    : [];
  const profileLastCheckinMap = new Map(lastCheckinAgg.map((r) => [r.profileId, r._max.createdAt]));

  // Per-representative metrics — checkins aggregated per rep's profiles in this org
  const representativeBreakdown = reps.map((rep) => {
    const pids = repProfileMap.get(rep.id) || [];
    let interactionCount = 0;
    let checkinCount = 0;
    let lastCheckin: Date | null = null;
    for (const pid of pids) {
      interactionCount += profileInteractionMap.get(pid) || 0;
      checkinCount += profileCheckinMap.get(pid) || 0;
      const lc = profileLastCheckinMap.get(pid);
      if (lc && (!lastCheckin || lc > lastCheckin)) lastCheckin = lc;
    }

    return {
      representativeId: rep.id,
      name: rep.name,
      email: rep.email,
      profileCount: pids.length,
      interactionCount,
      checkinCount,
      lastCheckinAt: lastCheckin?.toISOString?.() ?? null,
    };
  });

  // Stage / Importance / PersonCategory distributions
  const stageDist: Record<string, number> = {};
  const importanceDist: Record<string, number> = {};
  const personCategoryDist: Record<string, number> = {};
  for (const p of profiles) {
    stageDist[p.stage] = (stageDist[p.stage] || 0) + 1;
    importanceDist[p.importance] = (importanceDist[p.importance] || 0) + 1;
    const pc = p.personCategory || "未设置";
    personCategoryDist[pc] = (personCategoryDist[pc] || 0) + 1;
  }

  // Recent interactions — scoped to this org's profiles
  const recentInteractions = profileIds.length > 0
    ? await prisma.crmInteraction.findMany({
        where: { profileId: { in: profileIds }, type: { not: "VISIT" } },
        orderBy: { happenedAt: "desc" },
        take: 20,
        select: {
          id: true, type: true, summary: true, happenedAt: true,
          profile: { select: { id: true, sourceCustomer: { select: { name: true } } } },
          createdByUser: { select: { name: true } },
        },
      })
    : [];

  // Recent checkins — scoped to this org's profiles
  const recentCheckins = profileIds.length > 0
    ? await prisma.crmVisitCheckin.findMany({
        where: { profileId: { in: profileIds }, status: "COMPLETED" },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true, summaryTitle: true, addressSnapshot: true, createdAt: true,
          user: { select: { name: true } },
        },
      })
    : [];

  return NextResponse.json({
    organization: {
      id: org.id,
      orgCode: org.orgCode,
      canonicalName: org.canonicalName,
      address: org.address,
      taxId: org.taxId,
      aliases: org.aliases,
      sites: org.sites,
      customerCount: org._count.customers,
      crmProfileCount: profiles.length,
    },
    customerSummary: profiles.slice(0, 100).map((p) => ({
      customerId: p.sourceCustomer.id,
      customerName: p.sourceCustomer.name,
      customerCode: p.sourceCustomer.customerCode,
      principal: p.sourceCustomer.principal,
      labOrGroup: p.sourceCustomer.labOrGroup,
      stage: p.stage,
      importance: p.importance,
      personCategory: p.personCategory,
      ownerName: p.ownerUser.name,
      siteName: p.sourceCustomer.orgSite?.siteName ?? null,
      siteType: p.sourceCustomer.orgSite?.siteType ?? null,
    })),
    representativeBreakdown,
    recentInteractions,
    recentCheckins,
    distributions: {
      stage: stageDist,
      importance: importanceDist,
      personCategory: personCategoryDist,
    },
  });
}
