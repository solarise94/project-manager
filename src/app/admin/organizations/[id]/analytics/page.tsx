"use client";

import { Suspense, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter, useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StageBadge, ImportanceBadge, PersonCategoryBadge } from "@/components/crm/badges";
import { INTERACTION_TYPE_LABELS, SITE_TYPE_LABELS } from "@/lib/crm/constants";
import { ArrowLeft, Users, Building2, MapPin, Tag } from "lucide-react";
import Link from "next/link";

interface OrgDetail {
  organization: {
    id: string;
    orgCode: string;
    canonicalName: string;
    address: string | null;
    taxId: string | null;
    aliases: Array<{ id: string; alias: string; aliasType: string }>;
    sites: Array<{ id: string; siteName: string; siteType: string; address: string | null }>;
    customerCount: number;
    crmProfileCount: number;
  };
  customerSummary: Array<{
    customerId: string;
    customerName: string;
    customerCode: string;
    principal: string | null;
    labOrGroup: string | null;
    stage: string;
    importance: string;
    personCategory: string | null;
    ownerName: string;
    siteName: string | null;
    siteType: string | null;
  }>;
  representativeBreakdown: Array<{
    representativeId: string;
    name: string;
    email: string;
    profileCount: number;
    interactionCount: number;
    checkinCount: number;
    lastCheckinAt: string | null;
  }>;
  recentInteractions: Array<{
    id: string;
    type: string;
    summary: string;
    happenedAt: string;
    profile: { id: string; sourceCustomer: { name: string } };
    createdByUser: { name: string };
  }>;
  recentCheckins: Array<{
    id: string;
    summaryTitle: string | null;
    addressSnapshot: string | null;
    createdAt: string;
    user: { name: string };
  }>;
  distributions: {
    stage: Record<string, number>;
    importance: Record<string, number>;
    personCategory: Record<string, number>;
  };
}

export default function OrgAnalyticsDetailPage() {
  return (
    <Suspense fallback={<div className="p-6">加载中...</div>}>
      <OrgAnalyticsDetail />
    </Suspense>
  );
}

