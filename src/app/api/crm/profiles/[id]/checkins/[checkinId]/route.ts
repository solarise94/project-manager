import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { validateCheckinVoiceUrl } from "@/lib/crm/media";
import { transitionCrmStage } from "@/lib/crm/lifecycle";

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

  // Accept voice URL (audio upload) — validate path and extension
  if (body.voiceUrl) {
    if (typeof body.voiceUrl !== "string" || !validateCheckinVoiceUrl(body.voiceUrl, checkinId)) {
      return NextResponse.json({ error: "无效的语音文件路径" }, { status: 400 });
    }
    data.voiceUrl = body.voiceUrl;
    if (!checkin.voiceUrl && checkin.asrStatus === "NONE") {
      data.asrStatus = "UPLOADED";
    }
  }

  if (body.status === "COMPLETED") {
    const hasGeo = checkin.lat != null && checkin.lng != null;
    const hasPhoto = checkin.media.length > 0;
    const hasValidVoice = !!(data.voiceUrl || (checkin.voiceUrl && validateCheckinVoiceUrl(checkin.voiceUrl, checkinId)));
    if (!hasGeo && !hasPhoto && !hasValidVoice) {
      return NextResponse.json(
        { error: "完成签到需要定位成功、至少上传1张照片或上传录音" },
        { status: 400 }
      );
    }
    data.status = "COMPLETED";
    data.completedAt = new Date();

    const now = new Date();
    const interaction = await prisma.crmInteraction.create({
      data: {
        profileId: checkin.profileId,
        type: "VISIT",
        summary: checkin.addressSnapshot ? `拜访签到: ${checkin.addressSnapshot}` : "拜访签到",
        createdByUserId: session.user.id,
        happenedAt: now,
      },
    });
    data.interactionId = interaction.id;

    // 统一阶段流转（替代直接更新 lastFollowUpAt）
    try {
      await transitionCrmStage(checkin.profileId, {
        type: "CHECKIN",
        happenedAt: now,
        checkinId: checkinId,
      });
    } catch (error) {
      console.error(`[CRM][CHECKIN] stage transition failed for profile ${checkin.profileId}:`, error);
    }
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
