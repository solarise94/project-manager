import { NextResponse } from "next/server";
import { getRuntimeInfo } from "@/lib/runtime-info";

export async function GET(request: Request) {
  if (request.headers.get("x-runtime-debug") !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(getRuntimeInfo(), {
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
