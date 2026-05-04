import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { ensureSalesUserForRepresentative } from "@/lib/representative-user";
import { getMagicLinkUrl } from "@/lib/app-url";

function generateToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

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

export async function GET() {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  const reps = await prisma.representative.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      archived: true,
      archivedAt: true,
      createdAt: true,
      _count: { select: { projects: true } },
    },
    orderBy: [
      { archived: "asc" },
      { createdAt: "desc" },
    ],
  });

  return NextResponse.json({ representatives: reps });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  const forbidden = await assertAdmin(session);
  if (forbidden) return forbidden;

  try {
    const body = await req.json();
    const { name, email } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json({ error: "姓名和邮箱不能为空" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already exists as a representative
    const existingRep = await prisma.representative.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingRep) {
      return NextResponse.json({ error: "该邮箱已是代表" }, { status: 409 });
    }

    // Pre-check: reject if a non-sales User owns this email
    const existingUser = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existingUser && !["REPRESENTATIVE", "REGIONAL_MANAGER"].includes(existingUser.role)) {
      return NextResponse.json({ error: "该邮箱已被其他类型用户使用，请联系管理员" }, { status: 409 });
    }

    const token = generateToken();
    const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 1 day

    const rep = await prisma.representative.create({
      data: {
        name: name.trim(),
        email: normalizedEmail,
        token,
        tokenExpiresAt,
      },
    });

    // Sync User record via shared helper (safe: pre-check passed)
    await ensureSalesUserForRepresentative({ email: normalizedEmail, name: name.trim() });

    // Send Magic Link email in background — token is already saved
    const magicLink = getMagicLinkUrl(token);
    sendMail({
      to: normalizedEmail,
      subject: "【SciManage】代表账号登录链接",
      text: `您好 ${rep.name}，\n\n您已被添加为 SciManage 项目代表。请点击以下链接登录系统（有效期 1 天）：\n\n${magicLink}\n\n---\nSciManage 科研项目管理平台`,
      html: `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
  <h2 style="color: #2563eb;">SciManage 代表登录</h2>
  <p>您好 <strong>${rep.name}</strong>，</p>
  <p>您已被添加为 SciManage 项目代表。</p>
  <p>请点击下方按钮登录系统（链接有效期 1 天）：</p>
  <a href="${magicLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">立即登录</a>
  <p style="color: #64748b; font-size: 12px;">如果按钮无法点击，请复制以下链接到浏览器打开：<br/>${magicLink}</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #64748b; font-size: 12px;">SciManage 科研项目管理平台</p>
</div>`,
    }).catch((err) => {
      console.error("[SMTP] Representative creation mail failed for", normalizedEmail, err);
    });

    const safeRep = { id: rep.id, name: rep.name, email: rep.email, archived: rep.archived, createdAt: rep.createdAt };

    return NextResponse.json(
      { representative: safeRep },
      { status: 201 },
    );
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create representative" }, { status: 500 });
  }
}
