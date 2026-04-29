"use client";

import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StageBadge, ImportanceBadge, FollowUpStatusBadge, RelationTypeBadge } from "@/components/crm/badges";
import { InteractionFormDialog } from "@/components/crm/interaction-form-dialog";
import { FollowUpFormDialog } from "@/components/crm/follow-up-form-dialog";
import { CheckinFlow } from "@/components/crm/checkin-flow";
import { RelationFormDialog } from "@/components/crm/relation-form-dialog";
import { INTERACTION_TYPE_LABELS, ADDRESS_SOURCE_LABELS, RELATION_STRENGTH_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmInteractionItem, CrmVisitCheckinItem, CrmCustomerAddressItem, CrmRelationItem } from "@/lib/crm/types";
import { toast } from "sonner";
import { ArrowLeft, Phone, Mail, Building2, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
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
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/crm/customers">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{customer.name}</h1>
          <p className="text-sm text-muted-foreground">{customer.customerCode}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <StageBadge stage={profile.stage} />
          <ImportanceBadge importance={profile.importance} />
          {session?.user?.role === "ADMIN" && (
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4 mr-1" />编辑客户
            </Button>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <InfoItem icon={<Building2 className="h-4 w-4" />} label="单位" value={customer.organization} />
        <InfoItem icon={<Phone className="h-4 w-4" />} label="负责人" value={customer.principal} />
        <InfoItem icon={<Mail className="h-4 w-4" />} label="邮箱" value={customer.email} />
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="interactions">沟通记录 ({profile._count?.interactions || 0})</TabsTrigger>
          <TabsTrigger value="checkins">拜访签到 ({profile._count?.visitCheckins || 0})</TabsTrigger>
          <TabsTrigger value="follow-ups">跟进任务 ({profile._count?.followUpTasks || 0})</TabsTrigger>
          <TabsTrigger value="addresses">地址 ({profile._count?.addresses || 0})</TabsTrigger>
          <TabsTrigger value="relations">关系网络</TabsTrigger>
        </TabsList>

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
    <div className="flex items-center gap-2 text-sm">
      {icon}
      <span className="text-muted-foreground">{label}:</span>
      <span>{value || "-"}</span>
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
          {profile.summary && <div className="pt-2 border-t"><p className="text-muted-foreground">{profile.summary}</p></div>}
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
                {i.detail && <p className="text-sm text-muted-foreground mt-1">{i.detail}</p>}
              </CardContent>
            </Card>
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
              <CardContent className="pt-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{t.title}</p>
                  <p className="text-xs text-muted-foreground">
                    截止: {new Date(t.dueAt).toLocaleString("zh-CN")}
                    {" · "}负责人: {t.ownerUser.name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
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
                <p className="text-sm">{a.addressText || "-"}</p>
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
        <CardContent className="pt-4 flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Link href={`/crm/customers/${otherCustomer.id}`} className="text-sm font-medium text-primary hover:underline">
                {otherCustomer.name}
              </Link>
              <span className="text-xs text-muted-foreground">({otherCustomer.customerCode})</span>
              <RelationTypeBadge type={relation.type} />
              {relation.strength && (
                <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{RELATION_STRENGTH_LABELS[relation.strength] || relation.strength}</span>
              )}
            </div>
            {otherCustomer.organization && <p className="text-xs text-muted-foreground">{otherCustomer.organization}</p>}
            {relation.notes && <p className="text-xs text-muted-foreground mt-1">{relation.notes}</p>}
            <p className="text-xs text-muted-foreground mt-1">
              {relation.introducedAt && `${new Date(relation.introducedAt).toLocaleDateString("zh-CN")} · `}
              {relation.createdByUser.name} 创建于 {new Date(relation.createdAt).toLocaleDateString("zh-CN")}
            </p>
          </div>
          {canManage && (
            <Button variant="ghost" size="sm" className="text-red-500" onClick={() => deleteMutation.mutate({ id: relation.id, otherId: otherCustomer.id })} disabled={deleteMutation.isPending}>
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
