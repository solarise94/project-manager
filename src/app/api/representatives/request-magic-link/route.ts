import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendMail } from "@/lib/mail";
import { getMagicLinkUrl } from "@/lib/app-url";

function generateToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { email } = body;

    if (!email?.trim()) {
      return NextResponse.json({ error: "邮箱不能为空" }, { status: 400 });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const rep = await prisma.representative.findUnique({
      where: { email: normalizedEmail },
    });

    if (!rep) {
      // Don't reveal whether the email exists
      return NextResponse.json({ success: true });
    }

    if (rep.archived) {
      return NextResponse.json({ error: "该代表账号已归档，无法登录" }, { status: 403 });
    }

    // Reuse existing unexpired token; otherwise generate new one
    let token: string;
    let tokenExpiresAt: Date;
    if (rep.token && rep.tokenExpiresAt && rep.tokenExpiresAt > new Date(Date.now() + 60 * 60 * 1000)) {
      // Existing token still has >1h validity — reuse and resend
      token = rep.token;
      tokenExpiresAt = rep.tokenExpiresAt;
    } else {
      token = generateToken();
      tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await prisma.representative.update({
        where: { id: rep.id },
        data: { token, tokenExpiresAt },
      });
    }

    // Send email in background — token is already saved, delivery failure is non-fatal
    const magicLink = getMagicLinkUrl(token);
    sendMail({
      to: rep.email,
      subject: "【SciManage】代表账号登录链接",
      text: `您好 ${rep.name}，\n\n请使用以下链接登录 SciManage（有效期 1 天）：\n\n${magicLink}\n\n---\nSciManage 科研项目管理平台`,
      html: `<div style="font-family: sans-serif; max-width: 500px; margin: 0 auto;">
  <h2 style="color: #2563eb;">SciManage 代表登录</h2>
  <p>您好 <strong>${rep.name}</strong>，</p>
  <p>请使用以下链接登录系统（有效期 1 天）：</p>
  <a href="${magicLink}" style="display: inline-block; background: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; margin: 16px 0;">立即登录</a>
  <p style="color: #64748b; font-size: 12px;">如果按钮无法点击，请复制以下链接到浏览器打开：<br/>${magicLink}</p>
  <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0;" />
  <p style="color: #64748b; font-size: 12px;">SciManage 科研项目管理平台</p>
</div>`,
    }).catch((err) => {
      console.error("[SMTP] Magic link email failed for", rep.email, err);
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to send magic link" }, { status: 500 });
  }
}
