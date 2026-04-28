import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; checkinId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { checkinId } = await params;

  const checkin = await prisma.crmVisitCheckin.findUnique({
    where: { id: checkinId },
    include: { media: true },
  });
  if (!checkin) return NextResponse.json({ error: "Checkin not found" }, { status: 404 });
  if (checkin.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.status === "COMPLETED") {
    const hasGeo = checkin.lat != null && checkin.lng != null;
    const hasPhoto = checkin.media.length > 0;
    if (!hasGeo && !hasPhoto) {
      return NextResponse.json(
        { error: "完成签到需要定位成功或至少上传1张照片" },
        { status: 400 }
      );
    }
    data.status = "COMPLETED";
    data.completedAt = new Date();

    const interaction = await prisma.crmInteraction.create({
      data: {
        profileId: checkin.profileId,
        type: "VISIT",
        summary: checkin.addressSnapshot ? `拜访签到: ${checkin.addressSnapshot}` : "拜访签到",
        createdByUserId: session.user.id,
        happenedAt: new Date(),
      },
    });
    data.interactionId = interaction.id;

    await prisma.crmCustomerProfile.update({
      where: { id: checkin.profileId },
      data: { lastFollowUpAt: new Date() },
    });
  }

  const updated = await prisma.crmVisitCheckin.update({
    where: { id: checkinId },
    data,
    include: {
      media: true,
      user: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ checkin: updated });
}
