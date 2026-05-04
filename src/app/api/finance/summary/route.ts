import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere, getFinanceProjectScopeWhere } from "@/lib/finance/permissions";
import { getFinanceSummary } from "@/lib/finance/calculations";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const customerScope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);
  const projectScope = await getFinanceProjectScopeWhere(session.user.id, session.user.role);
  const summary = await getFinanceSummary(customerScope, projectScope);
  return NextResponse.json(summary);
}
