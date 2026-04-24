import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative, getRepresentativeProjectIds } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    const projectIds = await getRepresentativeProjectIds(session.user.id);
    const projects = await prisma.project.findMany({
      where: { id: { in: projectIds }, customerId: { not: null } },
      select: { customerId: true },
    });
    const customerIds = [...new Set(projects.map((p) => p.customerId!))];

    const customers = await prisma.customer.findMany({
      where: { id: { in: customerIds }, deleted: false, archived: false },
      select: { id: true, customerCode: true, name: true, organization: true },
      orderBy: { name: "asc" },
    });
    return NextResponse.json({ customers });
  }

  const customers = await prisma.customer.findMany({
    where: { deleted: false, archived: false },
    select: { id: true, customerCode: true, name: true, organization: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json({ customers });
}
