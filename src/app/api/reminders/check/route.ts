import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { checkAndSendReminders, checkAndSendCrmFollowUpReminders } from "@/lib/reminder";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only allow admins to manually trigger reminder checks
  if (session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const [ticketCount, crmCount] = await Promise.all([
      checkAndSendReminders(),
      checkAndSendCrmFollowUpReminders(),
    ]);
    return NextResponse.json({ checked: ticketCount + crmCount, tickets: ticketCount, crmFollowUps: crmCount });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: "Failed to check reminders" }, { status: 500 });
  }
}
