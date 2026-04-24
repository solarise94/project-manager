import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isRepresentative } from "@/lib/permissions";
import { resolveOrganization } from "@/lib/organization-resolver";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { query } = body;

    if (!query?.trim()) {
      return NextResponse.json({ error: "请输入单位名称" }, { status: 400 });
    }

    const result = await resolveOrganization(query.trim());

    return NextResponse.json(result);
  } catch (error) {
    console.error("Org search error:", error);
    const message = error instanceof Error ? error.message : "搜索失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
