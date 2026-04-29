"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger } from "@/components/ui/select";
import { RelationTypeBadge } from "@/components/crm/badges";
import { CRM_RELATION_TYPES, RELATION_TYPE_LABELS, RELATION_STRENGTH_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRelationItem } from "@/lib/crm/types";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useState } from "react";

export default function CrmRelationsPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <RelationsList />;
}

function RelationsList() {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: [...crmKeys.relationsAll(), search, typeFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (typeFilter) params.set("type", typeFilter);
      const res = await fetch(`/api/crm/relations?${params}`);
      return res.json();
    },
  });

  const relations: CrmRelationItem[] = data?.relations || [];

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/crm">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-2xl font-bold">关系网络</h1>
      </div>

      <div className="flex gap-3 flex-wrap">
        <Input
          placeholder="搜索客户名/编号/单位..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v === "ALL" ? "" : (v || ""))}>
          <SelectTrigger className="w-40"><SelectDisplay label="类型" valueLabel={!typeFilter || typeFilter === "ALL" ? "全部类型" : RELATION_TYPE_LABELS[typeFilter] || "未知"} placeholder="全部类型" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部类型</SelectItem>
            {CRM_RELATION_TYPES.map((t) => (
              <SelectItem key={t} value={t}>{RELATION_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">加载中...</p>
      ) : relations.length === 0 ? (
        <p className="text-sm text-muted-foreground">暂无关系记录</p>
      ) : (
        <div className="space-y-2">
          {relations.map((r) => (
            <Card key={r.id}>
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/crm/customers/${r.fromCustomerId}`} className="text-sm font-medium text-primary hover:underline">
                    {r.fromCustomer.name}
                  </Link>
                  <span className="text-muted-foreground mx-1">→</span>
                  <Link href={`/crm/customers/${r.toCustomerId}`} className="text-sm font-medium text-primary hover:underline">
                    {r.toCustomer.name}
                  </Link>
                  <RelationTypeBadge type={r.type} />
                  {r.strength && (
                    <span className="text-xs bg-muted px-1.5 py-0.5 rounded">{RELATION_STRENGTH_LABELS[r.strength] || r.strength}</span>
                  )}
                  <span className="text-xs text-muted-foreground ml-auto">
                    {r.createdByUser.name} · {new Date(r.createdAt).toLocaleDateString("zh-CN")}
                  </span>
                </div>
                {r.notes && <p className="text-xs text-muted-foreground mt-1">{r.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}