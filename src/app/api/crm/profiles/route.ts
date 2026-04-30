import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { buildCrmWhereForRole, isRegionalManagerRole, isRepresentativeRole, extractScopedUserIds } from "@/lib/crm/permissions";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";

const profileInclude = {
  sourceCustomer: {
    select: {
      id: true, name: true, customerCode: true, principal: true,
      email: true, wechat: true, organization: true, address: true,
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

  const roleWhere = await buildCrmWhereForRole(session.user.id, session.user.role);
  const isScoped = isRepresentativeRole(session.user.role) || isRegionalManagerRole(session.user.role);

  const where: Record<string, unknown> = { ...roleWhere, archived: false };
  if (stage) where.stage = stage;
  if (importance) where.importance = importance;
  if (ownerUserId) {
    if (isScoped) {
      // Intersect with scope: only allow if ownerUserId is within the scoped set
      const scopedIds = extractScopedUserIds(roleWhere);
      if (scopedIds && !scopedIds.includes(ownerUserId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    where.ownerUserId = ownerUserId;
  }
  if (search) {
    where.sourceCustomer = {
      OR: [
        { name: { contains: search } },
        { customerCode: { contains: search } },
        { organization: { contains: search } },
        { principal: { contains: search } },
      ],
    };
  }

  const profiles = await prisma.crmCustomerProfile.findMany({
    where,
    include: profileInclude,
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ profiles });
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