function OrgAnalyticsDetail() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const params = useParams();
  const orgId = params.id as string;

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/dashboard");
    }
  }, [status, session, router]);

  const { data, isLoading } = useQuery<OrgDetail>({
    queryKey: ["org-analytics-detail", orgId],
    queryFn: () => fetch(`/api/crm/organization-analytics/${orgId}`).then((r) => r.json()),
    enabled: status === "authenticated" && session?.user?.role === "ADMIN",
  });

  if (status === "loading") return null;
  if (!session || session.user.role !== "ADMIN") return null;

  if (isLoading) return <div className="p-6 space-y-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 bg-muted animate-pulse rounded" />)}</div>;

  const d = data;

  return (
    <div className="p-6 space-y-6 pb-20 max-w-full overflow-x-hidden">
      <div className="flex items-center gap-3">
        <Link href="/admin/organizations/analytics" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" />返回分析
        </Link>
      </div>

      {/* Top stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatBlock label="总客户" value={d?.organization.customerCount ?? 0} />
        <StatBlock label="CRM客户" value={d?.organization.crmProfileCount ?? 0} />
        <StatBlock label="覆盖代表" value={d ? d.representativeBreakdown.length : 0} />
        <StatBlock label="30天沟通" value={d?.representativeBreakdown.reduce((s, r) => s + r.interactionCount, 0) ?? 0} />
        <StatBlock label="30天签到" value={d?.representativeBreakdown.reduce((s, r) => s + r.checkinCount, 0) ?? 0} />
        <StatBlock label="最近活动" value={d?.recentInteractions[0] ? new Date(d.recentInteractions[0].happenedAt).toLocaleDateString("zh-CN") : "—"} />
      </div>

      {/* Org info */}
      {d && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Building2 className="h-4 w-4" />{d.organization.canonicalName}</CardTitle></CardHeader>
          <CardContent>
            <div className="text-sm space-y-1">
              <div className="flex gap-2 flex-wrap">
                <span className="text-muted-foreground">编号:</span>
                <span className="font-mono">{d.organization.orgCode}</span>
                {d.organization.taxId && <><span className="text-muted-foreground ml-3">税号:</span><span className="font-mono">{d.organization.taxId}</span></>}
              </div>
              {d.organization.address && <div><MapPin className="h-3 w-3 inline mr-1 text-muted-foreground" />{d.organization.address}</div>}
              {d.organization.aliases.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Tag className="h-3 w-3 text-muted-foreground" />
                  {d.organization.aliases.map((a) => <Badge key={a.id} variant="outline" className="text-xs">{a.alias}</Badge>)}
                </div>
              )}
              {d.organization.sites.length > 0 && (
                <div className="flex gap-1.5 flex-wrap mt-1">
                  {d.organization.sites.map((s) => (
                    <Badge key={s.id} variant="secondary" className="text-xs">{s.siteName}{s.siteType ? ` (${SITE_TYPE_LABELS[s.siteType] || s.siteType})` : ""}</Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Representative breakdown */}
      {d && d.representativeBreakdown.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">代表表现</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">代表</th>
                  <th className="text-right p-2 font-medium">客户数</th>
                  <th className="text-right p-2 font-medium">30天沟通</th>
                  <th className="text-right p-2 font-medium">30天签到</th>
                  <th className="text-left p-2 font-medium hidden sm:table-cell">最近签到</th>
                </tr>
              </thead>
              <tbody>
                {d.representativeBreakdown.map((r) => (
                  <tr key={r.representativeId} className="border-t">
                    <td className="p-2">
                      <Link href={`/crm/representatives/${r.representativeId}`} className="text-primary hover:underline">{r.name}</Link>
                    </td>
                    <td className="p-2 text-right">{r.profileCount}</td>
                    <td className="p-2 text-right">{r.interactionCount}</td>
                    <td className="p-2 text-right">{r.checkinCount}</td>
                    <td className="p-2 text-muted-foreground hidden sm:table-cell">{r.lastCheckinAt ? new Date(r.lastCheckinAt).toLocaleDateString("zh-CN") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Distributions */}
      {d && (
        <div className="grid sm:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">阶段分布</CardTitle></CardHeader>
            <CardContent>
              {Object.entries(d.distributions.stage).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(d.distributions.stage).map(([stage, count]) => (
                    <div key={stage} className="flex items-center justify-between text-sm">
                      <StageBadge stage={stage} />
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">重要度分布</CardTitle></CardHeader>
            <CardContent>
              {Object.entries(d.distributions.importance).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(d.distributions.importance).map(([imp, count]) => (
                    <div key={imp} className="flex items-center justify-between text-sm">
                      <ImportanceBadge importance={imp} />
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">人员分类</CardTitle></CardHeader>
            <CardContent>
              {Object.entries(d.distributions.personCategory).length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无</p>
              ) : (
                <div className="space-y-1.5">
                  {Object.entries(d.distributions.personCategory).map(([pc, count]) => (
                    <div key={pc} className="flex items-center justify-between text-sm">
                      <PersonCategoryBadge category={pc === "未设置" ? null : pc} />
                      <span className="font-medium">{count}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Customer list */}
      {d && d.customerSummary.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span>客户列表 <span className="text-sm text-muted-foreground font-normal">({d.organization.crmProfileCount})</span></span>
              <Link href={`/crm/customers?organizationId=${d.organization.id}&organizationName=${encodeURIComponent(d.organization.canonicalName)}`} className="inline-flex items-center gap-1 h-6 px-2 text-xs hover:bg-muted rounded-md"><Users className="h-3 w-3" />管理全部客户</Link>
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">客户</th>
                  <th className="text-left p-2 font-medium hidden md:table-cell">课题组</th>
                  <th className="text-left p-2 font-medium">阶段</th>
                  <th className="text-left p-2 font-medium hidden sm:table-cell">重要度</th>
                  <th className="text-left p-2 font-medium hidden lg:table-cell">分类</th>
                  <th className="text-left p-2 font-medium">负责人</th>
                </tr>
              </thead>
              <tbody>
                {d.customerSummary.slice(0, 20).map((c) => (
                  <tr key={c.customerId} className="border-t hover:bg-muted/30">
                    <td className="p-2">
                      <Link href={`/crm/customers/${c.customerId}`} className="text-primary hover:underline font-medium">{c.customerName}</Link>
                      <div className="text-xs text-muted-foreground">{c.customerCode}</div>
                    </td>
                    <td className="p-2 text-muted-foreground hidden md:table-cell">{c.labOrGroup || "—"}</td>
                    <td className="p-2"><StageBadge stage={c.stage} /></td>
                    <td className="p-2 hidden sm:table-cell"><ImportanceBadge importance={c.importance} /></td>
                    <td className="p-2 hidden lg:table-cell"><PersonCategoryBadge category={c.personCategory} /></td>
                    <td className="p-2">{c.ownerName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Recent interactions + checkins */}
      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">最近沟通</CardTitle></CardHeader>
          <CardContent>
            {!d?.recentInteractions.length ? (
              <p className="text-sm text-muted-foreground">暂无记录</p>
            ) : (
              <div className="space-y-3">
                {d.recentInteractions.slice(0, 20).map((i) => (
                  <div key={i.id} className="text-sm">
                    <span className="text-muted-foreground">{INTERACTION_TYPE_LABELS[i.type] || i.type}</span>
                    <span className="mx-1">·</span>
                    <span>{i.summary}</span>
                    <span className="mx-1">·</span>
                    <span>{i.profile.sourceCustomer.name}</span>
                    <span className="mx-1">·</span>
                    <span className="text-muted-foreground">{i.createdByUser.name}</span>
                    <span className="mx-1">·</span>
                    <span className="text-muted-foreground">{new Date(i.happenedAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-base">最近签到</CardTitle></CardHeader>
          <CardContent>
            {!d?.recentCheckins.length ? (
              <p className="text-sm text-muted-foreground">暂无记录</p>
            ) : (
              <div className="space-y-2">
                {d.recentCheckins.slice(0, 20).map((c) => (
                  <div key={c.id} className="text-sm flex justify-between">
                    <span>{c.summaryTitle || c.addressSnapshot || "未知位置"}</span>
                    <span className="text-muted-foreground">{c.user.name} · {new Date(c.createdAt).toLocaleDateString("zh-CN")}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="pt-4 pb-3 text-center">
        <p className="text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  );
}
