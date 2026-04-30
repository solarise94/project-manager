import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { id } = await params;
  const manager = await prisma.crmRegionManager.findUnique({ where: { id } });
  if (!manager) return NextResponse.json({ error: "Region manager not found" }, { status: 404 });

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.regionName !== undefined) data.regionName = body.regionName;
  if (body.archived !== undefined) data.archived = body.archived;

  const updated = await prisma.$transaction(async (tx) => {
    // Sync rep assignments if repIds is provided
    if (Array.isArray(body.repIds)) {
      await tx.crmRegionManagerRepresentative.deleteMany({ where: { managerId: id } });
      if (body.repIds.length > 0) {
        await tx.crmRegionManagerRepresentative.createMany({
          data: body.repIds.map((repId: string) => ({ managerId: id, representativeId: repId })),
        });
      }
    }

    // Restore/set user role when archiving/unarchiving
    if (body.archived === true) {
      const managerUser = await tx.user.findUnique({ where: { id: manager.userId } });
      if (managerUser && managerUser.role === "REGIONAL_MANAGER") {
        // If the same email has an active Representative, restore to REPRESENTATIVE instead of USER
        const activeRep = await tx.representative.findFirst({
          where: { email: managerUser.email, archived: false },
        });
        await tx.user.update({
          where: { id: manager.userId },
          data: { role: activeRep ? "REPRESENTATIVE" : "USER" },
        });
      }
    } else if (body.archived === false) {
      await tx.user.update({ where: { id: manager.userId }, data: { role: "REGIONAL_MANAGER" } });
    }

    const result = await tx.crmRegionManager.update({
      where: { id },
      data,
      include: {
        user: { select: { id: true, name: true, email: true } },
        reps: { include: { representative: { select: { id: true, name: true, email: true } } } },
      },
    });

    return result;
  });

  return NextResponse.json({ manager: updated });
}
