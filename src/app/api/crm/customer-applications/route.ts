import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { isRepresentative } from "@/lib/permissions";
import { validateOrg, buildCustomerData } from "@/lib/crm/customer-application-review";
import { generateCustomerCode } from "@/lib/customer-code";

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
  const review = searchParams.get("review") || "";

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (review === "PENDING") {
    where.status = "APPROVED";
    where.adminReviewStatus = "PENDING";
  }

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

  // Resolve organization
  const rawOrgText = organizationRawInput?.trim() || organization?.trim() || null;
  const orgValidation = await validateOrg(organizationId || null, organizationSiteId || null, rawOrgText);
  if (orgValidation.error) {
    return NextResponse.json({ error: orgValidation.error }, { status: 400 });
  }

  const appData = {
    name: name.trim(),
    principal: principal?.trim() || null,
    email: email?.trim() || null,
    wechat: wechat?.trim() || null,
    organization: orgValidation.canonicalName || organization?.trim() || null,
    organizationId: orgValidation.organizationId || null,
    organizationSiteId: orgValidation.organizationSiteId || null,
    organizationRawInput: rawOrgText,
    address: address?.trim() || null,
    miniProgramId: miniProgramId?.trim() || null,
    notes: notes?.trim() || null,
  };

  const customerData = buildCustomerData(appData, orgValidation);
  const location = (typeof locationLat === "number" && typeof locationLng === "number")
    ? { lat: locationLat, lng: locationLng, address: locationAddress?.trim() || address?.trim() || "" }
    : null;

  // Auto-approve: create Customer + CrmCustomerProfile in a transaction
  let application: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const customerCode = await generateCustomerCode(tx);
        const customer = await tx.customer.create({
          data: { customerCode, ...customerData },
        });

        const profile = await tx.crmCustomerProfile.create({
          data: {
            sourceCustomerId: customer.id,
            ownerUserId: session.user.id,
            stage: "NEW",
            importance: "NORMAL",
            lastFollowUpAt: new Date(),
          },
        });

        if (location?.address?.trim()) {
          await tx.crmCustomerAddress.create({
            data: {
              profileId: profile.id,
              sourceType: "CUSTOMER_APPLICATION",
              addressText: location.address.trim(),
              lat: location.lat,
              lng: location.lng,
              isPrimary: true,
            },
          });
        }

        const app = await tx.crmCustomerApplication.create({
          data: {
            name: appData.name,
            principal: appData.principal,
            email: appData.email,
            wechat: appData.wechat,
            organization: appData.organization,
            organizationId: appData.organizationId,
            organizationSiteId: appData.organizationSiteId,
            organizationRawInput: appData.organizationRawInput,
            address: appData.address,
            miniProgramId: appData.miniProgramId,
            notes: appData.notes,
            locationLat: typeof locationLat === "number" ? locationLat : null,
            locationLng: typeof locationLng === "number" ? locationLng : null,
            locationAddress: locationAddress?.trim() || null,
            status: "APPROVED",
            autoApproved: true,
            autoApprovedAt: new Date(),
            adminReviewStatus: "PENDING",
            submittedByUserId: session.user.id,
            createdCustomerId: customer.id,
            createdCrmProfileId: profile.id,
          },
          include: applicationInclude,
        });

        // Notify all ADMINs
        const admins = await tx.user.findMany({
          where: { role: "ADMIN" },
          select: { id: true },
        });
        if (admins.length > 0) {
          await tx.notification.createMany({
            data: admins.map((a) => ({
              userId: a.id,
              type: "CRM_APPLICATION_REVIEW",
              title: "新客户申请待复核",
              content: `${appData.name} 的客户申请已自动通过，请复核`,
              link: `/crm/customer-applications?review=PENDING`,
              dedupeKey: `crm-application-review:${app.id}:${a.id}`,
            })),
          });
        }

        return app;
      });
      application = result;
      break;
    } catch (e: unknown) {
      const isPrismaUnique = typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "P2002";
      if (!isPrismaUnique || attempt === 2) {
        console.error("Auto-approve application error:", e);
        return NextResponse.json({ error: "申请提交失败" }, { status: 500 });
      }
    }
  }

  return NextResponse.json({ application }, { status: 201 });
}
