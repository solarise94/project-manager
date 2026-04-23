import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validateUserInput, checkEmailConflict } from "@/lib/validation";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      emailOnReminder: true,
      emailOnStatusChange: true,
      emailOnTicketReply: true,
      emailOnComment: true,
    },
  });

  if (!user) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ user });
}

export async function PUT(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, email, currentPassword, newPassword, emailOnReminder, emailOnStatusChange, emailOnTicketReply, emailOnComment } = body;

    const existing = await prisma.user.findUnique({ where: { id: session.user.id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Validation
    const validation = validateUserInput({ name, email });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    if (email !== undefined) {
      const conflict = await checkEmailConflict(email, session.user.id);
      if (conflict.conflict) {
        return NextResponse.json({ error: conflict.error }, { status: conflict.status });
      }
    }

    const data: Record<string, unknown> = {};

    // Update basic info
    if (name !== undefined) data.name = name.trim();
    if (email !== undefined) data.email = email.trim().toLowerCase();

    // Update notification preferences
    if (emailOnReminder !== undefined) data.emailOnReminder = Boolean(emailOnReminder);
    if (emailOnStatusChange !== undefined) data.emailOnStatusChange = Boolean(emailOnStatusChange);
    if (emailOnTicketReply !== undefined) data.emailOnTicketReply = Boolean(emailOnTicketReply);
    if (emailOnComment !== undefined) data.emailOnComment = Boolean(emailOnComment);

    // Update password
    if (newPassword && newPassword.trim()) {
      if (!currentPassword) {
        return NextResponse.json({ error: "请提供当前密码" }, { status: 400 });
      }
      const isValid = await bcrypt.compare(currentPassword, existing.password);
      if (!isValid) {
        return NextResponse.json({ error: "当前密码不正确" }, { status: 400 });
      }
      data.password = await bcrypt.hash(newPassword.trim(), 10);
    }

    const updated = await prisma.user.update({
      where: { id: session.user.id },
      data,
    });

    return NextResponse.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        emailOnReminder: updated.emailOnReminder,
        emailOnStatusChange: updated.emailOnStatusChange,
        emailOnTicketReply: updated.emailOnTicketReply,
        emailOnComment: updated.emailOnComment,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update profile" }, { status: 500 });
  }
}
