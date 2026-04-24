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
    const { name, email, archived } = body;

    const existing = await prisma.representative.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Email conflict check
    if (email !== undefined) {
      const newEmail = email.trim().toLowerCase();
      if (newEmail !== existing.email) {
        const conflictRep = await prisma.representative.findUnique({
          where: { email: newEmail },
        });
        if (conflictRep) {
          return NextResponse.json({ error: "该邮箱已被其他代表使用" }, { status: 409 });
        }
        const conflictUser = await prisma.user.findUnique({
          where: { email: newEmail },
        });
        if (conflictUser && conflictUser.role !== "REPRESENTATIVE") {
          return NextResponse.json({ error: "该邮箱已被普通用户注册" }, { status: 409 });
        }
      }
    }

    const user = await prisma.user.findUnique({
      where: { email: existing.email },
    });

    const result = await prisma.$transaction(async (tx) => {
      const repData: Record<string, unknown> = {};
      if (name !== undefined) repData.name = name.trim();
      if (email !== undefined) repData.email = email.trim().toLowerCase();
      if (archived !== undefined) {
        repData.archived = archived;
        repData.archivedAt = archived ? new Date() : null;
      }

      const updated = await tx.representative.update({
        where: { id },
        data: repData,
      });

      if (user && (name !== undefined || email !== undefined)) {
        const userData: Record<string, unknown> = {};
        if (name !== undefined) userData.name = name.trim();
        if (email !== undefined) userData.email = email.trim().toLowerCase();
        await tx.user.update({
          where: { id: user.id },
          data: userData,
        });
      }

      // Sync project representative text snapshots when name changes
      if (name !== undefined) {
        await tx.project.updateMany({
          where: { representativeId: id },
          data: { representative: name.trim() },
        });
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
