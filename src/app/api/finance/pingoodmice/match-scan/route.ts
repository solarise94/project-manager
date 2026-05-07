import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { matchSourceOrders } from "@/lib/finance/pingoodmice-match";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = req.nextUrl;
  const source = url.searchParams.get("source")?.trim() || "PINGOODMICE";

  let body: { orderIds?: string[] } = {};
  try { body = await req.json(); } catch {}

  const result = await matchSourceOrders(source, body.orderIds);
  return NextResponse.json(result);
}
