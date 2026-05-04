import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isFinanceBlocked, getFinanceCustomerScopeWhere } from "@/lib/finance/permissions";
import { getCustomerFinanceList } from "@/lib/finance/calculations";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isFinanceBlocked(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get("pageSize") || "20", 10)));
  const search = url.searchParams.get("search")?.trim() || "";

  const customerScope = await getFinanceCustomerScopeWhere(session.user.id, session.user.role);
  const result = await getCustomerFinanceList(customerScope, page, pageSize, search || undefined);
  return NextResponse.json(result);
}
