import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_MB = parseInt(process.env.CRM_VISIT_PHOTO_MAX_MB || "10", 10);

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]);

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  const checkinId = formData.get("checkinId") as string | null;

  if (!file || !checkinId) {
    return NextResponse.json({ error: "file and checkinId are required" }, { status: 400 });
  }

  if (file.size > MAX_MB * 1024 * 1024) {
    return NextResponse.json({ error: `文件大小不能超过 ${MAX_MB}MB` }, { status: 400 });
  }

  const ext = path.extname(file.name).toLowerCase() || ".jpg";
  if (!ALLOWED_EXT.has(ext)) {
    return NextResponse.json({ error: "仅支持 jpg/png/webp/heic 图片格式" }, { status: 400 });
  }
  if (file.type && !ALLOWED_MIME.has(file.type)) {
    return NextResponse.json({ error: "仅支持 jpg/png/webp/heic 图片格式" }, { status: 400 });
  }

  const checkin = await prisma.crmVisitCheckin.findUnique({ where: { id: checkinId } });
  if (!checkin) return NextResponse.json({ error: "Checkin not found" }, { status: 404 });
  if (checkin.userId !== session.user.id && session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const dir = path.join(process.cwd(), "public", "uploads", "crm", checkinId);
  await mkdir(dir, { recursive: true });

  const filename = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filepath = path.join(dir, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filepath, buffer);

  const url = `/uploads/crm/${checkinId}/${filename}`;

  const media = await prisma.crmVisitMedia.create({
    data: {
      checkinId,
      url,
      mimeType: file.type || "image/jpeg",
      size: file.size,
    },
  });

  await prisma.crmVisitCheckin.update({
    where: { id: checkinId },
    data: { photoCount: { increment: 1 } },
  });

  return NextResponse.json({ media }, { status: 201 });
}
