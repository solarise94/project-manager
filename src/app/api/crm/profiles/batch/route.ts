import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { syncCustomerRepresentativeLinksByOwnerUser } from "@/lib/crm/customer-representative-sync";
import { assertRepresentativeBackedSalesUser } from "@/lib/representative-user";

const candidateWhere = { deleted: false, archived: false, crmProfile: null } as const;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const count = await prisma.customer.count({ where: candidateWhere });
  return NextResponse.json({ count });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { stage = "LEAD", importance = "NORMAL", ownerUserId } = body;
  const finalOwner = ownerUserId;
  if (!finalOwner) {
    return NextResponse.json({ error: "ownerUserId is required" }, { status: 400 });
  }
  try {
    await assertRepresentativeBackedSalesUser(finalOwner);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "负责人无效" }, { status: 400 });
  }

  const now = new Date();
  const created = await prisma.$transaction(async (tx) => {
    const candidates = await tx.customer.findMany({
      where: candidateWhere,
      select: { id: true },
    });
    if (candidates.length === 0) return 0;

    let count = 0;
    for (const c of candidates) {
      try {
        await tx.crmCustomerProfile.create({
          data: {
            sourceCustomerId: c.id,
            ownerUserId: finalOwner,
            stage,
            importance,
            lastFollowUpAt: now,
          },
        });
        await syncCustomerRepresentativeLinksByOwnerUser(c.id, finalOwner, true, tx);
        count++;
      } catch (e: unknown) {
        if (e && typeof e === "object" && "code" in e && (e as { code: string }).code === "P2002") continue;
        throw e;
      }
    }
    return count;
  });

  return NextResponse.json({ created });
}
