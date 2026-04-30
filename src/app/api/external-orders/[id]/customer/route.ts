import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { generateCustomerCode } from "@/lib/customer-code";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role === "REPRESENTATIVE") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const order = await prisma.externalOrder.findUnique({ where: { id } });
  if (!order) return NextResponse.json({ error: "Order not found" }, { status: 404 });

  // Reject merged source orders
  if (order.duplicateStatus === "MERGED" || order.mergedIntoId) {
    return NextResponse.json({ error: "该订单已合并，请在主订单上处理客户" }, { status: 400 });
  }

  // Already bound — check if customer is still valid
  if (order.customerId) {
    const existingCustomer = await prisma.customer.findUnique({
      where: { id: order.customerId },
      select: { id: true, name: true, customerCode: true, deleted: true, mergedIntoId: true },
    });
    if (existingCustomer) {
      if (!existingCustomer.deleted) {
        return NextResponse.json({ customer: existingCustomer, order: { id: order.id, customerId: order.customerId } });
      }
      // Customer was soft-deleted: if merged, auto-follow to target; if not, clear binding
      if (existingCustomer.mergedIntoId) {
        const target = await prisma.customer.findUnique({
          where: { id: existingCustomer.mergedIntoId },
          select: { id: true, name: true, customerCode: true },
        });
        if (target) {
          await prisma.externalOrder.update({ where: { id }, data: { customerId: target.id } });
          return NextResponse.json({ customer: target, order: { id: order.id, customerId: target.id } });
        }
      }
      // Deleted with no target: clear the stale binding and allow re-bind
      await prisma.externalOrder.update({ where: { id }, data: { customerId: null } });
    }
    // Fall through to allow re-bind
  }

  const body = await req.json();
  const { mode, customerId, name, principal, wechat, address, organization } = body;

  if (mode === "bind") {
    if (!customerId) return NextResponse.json({ error: "customerId is required for bind mode" }, { status: 400 });

    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer || customer.deleted) {
      return NextResponse.json({ error: "Customer not found" }, { status: 404 });
    }

    const updated = await prisma.externalOrder.update({
      where: { id },
      data: { customerId },
      select: { id: true, customerId: true },
    });

    return NextResponse.json({ customer: { id: customer.id, name: customer.name, customerCode: customer.customerCode }, order: updated });
  }

  if (mode === "create") {
    // Create customer + bind order in a single transaction to avoid orphans
    const result = await prisma.$transaction(async (tx) => {
      let customerCode: string;
      for (let attempt = 0; attempt < 5; attempt++) {
        customerCode = await generateCustomerCode(tx);
        try {
          const customer = await tx.customer.create({
            data: {
              name: name || order.receiverName || "未知客户",
              customerCode,
              principal: principal || order.receiverPhone || null,
              wechat: wechat || null,
              address: address || order.receiverAddress || null,
              organization: organization || order.storeName || null,
            },
          });

          const updated = await tx.externalOrder.update({
            where: { id },
            data: { customerId: customer.id },
            select: { id: true, customerId: true },
          });

          return { customer, order: updated };
        } catch (err) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            continue; // retry with new code
          }
          throw err;
        }
      }
      throw new Error("Failed to generate unique customer code");
    });

    return NextResponse.json(result, { status: 201 });
  }

  return NextResponse.json({ error: "Invalid mode. Use 'create' or 'bind'." }, { status: 400 });
}
