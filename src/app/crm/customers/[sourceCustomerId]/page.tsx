"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StageBadge, ImportanceBadge, FollowUpStatusBadge, RelationTypeBadge } from "@/components/crm/badges";
import { InteractionFormDialog } from "@/components/crm/interaction-form-dialog";
import { FollowUpFormDialog } from "@/components/crm/follow-up-form-dialog";
import { CheckinFlow } from "@/components/crm/checkin-flow";
import { RelationFormDialog } from "@/components/crm/relation-form-dialog";
import { INTERACTION_TYPE_LABELS, ADDRESS_SOURCE_LABELS, RELATION_STRENGTH_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmInteractionItem, CrmVisitCheckinItem, CrmCustomerAddressItem, CrmRelationItem } from "@/lib/crm/types";
import { toast } from "sonner";
import { ArrowLeft, Phone, Mail, Building2, Pencil, Loader2, MessageSquare, MapPin, ClipboardCheck, Network } from "lucide-react";
import Link from "next/link";
import { useState, useCallback } from "react";
import { CustomerEditDialog } from "@/components/crm/customer-edit-dialog";

export default function CrmCustomerDetailPage() {
  const { status } = useSession();
  const router = useRouter();
  const { sourceCustomerId } = useParams<{ sourceCustomerId: string }>();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <CustomerDetail sourceCustomerId={sourceCustomerId} />;
}

