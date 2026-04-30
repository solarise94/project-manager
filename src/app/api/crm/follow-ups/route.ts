import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCrmWhereForRole, isRepresentativeRole, isRegionalManagerRole, extractScopedUserIds } from "@/lib/crm/permissions";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || "OPEN";
  const ownerUserId = searchParams.get("ownerUserId") || "";

  const roleWhere = await buildCrmWhereForRole(session.user.id, session.user.role);
  const profileWhere = Object.keys(roleWhere).length > 0 ? { profile: roleWhere } : {};

  const where: Record<string, unknown> = { status, ...profileWhere };
  if (ownerUserId) where.ownerUserId = ownerUserId;
  // For REPRESENTATIVE, restrict to own follow-ups.
  // For REGIONAL_MANAGER, the profile-level scope (profileWhere) is sufficient.
  if (isRepresentativeRole(session.user.role)) where.ownerUserId = session.user.id;

  const tasks = await prisma.crmFollowUpTask.findMany({
    where,
    include: {
      ownerUser: { select: { id: true, name: true } },
      createdByUser: { select: { id: true, name: true } },
      profile: {
        select: {
          id: true,
          sourceCustomerId: true,
          sourceCustomer: { select: { id: true, name: true, customerCode: true } },
        },
      },
    },
    orderBy: { dueAt: "asc" },
  });

  return NextResponse.json({ tasks });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { profileId, ownerUserId, title, dueAt } = body;

  if (!profileId || !title || !dueAt) {
    return NextResponse.json({ error: "profileId, title, and dueAt are required" }, { status: 400 });
  }

  const profile = await prisma.crmCustomerProfile.findUnique({ where: { id: profileId } });
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const isScopedRole = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);
  if (isScopedRole) {
    const scope = await buildCrmWhereForRole(session.user.id, session.user.role);
    const ids = extractScopedUserIds(scope);
    if (ids && !ids.includes(profile.ownerUserId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const finalOwner = isRepresentativeRole(session.user.role) ? session.user.id : (ownerUserId || session.user.id);

  const task = await prisma.$transaction(async (tx) => {
    const created = await tx.crmFollowUpTask.create({
      data: {
        profileId,
        ownerUserId: finalOwner,
        title,
        dueAt: new Date(dueAt),
        createdByUserId: session.user.id,
      },
      include: {
        ownerUser: { select: { id: true, name: true } },
        createdByUser: { select: { id: true, name: true } },
        profile: {
          select: {
            id: true,
            sourceCustomerId: true,
            sourceCustomer: { select: { id: true, name: true, customerCode: true } },
          },
        },
      },
    });

    const earliestOpen = await tx.crmFollowUpTask.findFirst({
      where: { profileId, status: "OPEN" },
      orderBy: { dueAt: "asc" },
    });
    await tx.crmCustomerProfile.update({
      where: { id: profileId },
      data: { nextFollowUpAt: earliestOpen?.dueAt ?? null },
    });

    return created;
  });

  return NextResponse.json({ task }, { status: 201 });
}
