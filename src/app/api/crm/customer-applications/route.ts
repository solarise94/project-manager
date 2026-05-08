import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";

const applicationInclude = {
  submittedByUser: { select: { id: true, name: true, email: true } },
  reviewedByUser: { select: { id: true, name: true } },
  createdCustomer: { select: { id: true, name: true, customerCode: true } },
  createdCrmProfile: { select: { id: true, sourceCustomerId: true } },
};

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status") || "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;

  if (isRepresentative(session.user.role)) {
    where.submittedByUserId = session.user.id;
  }

  const applications = await prisma.crmCustomerApplication.findMany({
    where,
    include: applicationInclude,
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ applications });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const {
    name, principal, email, wechat, organization,
    organizationId, organizationSiteId, organizationRawInput, address, miniProgramId, notes,
    locationLat, locationLng, locationAddress,
  } = body;

  if (!name?.trim()) {
    return NextResponse.json({ error: "客户姓名为必填项" }, { status: 400 });
  }

  const application = await prisma.crmCustomerApplication.create({
    data: {
      name: name.trim(),
      principal: principal?.trim() || null,
      email: email?.trim() || null,
      wechat: wechat?.trim() || null,
      organization: organization?.trim() || null,
      organizationId: organizationId || null,
      organizationSiteId: organizationSiteId || null,
      organizationRawInput: organizationRawInput?.trim() || null,
      address: address?.trim() || null,
      miniProgramId: miniProgramId?.trim() || null,
      notes: notes?.trim() || null,
      locationLat: typeof locationLat === "number" ? locationLat : null,
      locationLng: typeof locationLng === "number" ? locationLng : null,
      locationAddress: locationAddress?.trim() || null,
      status: "PENDING",
      submittedByUserId: session.user.id,
    },
    include: applicationInclude,
  });

  return NextResponse.json({ application }, { status: 201 });
}
