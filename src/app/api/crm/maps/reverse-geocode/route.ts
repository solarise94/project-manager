import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { reverseGeocode } from "@/lib/crm/geocode";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const { lat, lng } = body;

  if (lat == null || lng == null) {
    return NextResponse.json({ error: "lat and lng are required" }, { status: 400 });
  }

  const result = await reverseGeocode(lat, lng);
  if (!result) {
    return NextResponse.json({ error: "Geocode failed" }, { status: 502 });
  }

  return NextResponse.json({ result: { address: result.address, province: result.province, city: result.city, district: result.district } });
}
