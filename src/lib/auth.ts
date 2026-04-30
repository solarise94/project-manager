import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import { ensureSalesUserForRepresentative } from "./representative-user";

const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_DURATION_MINUTES = 15;

async function checkLoginLock(identifier: string) {
  const record = await prisma.failedLoginAttempt.findUnique({
    where: { identifier },
  });
  if (!record) return { locked: false, remaining: MAX_LOGIN_ATTEMPTS, lockedUntil: null };

  if (record.lockedUntil && record.lockedUntil > new Date()) {
    return { locked: true, remaining: 0, lockedUntil: record.lockedUntil };
  }

  // Lock expired, clear it
  if (record.lockedUntil && record.lockedUntil <= new Date()) {
    await prisma.failedLoginAttempt.delete({ where: { identifier } });
    return { locked: false, remaining: MAX_LOGIN_ATTEMPTS, lockedUntil: null };
  }

  return {
    locked: false,
    remaining: Math.max(0, MAX_LOGIN_ATTEMPTS - record.attempts),
    lockedUntil: null,
  };
}

async function recordFailedLogin(identifier: string) {
  const record = await prisma.failedLoginAttempt.findUnique({
    where: { identifier },
  });

  if (!record) {
    await prisma.failedLoginAttempt.create({
      data: { identifier, attempts: 1, lastAttempt: new Date() },
    });
    return {
      locked: false,
      remaining: MAX_LOGIN_ATTEMPTS - 1,
      lockedUntil: null,
    };
  }

  const newAttempts = record.attempts + 1;
  const locked = newAttempts >= MAX_LOGIN_ATTEMPTS;
  const lockedUntil = locked
    ? new Date(Date.now() + LOCK_DURATION_MINUTES * 60 * 1000)
    : null;

  await prisma.failedLoginAttempt.update({
    where: { identifier },
    data: {
      attempts: newAttempts,
      lastAttempt: new Date(),
      lockedUntil,
    },
  });

  if (locked) {
    // Notify admins
    try {
      const { sendMail } = await import("./mail");
      const admins = await prisma.user.findMany({
        where: { role: "ADMIN" },
        select: { email: true, name: true },
      });
      for (const admin of admins) {
        if (admin.email) {
          await sendMail({
            to: admin.email,
            subject: "【SciManage 安全告警】登录异常锁定",
            text: `管理员 ${admin.name || ""} 您好，\n\n账号 ${identifier} 在 ${new Date().toLocaleString("zh-CN")} 因连续 ${MAX_LOGIN_ATTEMPTS} 次登录失败已被锁定 ${LOCK_DURATION_MINUTES} 分钟。\n\n如非本人操作，请注意检查系统安全。\n\n---\nSciManage`,
            html: `<p>管理员 <strong>${admin.name || ""}</strong> 您好，</p>
<p>账号 <strong>${identifier}</strong> 因连续 <strong>${MAX_LOGIN_ATTEMPTS}</strong> 次登录失败已被锁定 <strong>${LOCK_DURATION_MINUTES}</strong> 分钟。</p>
<p>锁定时间：${new Date().toLocaleString("zh-CN")}</p>
<p>如非本人操作，请注意检查系统安全。</p>
<hr />
<p style="color:#999;font-size:12px;">SciManage</p>`,
          }).catch(() => {});
        }
      }
    } catch {
      // Ignore admin notification errors
    }
  }

  return {
    locked,
    remaining: Math.max(0, MAX_LOGIN_ATTEMPTS - newAttempts),
    lockedUntil,
  };
}

async function clearFailedLogin(identifier: string) {
  await prisma.failedLoginAttempt.deleteMany({
    where: { identifier },
  });
}

export async function getLoginLockStatus(identifier: string) {
  return checkLoginLock(identifier);
}

export const authOptions: NextAuthOptions = {
  providers: [
    CredentialsProvider({
      id: "credentials",
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;

        const email = credentials.email.trim().toLowerCase();
        const identifier = email;

        // Check lock
        const lockStatus = await checkLoginLock(identifier);
        if (lockStatus.locked) {
          throw new Error(`LOCKED:${lockStatus.lockedUntil?.toISOString()}`);
        }

        const user = await prisma.user.findUnique({
          where: { email },
        });

        if (!user) {
          const result = await recordFailedLogin(identifier);
          if (result.locked) {
            throw new Error(`LOCKED:${result.lockedUntil!.toISOString()}`);
          }
          throw new Error(`INVALID:${result.remaining}`);
        }

        const isValid = await bcrypt.compare(credentials.password, user.password);
        if (!isValid) {
          const result = await recordFailedLogin(identifier);
          if (result.locked) {
            throw new Error(`LOCKED:${result.lockedUntil!.toISOString()}`);
          }
          throw new Error(`INVALID:${result.remaining}`);
        }

        // Success: clear failed attempts
        await clearFailedLogin(identifier);

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.avatar,
        };
      },
    }),
    CredentialsProvider({
      id: "representative",
      name: "representative",
      credentials: {
        token: { label: "Token", type: "text" },
      },
      async authorize(credentials) {
        if (!credentials?.token) return null;

        const rep = await prisma.representative.findUnique({
          where: { token: credentials.token },
        });

        if (!rep || !rep.tokenExpiresAt || rep.tokenExpiresAt < new Date()) {
          return null;
        }

        if (rep.archived) {
          throw new Error("ARCHIVED");
        }

        // Ensure corresponding User exists (shared helper)
        const { userId } = await ensureSalesUserForRepresentative(rep);

        // Consume token only on success
        await prisma.representative.update({
          where: { id: rep.id },
          data: { token: null, tokenExpiresAt: null },
        });

        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) throw new Error("User sync failed");

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: null,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role;
      }
      return token;
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/login",
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.NEXTAUTH_SECRET,
};

// Type augmentation
declare module "next-auth" {
  interface User {
    role: string;
  }
  interface Session {
    user: {
      id: string;
      role: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id: string;
    role: string;
  }
}
