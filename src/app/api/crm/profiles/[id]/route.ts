import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { assertCrmProfileAccess } from "@/lib/crm/permissions";

export async function GET(
  _req: NextRequest,
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

  const profile = await prisma.crmCustomerProfile.findUnique({
    where: { id },
    include: {
      sourceCustomer: {
        select: {
          id: true, name: true, customerCode: true, principal: true,
          email: true, wechat: true, organization: true, address: true,
          miniProgramId: true, archived: true,
        },
      },
      ownerUser: { select: { id: true, name: true } },
      addresses: { orderBy: { createdAt: "desc" } },
      interactions: {
        orderBy: { happenedAt: "desc" },
        take: 10,
        include: { createdByUser: { select: { id: true, name: true } } },
      },
      followUpTasks: {
        where: { status: "OPEN" },
        orderBy: { dueAt: "asc" },
        include: {
          ownerUser: { select: { id: true, name: true } },
          createdByUser: { select: { id: true, name: true } },
        },
      },
      visitCheckins: {
        orderBy: { createdAt: "desc" },
        take: 5,
        include: { media: true, user: { select: { id: true, name: true } } },
      },
      _count: { select: { interactions: true, followUpTasks: true, visitCheckins: true, addresses: true } },
    },
  });

  return NextResponse.json({ profile });
}

export async function PATCH(
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
  const data: Record<string, unknown> = {};

  if (body.summary !== undefined) data.summary = body.summary;
  if (body.tagsJson !== undefined) data.tagsJson = body.tagsJson;
  if (body.nextFollowUpAt !== undefined) data.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
  if (body.archived !== undefined) data.archived = body.archived;
  if (body.personCategory !== undefined) data.personCategory = body.personCategory || null;
  if (body.jobTitle !== undefined) data.jobTitle = body.jobTitle || null;
  if (body.graduationDate !== undefined) data.graduationDate = body.graduationDate ? new Date(body.graduationDate) : null;
  if (body.graduationReminderAt !== undefined) data.graduationReminderAt = body.graduationReminderAt ? new Date(body.graduationReminderAt) : null;

  if (session.user.role !== "REPRESENTATIVE") {
    if (body.stage !== undefined) data.stage = body.stage;
    if (body.importance !== undefined) data.importance = body.importance;
    if (body.ownerUserId !== undefined) data.ownerUserId = body.ownerUserId;
  }

  const profile = await prisma.crmCustomerProfile.update({
    where: { id },
    data,
    include: {
      sourceCustomer: {
        select: { id: true, name: true, customerCode: true, principal: true, email: true, wechat: true, organization: true, address: true },
      },
      ownerUser: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ profile });
}
