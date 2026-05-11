"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RepresentativeReportPanel } from "@/components/crm/representative-report-panel";
import { Loader2 } from "lucide-react";

export default function MyReportPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  if (status === "loading") return <div className="p-6"><Loader2 className="h-4 w-4 animate-spin" /></div>;
  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (session?.user?.role !== "REPRESENTATIVE") { router.push("/crm"); return null; }

  return <MyReport />;
}

function MyReport() {
  const { data, isLoading } = useQuery<{ representativeId: string }>({
    queryKey: ["crm-my-rep-id"],
    queryFn: async () => {
      const res = await fetch("/api/crm/representatives/me");
      if (!res.ok) throw new Error("REPRESENTATIVE_NOT_FOUND");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">我的汇报</h1>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">我的汇报</h1>
        <div className="text-sm text-muted-foreground py-8 text-center">
          未找到关联的代表信息
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">我的汇报</h1>
      <RepresentativeReportPanel representativeId={data.representativeId} />
    </div>
  );
}
