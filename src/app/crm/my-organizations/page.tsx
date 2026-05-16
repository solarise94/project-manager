"use client";

import { useState, useMemo } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Loader2, Send, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { OrganizationSelect } from "@/components/organization-select";
import { toast } from "sonner";

interface RepBinding {
  id: string;
  status: string;
  organizationId: string | null;
  requestedOrganizationName: string | null;
  reviewNote: string | null;
  createdAt: string;
  organization: {
    id: string;
    canonicalName: string;
    address: string | null;
  } | null;
}

export default function MyOrganizationsPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") {
    router.push("/login");
    return null;
  }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <MyOrganizations />;
}

function MyOrganizations() {
  const { data: session } = useSession();
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState<string>("");
  const [selectedOrgName, setSelectedOrgName] = useState("");
  const [showRejected, setShowRejected] = useState(false);

  const isRep = session?.user?.role === "REPRESENTATIVE";

  const { data, isLoading } = useQuery<{ bindings: RepBinding[] }>({
    queryKey: ["representative-organizations", "self"],
    queryFn: async () => {
      const res = await fetch("/api/crm/representative-organizations");
      if (!res.ok) throw new Error("加载失败");
      return res.json();
    },
    enabled: isRep,
  });

  const excludedOrgIds = useMemo(() => {
    return (data?.bindings || [])
      .filter((b) => b.organizationId && (b.status === "ACTIVE" || b.status === "PENDING"))
      .map((b) => b.organizationId!);
  }, [data]);

  const requestMutation = useMutation({
    mutationFn: async (payload: { organizationId?: string; canonicalName?: string }) => {
      const res = await fetch("/api/crm/representative-organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        const err = new Error(json.error || "申请失败") as Error & { status?: number };
        err.status = res.status;
        throw err;
      }
      return json;
    },
    onSuccess: () => {
      toast.success("绑定申请已提交，等待审核");
      setSelectedOrgId("");
      setSelectedOrgName("");
      queryClient.invalidateQueries({ queryKey: ["representative-organizations", "self"] });
    },
    onError: (err: Error & { status?: number }) => {
      if (err.status === 409) {
        toast.info("该单位已有绑定申请或绑定记录");
      } else {
        toast.error(err.message);
      }
    },
  });

  if (!isRep) {
    return <div className="p-6">此页面仅对代表开放。</div>;
  }

  const bindings = data?.bindings || [];
  const active = bindings.filter((b) => b.status === "ACTIVE");
  const pending = bindings.filter((b) => b.status === "PENDING");
  const rejected = bindings.filter((b) => b.status === "REJECTED");

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold">我的单位</h1>
        <p className="text-sm text-muted-foreground mt-1">
          管理已绑定的单位，或申请绑定新单位
        </p>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <div className="flex-1">
            <OrganizationSelect
              value={selectedOrgId}
              displayValue={selectedOrgName || undefined}
              excludeIds={excludedOrgIds}
              showAllOrgs
              onChange={(id, name) => {
                setSelectedOrgId(id || "");
                setSelectedOrgName(name);
              }}
            />
          </div>
          <Button
            disabled={!selectedOrgName.trim() || requestMutation.isPending}
            onClick={() => {
              if (!selectedOrgName.trim()) return;
              if (selectedOrgId) {
                requestMutation.mutate({ organizationId: selectedOrgId });
              } else {
                requestMutation.mutate({ canonicalName: selectedOrgName.trim() });
              }
            }}
          >
            {requestMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span className="ml-2">申请绑定</span>
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          从机构库中选择已有单位，或搜索后快速创建新单位
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              已绑定 ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无已绑定单位</p>
            ) : (
              <div className="grid gap-2">
                {active.map((b) => (
                  <Card key={b.id}>
                    <CardContent className="flex items-center gap-3 p-3">
                      <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {b.organization?.canonicalName || b.requestedOrganizationName}
                        </p>
                        {b.organization?.address && (
                          <p className="text-xs text-muted-foreground truncate">
                            {b.organization.address}
                          </p>
                        )}
                      </div>
                      <Badge variant="default">已绑定</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </section>

          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-medium text-muted-foreground">
                待审核 ({pending.length})
              </h2>
              <div className="grid gap-2">
                {pending.map((b) => (
                  <Card key={b.id}>
                    <CardContent className="flex items-center gap-3 p-3">
                      <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">
                          {b.organization?.canonicalName || b.requestedOrganizationName || "未命名"}
                        </p>
                      </div>
                      <Badge variant="secondary">审核中</Badge>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {rejected.length > 0 && (
            <section className="space-y-3">
              <button
                type="button"
                className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
                onClick={() => setShowRejected(!showRejected)}
              >
                <ChevronDown className={`h-4 w-4 transition-transform ${showRejected ? "rotate-180" : ""}`} />
                已拒绝 ({rejected.length})
              </button>
              {showRejected && (
                <div className="grid gap-2">
                  {rejected.map((b) => (
                    <Card key={b.id} className="border-destructive/30">
                      <CardContent className="flex items-start gap-3 p-3">
                        <Building2 className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
                        <div className="min-w-0 flex-1">
                          <p className="font-medium truncate">
                            {b.organization?.canonicalName || b.requestedOrganizationName || "未命名"}
                          </p>
                          {b.reviewNote && (
                            <p className="text-xs text-destructive mt-1">
                              拒绝原因: {b.reviewNote}
                            </p>
                          )}
                        </div>
                        <Badge variant="destructive">已拒绝</Badge>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
