"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { RelationGraph } from "@/components/crm/relation-graph";
import { CRM_STAGES, STAGE_LABELS, CRM_RELATION_TYPES, RELATION_TYPE_LABELS } from "@/lib/crm/constants";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRelationItem, CrmCustomerProfileItem } from "@/lib/crm/types";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function CrmGraphPage() {
  const { status } = useSession();
  const router = useRouter();

  if (status === "unauthenticated") { router.push("/login"); return null; }
  if (status === "loading") return <div className="p-6">加载中...</div>;

  return <GraphView />;
}

function GraphView() {
  const [stageFilter, setStageFilter] = useState("ALL");
  const [typeFilters, setTypeFilters] = useState<Set<string>>(new Set(CRM_RELATION_TYPES));

  const { data: relData, isLoading: relLoading } = useQuery<{ relations: CrmRelationItem[] }>({
    queryKey: crmKeys.relationsAll(),
    queryFn: () => fetch("/api/crm/relations").then((r) => r.json()),
  });

  const { data: profData, isLoading: profLoading } = useQuery<{ profiles: CrmCustomerProfileItem[] }>({
    queryKey: crmKeys.profiles(),
    queryFn: () => fetch("/api/crm/profiles").then((r) => r.json()),
  });

  const isLoading = relLoading || profLoading;
  const allRelations = relData?.relations || [];
  const profiles = profData?.profiles || [];

  const profileStages = new Map<string, string>();
  const profileSourceMap = new Map<string, string>();
  for (const p of profiles) {
    profileStages.set(p.sourceCustomer.id, p.stage);
    profileSourceMap.set(p.sourceCustomer.id, p.sourceCustomerId);
  }

  const filtered = allRelations.filter((r) => {
    if (!typeFilters.has(r.type)) return false;
    if (stageFilter !== "ALL") {
      const fromStage = profileStages.get(r.fromCustomerId);
      const toStage = profileStages.get(r.toCustomerId);
      if (fromStage !== stageFilter && toStage !== stageFilter) return false;
    }
    return true;
  });

  const toggleType = (type: string) => {
    setTypeFilters((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <div className="flex items-center gap-3 p-4 border-b flex-wrap">
        <Link href="/crm">
          <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <h1 className="text-lg font-bold">关系图谱</h1>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <Select value={stageFilter} onValueChange={(v) => setStageFilter(v || "ALL")}>
            <SelectTrigger className="w-[120px] h-8 text-xs"><SelectValue placeholder="阶段" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">全部阶段</SelectItem>
              {CRM_STAGES.map((s) => (
                <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex items-center gap-2 flex-wrap">
            {CRM_RELATION_TYPES.map((t) => (
              <label key={t} className="flex items-center gap-1 text-xs cursor-pointer">
                <Checkbox checked={typeFilters.has(t)} onCheckedChange={() => toggleType(t)} className="h-3.5 w-3.5" />
                {RELATION_TYPE_LABELS[t]}
              </label>
            ))}
          </div>
        </div>
      </div>
      <div className="flex-1 relative">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">加载中...</div>
        ) : filtered.length === 0 ? (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">暂无关系数据</div>
        ) : (
          <RelationGraph relations={filtered} profileStages={profileStages} profileSourceMap={profileSourceMap} />
        )}
      </div>
    </div>
  );
}
