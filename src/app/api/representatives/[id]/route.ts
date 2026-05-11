import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

async function assertAdmin(session: { user?: { id?: string } } | null) {
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (currentUser?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;

  try {
    const body = await req.json();
    const { name, email, archived, regionIds } = body;

    const existing = await prisma.representative.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Validate regionIds if provided — must be a string array, all must exist and not be archived
    if (regionIds !== undefined) {
      if (!Array.isArray(regionIds) || regionIds.some((id: unknown) => typeof id !== "string" || !id.trim())) {
        return NextResponse.json({ error: "regionIds 必须是字符串数组" }, { status: 400 });
      }
      const deduped: string[] = [...new Set(regionIds as string[])];
      if (deduped.length > 0) {
        const validRegions = await prisma.representativeRegion.findMany({
          where: { id: { in: deduped }, archived: false },
          select: { id: true },
        });
        if (validRegions.length !== deduped.length) {
          return NextResponse.json({ error: "地区不存在或已归档" }, { status: 400 });
        }
      }
    }

    const newEmail = email !== undefined ? email.trim().toLowerCase() : existing.email;
    const newName = name !== undefined ? name.trim() : existing.name;

    // Email conflict check: if email changes, validate new email is free
    if (newEmail !== existing.email) {
      const conflictRep = await prisma.representative.findUnique({
        where: { email: newEmail },
      });
      if (conflictRep) {
        return NextResponse.json({ error: "该邮箱已被其他代表使用" }, { status: 409 });
      }
      // Reject if ANY User exists at the new email (safe approach: no cross-User merge)
      const conflictUser = await prisma.user.findUnique({ where: { email: newEmail } });
      if (conflictUser) {
        return NextResponse.json({ error: "该邮箱已被其他用户使用，请联系管理员" }, { status: 409 });
      }
    }

    const result = await prisma.$transaction(async (tx) => {
      const repData: Record<string, unknown> = {};
      if (name !== undefined) repData.name = newName;
      if (email !== undefined) repData.email = newEmail;
      if (archived !== undefined) {
        repData.archived = archived;
        repData.archivedAt = archived ? new Date() : null;
      }

      const updated = await tx.representative.update({
        where: { id },
        data: repData,
      });

      // Update the existing User: find by OLD email, update to new email/name
      const oldUser = await tx.user.findUnique({ where: { email: existing.email } });
      if (oldUser) {
        const userData: Record<string, unknown> = {};
        if (name !== undefined) userData.name = newName;
        if (email !== undefined && newEmail !== existing.email) {
          userData.email = newEmail;
        }
        await tx.user.update({ where: { id: oldUser.id }, data: userData });
      }

      // Sync project representative text snapshots when name changes
      if (name !== undefined) {
        await tx.project.updateMany({
          where: { representativeId: id },
          data: { representative: newName },
        });
      }

      // Region assignments: delete old + recreate new
      if (regionIds !== undefined) {
        await tx.representativeRegionAssignment.deleteMany({ where: { representativeId: id } });
        if (Array.isArray(regionIds) && regionIds.length > 0) {
          await tx.representativeRegionAssignment.createMany({
            data: regionIds.map((regionId: string) => ({
              representativeId: id,
              regionId,
            })),
          });
        }
      }

      return updated;
    });
    return NextResponse.json({ representative: result });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update representative" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  const { id } = await params;

  try {
    const rep = await prisma.representative.findUnique({ where: { id } });
    if (!rep) return NextResponse.json({ error: "Not found" }, { status: 404 });

    return NextResponse.json(
      { error: "请使用归档功能代替删除" },
      { status: 400 }
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to delete representative" }, { status: 500 });
  }
}
