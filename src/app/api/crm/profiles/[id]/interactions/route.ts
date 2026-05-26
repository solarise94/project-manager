import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertCrmProfileAccess } from "@/lib/crm/permissions";
import { syncCrmLifecycleAfterInteraction } from "@/lib/crm/lifecycle";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await assertCrmProfileAccess(id, session.user.id, session.user.role);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type") || "";

  const where: Record<string, unknown> = { profileId: id };
  if (type) where.type = type;

  const interactions = await prisma.crmInteraction.findMany({
    where,
    include: { createdByUser: { select: { id: true, name: true } } },
    orderBy: { happenedAt: "desc" },
  });

  return NextResponse.json({ interactions });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await assertCrmProfileAccess(id, session.user.id, session.user.role);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "";
    if (msg === "NOT_FOUND") return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const { type, summary, detail, happenedAt, nextActionAt, relatedProjectId } = body;

  if (!type || !summary) {
    return NextResponse.json({ error: "type and summary are required" }, { status: 400 });
  }

  const interaction = await prisma.crmInteraction.create({
    data: {
      profileId: id,
      type,
      summary,
      detail: detail || null,
      happenedAt: happenedAt ? new Date(happenedAt) : new Date(),
      nextActionAt: nextActionAt ? new Date(nextActionAt) : null,
      relatedProjectId: relatedProjectId || null,
      createdByUserId: session.user.id,
    },
    include: { createdByUser: { select: { id: true, name: true } } },
  });

  try {
    await syncCrmLifecycleAfterInteraction(id, {
      happenedAt: interaction.happenedAt,
      nextActionAt: interaction.nextActionAt,
      actorUserId: session.user.id,
    });
  } catch (error) {
    console.error(`[CRM][INTERACTION] lifecycle sync failed for profile ${id}:`, error);
  }

  return NextResponse.json({ interaction }, { status: 201 });
}