function CustomerDetail({ sourceCustomerId }: { sourceCustomerId: string }) {
  const { data: session } = useSession();
  const [editOpen, setEditOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("overview");
  const [quickDialog, setQuickDialog] = useState<"interaction" | "checkin" | "followup" | null>(null);
  const clearQuickDialog = useCallback(() => setQuickDialog(null), []);
  const { data, isLoading } = useQuery({
    queryKey: crmKeys.profileByCustomer(sourceCustomerId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/profiles/by-customer/${sourceCustomerId}`);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("加载 CRM 档案失败");
      return res.json();
    },
    refetchOnMount: "always",
  });

  if (isLoading) return <div className="p-6">加载中...</div>;
  if (!data?.profile) return <div className="p-6">未找到 CRM 档案</div>;

  const profile = data.profile;
  const customer = profile.sourceCustomer;

  return (
    <div className="p-6 space-y-6 pb-20 max-w-full overflow-x-hidden">
      <div className="flex items-start gap-3">
        <Link href="/crm/customers">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1
            title={customer.name}
            className="max-w-full truncate font-bold leading-tight text-[clamp(1.125rem,5vw,1.5rem)] sm:text-2xl"
          >
            {customer.name}
          </h1>
          <div className="mt-1 text-xs text-muted-foreground truncate">
            {customer.customerCode}
            {customer.organization ? ` · ${customer.organization}` : ""}
          </div>
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto sm:mt-0 sm:overflow-visible">
        <StageBadge stage={profile.stage} />
        <ImportanceBadge importance={profile.importance} />
        {session?.user?.role === "ADMIN" && (
          <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
            <Pencil className="h-4 w-4 mr-1" />编辑客户
          </Button>
        )}
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <InfoItem icon={<Building2 className="h-4 w-4" />} label="单位" value={customer.organization} />
        <InfoItem icon={<Phone className="h-4 w-4" />} label="负责人" value={customer.principal} />
        <InfoItem icon={<Mail className="h-4 w-4" />} label="邮箱" value={customer.email} />
      </div>

      <div className="sticky top-0 z-10 bg-background border-b pb-2 mb-2 md:hidden">
        <div className="flex gap-2 overflow-x-auto">
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setQuickDialog("interaction")}>
            <MessageSquare className="h-4 w-4 mr-1" />沟通
          </Button>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setQuickDialog("checkin")}>
            <MapPin className="h-4 w-4 mr-1" />签到
          </Button>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setQuickDialog("followup")}>
            <ClipboardCheck className="h-4 w-4 mr-1" />跟进
          </Button>
          <Button size="sm" variant="outline" className="shrink-0" onClick={() => setActiveTab("relations")}>
            <Network className="h-4 w-4 mr-1" />关系
          </Button>
        </div>
      </div>

      {quickDialog === "interaction" && (
        <InteractionFormDialog
          profileId={profile.id}
          sourceCustomerId={sourceCustomerId}
          startOpen
          onClose={clearQuickDialog}
        />
      )}
      {quickDialog === "checkin" && (
        <CheckinFlow
          profileId={profile.id}
          sourceCustomerId={sourceCustomerId}
          autoStart
          onDone={clearQuickDialog}
        />
      )}
      {quickDialog === "followup" && (
        <FollowUpFormDialog
          profileId={profile.id}
          sourceCustomerId={sourceCustomerId}
          startOpen
          onClose={clearQuickDialog}
        />
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        {(() => {
          const crmDetailTabs = [
            { value: "overview", label: "概览" },
            { value: "interactions", label: `沟通记录 (${profile._count?.interactions || 0})` },
            { value: "checkins", label: `拜访签到 (${profile._count?.visitCheckins || 0})` },
            { value: "follow-ups", label: `跟进任务 (${profile._count?.followUpTasks || 0})` },
            { value: "addresses", label: `地址 (${profile._count?.addresses || 0})` },
            { value: "relations", label: "关系网络" },
          ];
          return (
            <>
              <div className="md:hidden">
                <Label className="text-xs text-muted-foreground">当前栏目</Label>
                <Select value={activeTab} onValueChange={(v) => setActiveTab(v || "overview")}>
                  <SelectTrigger className="mt-1 w-full">
                    <span>{crmDetailTabs.find((t) => t.value === activeTab)?.label}</span>
                  </SelectTrigger>
                  <SelectContent>
                    {crmDetailTabs.map((t) => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="hidden md:block">
                <TabsList className="grid w-full grid-cols-6">
                  <TabsTrigger value="overview">概览</TabsTrigger>
                  <TabsTrigger value="interactions">沟通记录 ({profile._count?.interactions || 0})</TabsTrigger>
                  <TabsTrigger value="checkins">拜访签到 ({profile._count?.visitCheckins || 0})</TabsTrigger>
                  <TabsTrigger value="follow-ups">跟进任务 ({profile._count?.followUpTasks || 0})</TabsTrigger>
                  <TabsTrigger value="addresses">地址 ({profile._count?.addresses || 0})</TabsTrigger>
                  <TabsTrigger value="relations">关系网络</TabsTrigger>
                </TabsList>
              </div>
            </>
          );
        })()}

        <TabsContent value="overview" className="space-y-4 mt-4">
          <OverviewTab profile={profile} sourceCustomerId={sourceCustomerId} />
        </TabsContent>

        <TabsContent value="interactions" className="space-y-4 mt-4">
          <InteractionsTab profileId={profile.id} interactions={profile.interactions} sourceCustomerId={sourceCustomerId} />
        </TabsContent>

        <TabsContent value="checkins" className="space-y-4 mt-4">
          <CheckinsTab profileId={profile.id} checkins={profile.visitCheckins} sourceCustomerId={sourceCustomerId} />
        </TabsContent>

        <TabsContent value="follow-ups" className="space-y-4 mt-4">
          <FollowUpsTab profileId={profile.id} tasks={profile.followUpTasks} profileName={customer.name} sourceCustomerId={sourceCustomerId} />
        </TabsContent>

        <TabsContent value="addresses" className="space-y-4 mt-4">
          <AddressesTab addresses={profile.addresses} />
        </TabsContent>

        <TabsContent value="relations" className="space-y-4 mt-4">
          <RelationsTab customerId={customer.id} customerName={customer.name} />
        </TabsContent>
      </Tabs>

      {session?.user?.role === "ADMIN" && (
        <CustomerEditDialog
          customerId={customer.id}
          sourceCustomerId={sourceCustomerId}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
    </div>
  );
}

function InfoItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | null }) {
  return (
    <div className="flex items-center gap-2 text-sm min-w-0">
      {icon}
      <span className="text-muted-foreground shrink-0">{label}:</span>
      <span className="truncate">{value || "-"}</span>
    </div>
  );
}

function OverviewTab({ profile, sourceCustomerId }: { profile: { id: string; ownerUser: { name: string }; lastFollowUpAt: string | null; nextFollowUpAt: string | null; summary: string | null }; sourceCustomerId: string }) {
  return (
    <div className="grid md:grid-cols-2 gap-4">
      <Card>
        <CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-muted-foreground">负责人</span><span>{profile.ownerUser.name}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">最近跟进</span><span>{profile.lastFollowUpAt ? new Date(profile.lastFollowUpAt).toLocaleDateString("zh-CN") : "-"}</span></div>
          <div className="flex justify-between"><span className="text-muted-foreground">下次跟进</span><span>{profile.nextFollowUpAt ? new Date(profile.nextFollowUpAt).toLocaleDateString("zh-CN") : "-"}</span></div>
          {profile.summary && <div className="pt-2 border-t"><p className="text-muted-foreground break-words">{profile.summary}</p></div>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="text-base">快捷操作</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <CheckinFlow profileId={profile.id} sourceCustomerId={sourceCustomerId} />
          <InteractionFormDialog profileId={profile.id} sourceCustomerId={sourceCustomerId} />
          <FollowUpFormDialog profileId={profile.id} sourceCustomerId={sourceCustomerId} />
        </CardContent>
      </Card>
    </div>
  );
}

function InteractionsTab({ profileId, interactions, sourceCustomerId }: { profileId: string; interactions: CrmInteractionItem[]; sourceCustomerId: string }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">沟通记录</h3>
        <InteractionFormDialog profileId={profileId} sourceCustomerId={sourceCustomerId} />
      </div>
      {interactions.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无沟通记录</p>
      ) : (
        <div className="space-y-3">
          {interactions.map((i) => (
            <Card key={i.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">{INTERACTION_TYPE_LABELS[i.type] || i.type}</span>
                  <span className="text-xs text-muted-foreground">{new Date(i.happenedAt).toLocaleString("zh-CN")}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{i.createdByUser.name}</span>
                </div>
                <p className="text-sm font-medium">{i.summary}</p>
                {i.detail && <p className="text-sm text-muted-foreground mt-1 break-words">{i.detail}</p>}
                {i.summaryTitle && <p className="text-sm font-medium mt-1">AI: {i.summaryTitle}</p>}
                {i.summaryNote && <p className="text-xs text-muted-foreground mt-0.5">{i.summaryNote}</p>}
                {i.transcript && (
                  <details className="mt-1">
                    <summary className="text-xs text-muted-foreground cursor-pointer">查看转写文本</summary>
                    <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 mt-1 max-h-24 overflow-y-auto">{i.transcript}</p>
                  </details>
                )}
                {i.asrStatus === "TRANSCRIBING" && <p className="text-xs text-muted-foreground mt-1"><Loader2 className="h-3 w-3 inline animate-spin mr-1" />识别中...</p>}
                {i.asrStatus === "FAILED" && <p className="text-xs text-red-500 mt-1">语音识别失败</p>}
                {i.voiceUrl && <span className="text-xs text-muted-foreground mt-1">· 有录音</span>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function NearbyPois({ lat, lng }: { lat: number; lng: number }) {
  const [enabled, setEnabled] = useState(false);
  const { data, isFetching, error } = useQuery({
    queryKey: ["reverse-geocode", lat, lng],
    queryFn: async () => {
      const res = await fetch("/api/crm/maps/reverse-geocode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lat, lng }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "请求失败");
      return json;
    },
    enabled,
    staleTime: Infinity,
    retry: false,
  });

  if (!enabled) {
    return (
      <button className="text-xs text-muted-foreground hover:text-foreground mt-1" onClick={() => setEnabled(true)}>
        查看附近地点
      </button>
    );
  }

  if (isFetching) {
    return <p className="text-xs text-muted-foreground mt-1">加载中...</p>;
  }

  if (error) {
    return <p className="text-xs text-red-500 mt-1">{error instanceof Error ? error.message : "请求失败"}</p>;
  }

  const result = data?.result;
  const pois = (result?.pois ?? []) as Array<{ name: string; distance: number }>;
  if (!result || (!result.formattedAddress && pois.length === 0)) {
    return <p className="text-xs text-muted-foreground mt-1">未找到附近地点</p>;
  }

  return (
    <div className="mt-1.5 space-y-1">
      {result.formattedAddress && (
        <p className="text-xs text-muted-foreground">推荐地址：{result.formattedAddress}</p>
      )}
      {pois.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <span>附近地点：</span>
          {pois.slice(0, 5).map((p, i) => (
            <span key={i}>
              {i > 0 && "、"}
              {p.name}
              {p.distance > 0 && <span className="text-muted-foreground/60">{Math.round(p.distance)}m</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function CheckinsTab({ profileId, checkins, sourceCustomerId }: { profileId: string; checkins: CrmVisitCheckinItem[]; sourceCustomerId: string }) {
  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">拜访签到</h3>
        <CheckinFlow profileId={profileId} sourceCustomerId={sourceCustomerId} />
      </div>
      {checkins.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无签到记录</p>
      ) : (
        <div className="space-y-3">
          {checkins.map((c) => (
            <Card key={c.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded ${c.status === "COMPLETED" ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-700"}`}>
                    {c.status === "COMPLETED" ? "已完成" : "草稿"}
                  </span>
                  <span className="text-xs text-muted-foreground">{new Date(c.createdAt).toLocaleString("zh-CN")}</span>
                  <span className="text-xs text-muted-foreground ml-auto">{c.user.name}</span>
                </div>
                {c.addressSnapshot && <p className="text-sm">{c.addressSnapshot}</p>}
                {c.lat != null && c.lng != null && <NearbyPois lat={c.lat} lng={c.lng} />}
                {c.voiceUrl && <p className="text-xs text-muted-foreground mt-1">历史录音（已迁移至沟通记录）</p>}
                <div className="text-xs text-muted-foreground mt-1">
                  {c.lat != null ? `${c.lat.toFixed(6)}, ${c.lng!.toFixed(6)}` : "无定位"}
                  {` · ${c.photoCount || 0} 张照片`}
                </div>
                {c.media?.length > 0 && (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {c.media.map((m) => (
                      <img key={m.id} src={m.url} alt="" className="h-16 w-16 object-cover rounded" />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpsTab({ profileId, tasks, profileName, sourceCustomerId }: { profileId: string; tasks: Array<{ id: string; title: string; dueAt: string; status: string; ownerUser: { name: string } }>; profileName: string; sourceCustomerId: string }) {
  const queryClient = useQueryClient();

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
    onSuccess: async () => {
      toast.success("任务已完成");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) }),
        queryClient.invalidateQueries({ queryKey: crmKeys.followUps() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.profiles() }),
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ]);
    },
  });

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">跟进任务</h3>
        <FollowUpFormDialog profileId={profileId} profileName={profileName} sourceCustomerId={sourceCustomerId} />
      </div>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无待处理跟进任务</p>
      ) : (
        <div className="space-y-3">
          {tasks.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-3 sm:pt-4 sm:flex sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground break-words sm:truncate">
                    截止: {new Date(t.dueAt).toLocaleString("zh-CN")}
                    {" · "}负责人: {t.ownerUser.name}
                  </p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-2 sm:mt-0 sm:justify-end">
                  <FollowUpStatusBadge status={t.status} />
                  {t.status === "OPEN" && (
                    <Button size="sm" variant="outline" onClick={() => completeMutation.mutate(t.id)} disabled={completeMutation.isPending}>
                      完成
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function AddressesTab({ addresses }: { addresses: CrmCustomerAddressItem[] }) {
  return (
    <div>
      <h3 className="font-medium mb-3">地址列表</h3>
      {addresses.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无地址记录</p>
      ) : (
        <div className="space-y-3">
          {addresses.map((a) => (
            <Card key={a.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  {a.isPrimary && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">主要</span>}
                  <span className="text-xs bg-muted px-2 py-0.5 rounded">{ADDRESS_SOURCE_LABELS[a.sourceType] || a.sourceType}</span>
                  <span className="text-sm font-medium">{a.label}</span>
                </div>
                <p className="text-sm break-words">{a.addressText || "-"}</p>
                {a.province && (
                  <p className="text-xs text-muted-foreground">{[a.province, a.city, a.district].filter(Boolean).join(" ")}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function RelationsTab({ customerId, customerName }: { customerId: string; customerName: string }) {
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: crmKeys.relations(customerId),
    queryFn: async () => {
      const res = await fetch(`/api/crm/relations?customerId=${customerId}`);
      return res.json();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ id }: { id: string; otherId: string }) => {
      const res = await fetch(`/api/crm/relations/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
    },
    onSuccess: async (_data, { otherId }) => {
      toast.success("关系已删除");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: crmKeys.relations(customerId) }),
        queryClient.invalidateQueries({ queryKey: crmKeys.relations(otherId) }),
        queryClient.invalidateQueries({ queryKey: crmKeys.relationsAll() }),
      ]);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const relations: CrmRelationItem[] = data?.relations || [];
  const referred = relations.filter((r) => r.type === "REFERRED" && r.fromCustomerId === customerId);
  const referredBy = relations.filter((r) => r.type === "REFERRED" && r.toCustomerId === customerId);
  const others = relations.filter((r) => r.type !== "REFERRED");

  const canManage = session?.user?.role === "ADMIN" || session?.user?.role === "USER";

  function RelationCard({ relation, otherCustomer }: { relation: CrmRelationItem; otherCustomer: { id: string; name: string; customerCode: string; organization?: string | null } }) {
    return (
      <Card key={relation.id}>
        <CardContent className="p-3 sm:pt-4 sm:flex sm:items-start sm:justify-between sm:gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <Link href={`/crm/customers/${otherCustomer.id}`} className="block truncate text-sm font-medium text-primary hover:underline">
              {otherCustomer.name}
            </Link>
            <div className="text-xs text-muted-foreground truncate">
              {otherCustomer.customerCode}
              {otherCustomer.organization ? ` · ${otherCustomer.organization}` : ""}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <RelationTypeBadge type={relation.type} />
              {relation.strength && (
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded shrink-0 whitespace-nowrap">{RELATION_STRENGTH_LABELS[relation.strength] || relation.strength}</span>
              )}
            </div>
            {relation.notes && <p className="text-xs text-muted-foreground break-words">{relation.notes}</p>}
            <p className="text-xs text-muted-foreground">
              {relation.introducedAt && `${new Date(relation.introducedAt).toLocaleDateString("zh-CN")} · `}
              {relation.createdByUser.name} 创建于 {new Date(relation.createdAt).toLocaleDateString("zh-CN")}
            </p>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" className="mt-3 w-full sm:mt-0 sm:w-auto text-red-500" onClick={() => deleteMutation.mutate({ id: relation.id, otherId: otherCustomer.id })} disabled={deleteMutation.isPending}>
              删除
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">加载中...</p>;

  return (
    <div>
      <div className="flex justify-between items-center mb-3">
        <h3 className="font-medium">关系网络</h3>
        {canManage && <RelationFormDialog currentCustomerId={customerId} currentCustomerName={customerName} />}
      </div>

      {relations.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无关系记录</p>
      ) : (
        <div className="space-y-4">
          {referred.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">介绍了 ({referred.length})</h4>
              <div className="space-y-2">
                {referred.map((r) => <RelationCard key={r.id} relation={r} otherCustomer={r.toCustomer} />)}
              </div>
            </div>
          )}
          {referredBy.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">被介绍 ({referredBy.length})</h4>
              <div className="space-y-2">
                {referredBy.map((r) => <RelationCard key={r.id} relation={r} otherCustomer={r.fromCustomer} />)}
              </div>
            </div>
          )}
          {others.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">其他关系 ({others.length})</h4>
              <div className="space-y-2">
                {others.map((r) => {
                  const other = r.fromCustomerId === customerId ? r.toCustomer : r.fromCustomer;
                  return <RelationCard key={r.id} relation={r} otherCustomer={other} />;
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
