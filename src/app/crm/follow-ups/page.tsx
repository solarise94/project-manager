"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FollowUpStatusBadge } from "@/components/crm/badges";
import { CrmEmptyState } from "@/components/crm/empty-state";
import type { CrmFollowUpTaskItem } from "@/lib/crm/types";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import Link from "next/link";
import { ClipboardCheck } from "lucide-react";

export default function CrmFollowUpsPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <FollowUpWorkbench />;
}

function FollowUpWorkbench() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ tasks: CrmFollowUpTaskItem[] }>({
    queryKey: crmKeys.followUps(),
    queryFn: () => fetch("/api/crm/follow-ups?status=OPEN").then((r) => r.json()),
  });

  const completeMutation = useMutation({
    mutationFn: async (taskId: string) => {
      const res = await fetch(`/api/crm/follow-ups/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "DONE" }),
      });
      if (!res.ok) throw new Error("操作失败");
      return res.json();
    },
    onSuccess: async (_data: unknown, taskId: string) => {
      toast.success("任务已完成");
      const task = tasks.find((t) => t.id === taskId);
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.followUps() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (task?.profile?.sourceCustomerId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(task.profile.sourceCustomerId) }));
      }
      await Promise.all(promises);
    },
  });

  const tasks = data?.tasks || [];
  const now = new Date();
  const overdue = tasks.filter((t) => new Date(t.dueAt) < now);
  const upcoming = tasks.filter((t) => new Date(t.dueAt) >= now);

  if (isLoading) return <div className="p-6">加载中...</div>;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">跟进工作台</h1>

      {overdue.length > 0 && (
        <div>
          <h2 className="text-sm font-medium text-red-600 mb-2">已逾期 ({overdue.length})</h2>
          <div className="space-y-2">
            {overdue.map((t) => (
              <TaskCard key={t.id} task={t} onComplete={() => completeMutation.mutate(t.id)} isPending={completeMutation.isPending} isOverdue />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">待处理 ({upcoming.length})</h2>
        {upcoming.length === 0 ? (
          <CrmEmptyState icon={ClipboardCheck} title="暂无待处理任务" />
        ) : (
          <div className="space-y-2">
            {upcoming.map((t) => (
              <TaskCard key={t.id} task={t} onComplete={() => completeMutation.mutate(t.id)} isPending={completeMutation.isPending} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onComplete, isPending, isOverdue }: { task: CrmFollowUpTaskItem; onComplete: () => void; isPending: boolean; isOverdue?: boolean }) {
  return (
    <Card className={isOverdue ? "border-red-200 border-l-4 border-l-red-500" : ""}>
      <CardContent className="pt-4 flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium truncate">{task.title}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            {task.profile && (
              <Link href={`/crm/customers/${task.profile.sourceCustomerId}`} className="text-primary hover:underline">
                {task.profile.sourceCustomer.name}
              </Link>
            )}
            <span>·</span>
            <span className={isOverdue ? "text-red-600 font-medium" : ""}>
              截止: {new Date(task.dueAt).toLocaleString("zh-CN")}
            </span>
            <span>·</span>
            <span>{task.ownerUser.name}</span>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <FollowUpStatusBadge status={task.status} />
          <Button size="default" variant="default" onClick={onComplete} disabled={isPending} className="min-w-[88px] h-10 md:h-9 md:text-sm">
            完成
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
