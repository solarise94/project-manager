import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { validateUserInput, checkEmailConflict } from "@/lib/validation";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Always verify ADMIN role from the database, not the cached JWT token
  const currentUser = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { role: true },
  });
  if (currentUser?.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  try {
    const body = await req.json();
    const { name, email, role, password } = body;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Representative accounts are managed exclusively via /admin/representatives
    if (existing.role === "REPRESENTATIVE") {
      return NextResponse.json(
        { error: "代表账号请在「代表管理」中维护" },
        { status: 403 },
      );
    }

    // Validation
    const validation = validateUserInput({ name, email });
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: validation.status });
    }

    if (email !== undefined) {
      const conflict = await checkEmailConflict(email, id);
      if (conflict.conflict) {
        return NextResponse.json({ error: conflict.error }, { status: conflict.status });
      }
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (email !== undefined) data.email = email.trim().toLowerCase();
    if (role !== undefined) data.role = role;
    if (password && password.trim()) {
      data.password = await bcrypt.hash(password.trim(), 10);
    }

    const updated = await prisma.user.update({ where: { id }, data });

    return NextResponse.json({
      user: {
        id: updated.id,
        name: updated.name,
        email: updated.email,
        role: updated.role,
        createdAt: updated.createdAt,
      },
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to update user" }, { status: 500 });
  }
}
