import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id: sourceId } = await params;

  try {
    const body = await req.json();
    const { targetId } = body;

    if (!targetId || targetId === sourceId) {
      return NextResponse.json({ error: "目标客户无效" }, { status: 400 });
    }

    const [source, target] = await Promise.all([
      prisma.customer.findUnique({ where: { id: sourceId } }),
      prisma.customer.findUnique({ where: { id: targetId } }),
    ]);

    if (!source || source.deleted) {
      return NextResponse.json({ error: "源客户不存在" }, { status: 404 });
    }
    if (!target || target.deleted) {
      return NextResponse.json({ error: "目标客户不存在" }, { status: 404 });
    }

    await prisma.$transaction(async (tx) => {
      // Move all projects from source to target
      const projects = await tx.project.findMany({
        where: { customerId: sourceId },
        select: { id: true, organization: true },
      });

      for (const project of projects) {
        await tx.project.update({
          where: { id: project.id },
          data: {
            customerId: targetId,
            client: target.name,
            ...(project.organization ? {} : { organization: target.organization }),
          },
        });
      }

      // Mark source as deleted + merged
      await tx.customer.update({
        where: { id: sourceId },
        data: {
          deleted: true,
          deletedAt: new Date(),
          mergedIntoId: targetId,
        },
      });
    });

    return NextResponse.json({ merged: true, targetId });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "合并客户失败" }, { status: 500 });
  }
}
