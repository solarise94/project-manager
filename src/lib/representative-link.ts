import { prisma } from "./prisma";

function generateToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

function getMagicLink(token: string, redirect?: string) {
  const base = process.env.NEXTAUTH_URL || "";
  const url = new URL("/magic-link", base);
  url.searchParams.set("token", token);
  if (redirect) url.searchParams.set("redirect", redirect);
  return url.toString();
}

export async function generateRepresentativeLoginLink(
  email: string,
  redirect?: string
): Promise<{ magicLink: string | null; isRepresentative: boolean }> {
  const rep = await prisma.representative.findUnique({
    where: { email },
  });

  if (!rep) {
    return { magicLink: null, isRepresentative: false };
  }

  if (rep.archived) {
    return { magicLink: null, isRepresentative: true };
  }

  const token = generateToken();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.representative.update({
    where: { id: rep.id },
    data: { token, tokenExpiresAt },
  });

  const magicLink = getMagicLink(token, redirect);
  return { magicLink, isRepresentative: true };
}

export async function notifyRepresentative(
  repEmail: string,
  redirect: string,
  notifications: Array<{ subject: string; text: string; html: string }>
): Promise<{ ok: boolean; results: PromiseSettledResult<{ messageId: string }>[] }> {
  const rep = await prisma.representative.findUnique({
    where: { email: repEmail },
  });

  if (!rep || rep.archived) {
    return { ok: false, results: [] };
  }

  const oldToken = rep.token;
  const oldTokenExpiresAt = rep.tokenExpiresAt;

  const token = generateToken();
  const tokenExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.representative.update({
    where: { id: rep.id },
    data: { token, tokenExpiresAt },
  });

  const magicLink = getMagicLink(token, redirect);

  const { sendMail } = await import("./mail");
  const results = await Promise.allSettled(
    notifications.map((n) =>
      sendMail({
        to: rep.email,
        subject: n.subject,
        text: n.text,
        html: appendLoginLinkToEmail(n.html, magicLink),
      })
    )
  );

  const allFailed = results.every((r) => r.status === "rejected");
  if (allFailed) {
    await prisma.representative.update({
      where: { id: rep.id },
      data: { token: oldToken, tokenExpiresAt: oldTokenExpiresAt },
    });
    return { ok: false, results };
  }

  return { ok: true, results };
}

export function appendLoginLinkToEmail(
  html: string,
  magicLink: string | null
): string {
  if (!magicLink) return html;

  const loginSection = `
<div style="margin-top: 24px; padding: 16px; background: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
  <p style="margin: 0 0 8px 0; font-size: 14px; color: #0369a1;">👋 代表快捷登录</p>
  <p style="margin: 0 0 12px 0; font-size: 13px; color: #334155;">作为项目代表，您可以点击下方按钮直接登录查看，无需输入密码：</p>
  <a href="${magicLink}" style="display: inline-block; background: #0284c7; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-size: 14px;">一键登录查看</a>
  <p style="margin: 8px 0 0 0; font-size: 11px; color: #64748b;">链接有效期 1 天</p>
</div>`;

  // Insert before the closing </div> or at the end
  if (html.includes("</div>")) {
    const lastDiv = html.lastIndexOf("</div>");
    return html.slice(0, lastDiv) + loginSection + html.slice(lastDiv);
  }
  return html + loginSection;
}
