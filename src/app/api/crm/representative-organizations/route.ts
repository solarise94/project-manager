import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { isRepresentative } from "@/lib/permissions";
import {
  canManageRepresentativeBindings,
  getRepresentativeIdByUserEmail,
  isRegionalManagerRole,
} from "@/lib/crm/permissions";
import { resolveOrganization } from "@/lib/organization-resolver";
import { autoAssignOrgCustomersToRep } from "@/lib/crm/customer-application-review";
import { notifyBindingReviewers } from "@/lib/crm/supervisor";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Allow-list: only ADMIN, REPRESENTATIVE, REGIONAL_MANAGER
  const allowedRoles = ["ADMIN", "REPRESENTATIVE", "REGIONAL_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status")?.trim() || "";
  const representativeId = searchParams.get("representativeId")?.trim() || "";

  if (session.user.role === "ADMIN" && !representativeId) {
    const where: Prisma.RepresentativeOrganizationWhereInput = {};
    if (status && ["ACTIVE", "PENDING", "REJECTED", "ARCHIVED"].includes(status)) {
      where.status = status;
    }
    if (representativeId) where.representativeId = representativeId;

    const bindings = await prisma.representativeOrganization.findMany({
      where,
      include: {
        organization: { select: { id: true, canonicalName: true, address: true } },
        representative: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ bindings });
  }

  if (representativeId) {
    const allowed = await canManageRepresentativeBindings(
      session.user.id,
      session.user.role,
      representativeId,
      session.user.email,
    );
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const where: Prisma.RepresentativeOrganizationWhereInput = { representativeId };
    if (status && ["ACTIVE", "PENDING", "REJECTED", "ARCHIVED"].includes(status)) {
      where.status = status;
    }

    const bindings = await prisma.representativeOrganization.findMany({
      where,
      include: {
        organization: { select: { id: true, canonicalName: true, address: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json({ bindings });
  }

  const ownRepresentativeId = await getRepresentativeIdByUserEmail(session.user.email);
  if (!ownRepresentativeId) return NextResponse.json({ bindings: [] });

  const bindings = await prisma.representativeOrganization.findMany({
    where: { representativeId: ownRepresentativeId },
    include: {
      organization: { select: { id: true, canonicalName: true, address: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ bindings });
}

function normalizeOrgName(text: string): string {
  return text.replace(/\s+/g, "").toLowerCase();
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Allow-list: only ADMIN, REPRESENTATIVE, REGIONAL_MANAGER
  const allowedRoles = ["ADMIN", "REPRESENTATIVE", "REGIONAL_MANAGER"];
  if (!allowedRoles.includes(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { organizationId, canonicalName, representativeId: bodyRepId } = body as Record<string, unknown>;

  if (!organizationId && !canonicalName) {
    return NextResponse.json({ error: "organizationId or canonicalName is required" }, { status: 400 });
  }

  const isSales = isRepresentative(session.user.role) || isRegionalManagerRole(session.user.role);
  const isAdmin = session.user.role === "ADMIN";

  // ADMIN can target any representative. REGIONAL_MANAGER can target managed reps.
  // Without representativeId the request always binds to the caller's own representative record.
  let rep: { id: string; email: string } | null = null;
  if (bodyRepId && typeof bodyRepId === "string") {
    const allowed = await canManageRepresentativeBindings(
      session.user.id,
      session.user.role,
      bodyRepId,
      session.user.email,
    );
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    rep = await prisma.representative.findUnique({
      where: { id: bodyRepId },
      select: { id: true, email: true },
    });
  } else {
    rep = await prisma.representative.findUnique({
      where: { email: session.user.email ?? "" },
      select: { id: true, email: true },
    });
  }
  if (!rep) return NextResponse.json({ error: "Representative not found" }, { status: 404 });

  const canAutoApproveBinding = isAdmin || (isRegionalManagerRole(session.user.role) && !!bodyRepId);
  const status = canAutoApproveBinding ? "ACTIVE" : "PENDING";

  let orgId: string | null = (organizationId as string) || null;
  let requestedOrgName: string | null = null;
  let requestedOrganizationNormalizedName: string | null = null;
  const reviewTaskId: string | null = null;

  // If canonicalName provided, resolve organization
  if (!orgId && canonicalName && typeof canonicalName === "string" && canonicalName.trim()) {
    const resolved = await resolveOrganization(canonicalName.trim());
    if (resolved.status === "exact" && resolved.organizationId) {
      orgId = resolved.organizationId;
    } else {
      // New org — task + binding + sourceId backfill in a single transaction
      // to prevent orphan OrganizationReviewTask if binding creation fails.
      const newRequestedOrgName = canonicalName.trim();
      const newRequestedOrgNormalizedName = normalizeOrgName(newRequestedOrgName);
      requestedOrgName = newRequestedOrgName;
      requestedOrganizationNormalizedName = newRequestedOrgNormalizedName;

      // Manual dedup: check existing pending new-org request for same rep + normalized name
      const existingPending = await prisma.representativeOrganization.findFirst({
        where: {
          representativeId: rep.id,
          organizationId: null,
          requestedOrganizationNormalizedName: newRequestedOrgNormalizedName,
          status: "PENDING",
        },
      });
      if (existingPending) {
        return NextResponse.json({ error: "该单位绑定申请已存在，正在等待审核", binding: existingPending }, { status: 409 });
      }

      let newBinding: Prisma.RepresentativeOrganizationGetPayload<{
        include: { organization: { select: { canonicalName: true } } };
      }>;
      try {
        newBinding = await prisma.$transaction(async (tx) => {
          const task = await tx.organizationReviewTask.create({
            data: {
              rawInput: newRequestedOrgName,
              normalizedInput: newRequestedOrgNormalizedName,
              status: "PENDING",
              sourceType: "REP_ORG_BINDING_REQUEST",
              sourceId: "", // backfilled below
            },
          });

          const created = await tx.representativeOrganization.create({
            data: {
              representativeId: rep.id,
              organizationId: null,
              requestedOrganizationName: newRequestedOrgName,
              requestedOrganizationNormalizedName: newRequestedOrgNormalizedName,
              organizationReviewTaskId: task.id,
              status: "PENDING",
              source: isSales ? "REP_REQUEST" : "MANUAL",
              requestedByUserId: session.user.id,
            },
            include: { organization: { select: { canonicalName: true } } },
          });

          await tx.organizationReviewTask.update({
            where: { id: task.id },
            data: { sourceId: created.id },
          });

          return created;
        });
      } catch (e: unknown) {
        const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
        if (isPrismaUnique) {
          return NextResponse.json({ error: "绑定已存在" }, { status: 409 });
        }
        throw e;
      }

      notifyBindingReviewers(newBinding.id, rep.id, newRequestedOrgName).catch(() => {});

      return NextResponse.json({ binding: newBinding }, { status: 201 });
    }
  }

  // Global occupancy check helper
  async function checkGlobalOrgConflict(targetOrgId: string) {
    if (!rep) return null;
    const otherActive = await prisma.representativeOrganization.findFirst({
      where: { organizationId: targetOrgId, status: "ACTIVE", representativeId: { not: rep.id } },
    });
    if (otherActive) {
      return NextResponse.json({ error: "该机构已被其他代表绑定", code: "ORG_BOUND_BY_OTHER_REP" }, { status: 409 });
    }
    const otherPending = await prisma.representativeOrganization.findFirst({
      where: { organizationId: targetOrgId, status: "PENDING", representativeId: { not: rep.id } },
    });
    if (otherPending) {
      return NextResponse.json({ error: "该机构已有其他代表申请中", code: "ORG_PENDING_BY_OTHER_REP" }, { status: 409 });
    }
    return null;
  }

  // Existing-org flow below
  if (orgId) {
    const globalConflict = await checkGlobalOrgConflict(orgId);
    if (globalConflict) return globalConflict;

    const existing = await prisma.representativeOrganization.findUnique({
      where: { representativeId_organizationId: { representativeId: rep.id, organizationId: orgId } },
    });
    if (existing) {
      if (existing.status === "REJECTED" || existing.status === "ARCHIVED") {
        // Re-activate: update existing row
        const updated = await prisma.representativeOrganization.update({
          where: { id: existing.id },
          data: {
            status,
            reviewNote: null,
            reviewedByUserId: null,
            reviewedAt: null,
          },
          include: { organization: { select: { canonicalName: true } } },
        });
        if (status === "PENDING") {
          notifyBindingReviewers(updated.id, rep.id, updated.organization?.canonicalName || orgId).catch(() => {});
        }
        if (status === "ACTIVE") {
          autoAssignOrgCustomersToRep(orgId, rep.email, session.user.id).catch(() => {});
        }
        return NextResponse.json({ binding: updated }, { status: 200 });
      }
      return NextResponse.json({ error: "绑定已存在", binding: existing }, { status: 409 });
    }
  }

  let binding: Prisma.RepresentativeOrganizationGetPayload<{
    include: { organization: { select: { canonicalName: true } } };
  }>;
  try {
    binding = await prisma.representativeOrganization.create({
      data: {
        representativeId: rep.id,
        organizationId: orgId,
        requestedOrganizationName: requestedOrgName,
        requestedOrganizationNormalizedName,
        organizationReviewTaskId: reviewTaskId,
        status,
        source: isSales ? "REP_REQUEST" : "MANUAL",
        requestedByUserId: session.user.id,
      },
      include: { organization: { select: { canonicalName: true } } },
    });
  } catch (e: unknown) {
    const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
    if (isPrismaUnique) {
      return NextResponse.json({ error: "绑定已存在" }, { status: 409 });
    }
    throw e;
  }

  if (status === "PENDING") {
    const orgDisplayName = binding.organization?.canonicalName || requestedOrgName || orgId || "";
    notifyBindingReviewers(binding.id, rep.id, orgDisplayName).catch(() => {});
  }

  if (status === "ACTIVE" && orgId) {
    autoAssignOrgCustomersToRep(orgId, rep.email, session.user.id).catch(() => {});
  }

  return NextResponse.json({ binding }, { status: 201 });
}
