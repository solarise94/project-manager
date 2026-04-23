import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getUserProjectIds } from "@/lib/permissions";
import type { Prisma } from "@prisma/client";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  const dateRange = searchParams.get("dateRange");
  const archived = searchParams.get("archived");
  const includeDeleted = searchParams.get("includeDeleted");

  const projectIds = await getUserProjectIds(session.user.id);
  if (projectIds.length === 0) return NextResponse.json({ projects: [] });

  const where: Prisma.ProjectWhereInput = {
    id: { in: projectIds },
  };

  if (includeDeleted === "true") {
    if (session.user.role !== "ADMIN") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    where.deleted = true;
  } else {
    where.deleted = false;
  }

  if (archived === "true") {
    where.archived = true;
  } else if (archived === "false") {
    where.archived = false;
  }

  if (status) {
    if (status.includes(",")) {
      where.status = { in: status.split(",") };
    } else {
      where.status = status;
    }
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { description: { contains: search } },
    ];
  }

  if (dateRange) {
    const now = new Date();
    const gte = new Date();
    switch (dateRange) {
      case "7d":
        gte.setDate(now.getDate() - 7);
        break;
      case "30d":
        gte.setDate(now.getDate() - 30);
        break;
      case "90d":
        gte.setDate(now.getDate() - 90);
        break;
      case "1y":
        gte.setFullYear(now.getFullYear() - 1);
        break;
    }
    where.createdAt = { gte };
  }

  const projects = await prisma.project.findMany({
    where,
    include: {
      members: {
        include: {
          user: {
            select: { id: true, name: true, email: true, avatar: true },
          },
        },
      },
      _count: {
        select: { tickets: true, comments: true },
      },
    },
    orderBy: [
      { deleted: "asc" },
      { archived: "asc" },
      { updatedAt: "desc" },
    ],
  });

  return NextResponse.json({ projects });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { name, description, orderNumber, organization, client, representative, status, startDate, endDate } = body;

    const project = await prisma.project.create({
      data: {
        name,
        description,
        orderNumber,
        organization,
        client,
        representative,
        status: status || "NOT_STARTED",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        members: {
          create: {
            userId: session.user.id,
            role: "OWNER",
          },
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        type: "PROJECT_CREATED",
        content: `创建了项目 "${name}"`,
        projectId: project.id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ project }, { status: 201 });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to create project" }, { status: 500 });
  }
}
