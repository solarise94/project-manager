import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere } from "@/lib/finance/permissions";
import { getCustomerFinanceDetail } from "@/lib/finance/calculations";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ customerId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { customerId } = await params;

  if (session.user.role !== "ADMIN") {
    const scope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);
    if (scope && !scope.id.in.includes(customerId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
  }

  const detail = await getCustomerFinanceDetail(customerId);
  if (!detail) return NextResponse.json({ error: "Not Found" }, { status: 404 });
  return NextResponse.json(detail);
}
