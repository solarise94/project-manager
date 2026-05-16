import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canContributeProject, isRepresentative } from "@/lib/permissions";
import { writeFile } from "fs/promises";
import { mkdir } from "fs/promises";
import path from "path";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden: representatives cannot upload files" }, { status: 403 });
  }

  const { id } = await params;

  const project = await prisma.project.findUnique({ where: { id } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  if (project.deleted) return NextResponse.json({ error: "项目已删除，无法上传文件" }, { status: 400 });

  if (session.user.role !== "ADMIN") {
    const canContribute = await canContributeProject(id, session.user.id, session.user.role);
    if (!canContribute) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const uploadDir = path.join(process.cwd(), "public", "uploads", id);
    await mkdir(uploadDir, { recursive: true });

    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, "_");
    const filename = `${timestamp}_${safeName}`;
    const filePath = path.join(uploadDir, filename);

    await writeFile(filePath, buffer);

    const url = `/uploads/${id}/${filename}`;

    const attachment = await prisma.attachment.create({
      data: {
        filename: file.name,
        url,
        size: file.size,
        mimeType: file.type,
        projectId: id,
      },
    });

    await prisma.activityLog.create({
      data: {
        type: "FILE_UPLOADED",
        content: `上传了文件 "${file.name}"`,
        metadata: JSON.stringify({ filename: file.name, url, size: file.size }),
        projectId: id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ attachment }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to upload file" }, { status: 500 });
  }
}
