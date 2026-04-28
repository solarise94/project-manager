import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const reps = await prisma.representative.findMany({
    where: { archived: false },
    select: { id: true, name: true, email: true },
  });

  const repEmails = reps.map((r) => r.email);
  const repUsers = await prisma.user.findMany({
    where: { email: { in: repEmails } },
    select: { id: true, name: true, email: true },
  });

  const emailToUser = new Map(repUsers.map((u) => [u.email, u]));

  const assignees: Array<{
    userId: string;
    name: string;
    email: string;
    kind: "self" | "representative";
    representativeId?: string;
  }> = [
    {
      userId: session.user.id,
      name: session.user.name || "我",
      email: session.user.email || "",
      kind: "self",
    },
  ];

  for (const rep of reps) {
    const user = emailToUser.get(rep.email);
    if (!user) continue;
    if (user.id === session.user.id) continue;
    assignees.push({
      userId: user.id,
      name: rep.name,
      email: rep.email,
      kind: "representative",
      representativeId: rep.id,
    });
  }

  return NextResponse.json({ assignees });
}
