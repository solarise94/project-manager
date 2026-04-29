import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

const MAX_MB = parseInt(process.env.CRM_VISIT_PHOTO_MAX_MB || "10", 10);

const ALLOWED_MIME_PREFIXES = ["image/", "audio/"];
const ALLOWED_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif", ".webm", ".ogg", ".mp3", ".m4a", ".wav", ".aac"]);

function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME_PREFIXES.some((prefix) => mime.startsWith(prefix));
}

function isAudioMime(mime: string): boolean {
  return mime.startsWith("audio/");
}

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
    return NextResponse.json({ error: "不支持的文件格式" }, { status: 400 });
  }
  const EXT_MIME: Record<string, string> = { ".webm": "audio/webm", ".ogg": "audio/ogg", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".aac": "audio/aac", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic", ".heif": "image/heif" };
  const mime = file.type || EXT_MIME[ext] || "application/octet-stream";
  if (mime && !isAllowedMime(mime)) {
    return NextResponse.json({ error: "不支持的文件格式" }, { status: 400 });
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
  const audio = isAudioMime(mime);

  if (audio) {
    // Audio: don't create CrmVisitMedia, don't increment photoCount
    return NextResponse.json({ media: { id: "", checkinId, url, mimeType: mime, size: file.size, createdAt: new Date().toISOString() }, audio: true }, { status: 201 });
  }

  const media = await prisma.crmVisitMedia.create({
    data: {
      checkinId,
      url,
      mimeType: mime,
      size: file.size,
    },
  });

  await prisma.crmVisitCheckin.update({
    where: { id: checkinId },
    data: { photoCount: { increment: 1 } },
  });

  return NextResponse.json({ media, audio: false }, { status: 201 });
}
