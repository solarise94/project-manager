import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRegionalManagerRole } from "@/lib/crm/permissions";

const profileInclude = {
  sourceCustomer: {
    select: {
      id: true, name: true, customerCode: true, principal: true,
      email: true, wechat: true, organization: true, address: true,
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

  const where: Record<string, unknown> = { archived: false };
  if (status) {
    where.assignmentStatus = status;
  } else {
    where.assignmentStatus = { in: ["UNASSIGNED", "RECALL_CANDIDATE", "RECALLED"] };
  }
  if (stage) where.stage = stage;
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
    take: 100,
  });

  return NextResponse.json({ profiles });
}
