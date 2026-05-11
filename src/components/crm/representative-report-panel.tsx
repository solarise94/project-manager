"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { crmKeys } from "@/lib/crm/query-keys";
import type { CrmRepresentativeReport } from "@/lib/crm/types";
import { StageBadge, ImportanceBadge, PersonCategoryBadge, GraduationStatusBadge } from "@/components/crm/badges";
import { toast } from "sonner";
import Link from "next/link";
import { Users, MapPin, ShoppingCart, MessageSquare, Loader2, Check } from "lucide-react";

interface Props {
  representativeId: string;
  readOnly?: boolean;
  period?: string;
}

/** Compute period key eg "2026-05-05" for this week's Monday */
function getWeekKey(): string {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function RepresentativeReportPanel({ representativeId, readOnly = false, period = "week" }: Props) {
  const queryClient = useQueryClient();
  const periodKey = getWeekKey();
  const [note, setNote] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const noteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noteLoadedRef = useRef(false);
  const noteRef = useRef(""); // track latest note for unmount flush
  const initialNoteRef = useRef(""); // note loaded from DB, for dirty check

  const { data, isLoading } = useQuery<CrmRepresentativeReport>({
    queryKey: crmKeys.representativeReport(representativeId, period),
    queryFn: () => fetch(`/api/crm/representatives/${representativeId}/report?period=${period}`).then((r) => r.json()),
  });

  // Load draft note once on data arrival
  useEffect(() => {
    if (data && !noteLoadedRef.current) {
      const text = data.draftNote || "";
      setNote(text);
      noteRef.current = text;
      initialNoteRef.current = text;
      noteLoadedRef.current = true;
    }
  }, [data]);

  // Reset loaded flag when rep changes
  useEffect(() => {
    noteLoadedRef.current = false;
  }, [representativeId]);

  const saveMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await fetch(`/api/crm/representatives/${representativeId}/report`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ periodType: "WEEK", periodKey, note: text }),
      });
      if (!res.ok) throw new Error("保存失败");
      return res.json();
    },
    onSuccess: () => {
      setSaveStatus("saved");
      queryClient.invalidateQueries({ queryKey: crmKeys.representativeReport(representativeId, period) });
    },
    onError: () => {
      setSaveStatus("error");
      toast.error("备注保存失败，内容仍在本地");
    },
  });

  const flushSave = useCallback(
    (text: string) => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      if (text !== initialNoteRef.current) {
        saveMutation.mutate(text);
      } else {
        setSaveStatus("idle");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [representativeId]
  );

  const debouncedSave = useCallback(
    (text: string) => {
      if (noteTimerRef.current) clearTimeout(noteTimerRef.current);
      setSaveStatus("saving");
      noteTimerRef.current = setTimeout(() => {
        saveMutation.mutate(text);
      }, 1500);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [representativeId]
  );

  // Cleanup: flush pending save on unmount using sendBeacon for reliable delivery
  useEffect(() => {
    return () => {
      if (noteTimerRef.current) {
        clearTimeout(noteTimerRef.current);
        if (noteRef.current !== initialNoteRef.current) {
          const body = JSON.stringify({ periodType: "WEEK", periodKey, note: noteRef.current });
          const blob = new Blob([body], { type: "application/json" });
          navigator.sendBeacon(`/api/crm/representatives/${representativeId}/report`, blob);
        }
      }
    };
  }, [representativeId, periodKey]);

  function handleNoteChange(value: string) {
    setNote(value);
    noteRef.current = value;
    if (!readOnly) {
      debouncedSave(value);
    }
  }

  function handleNoteBlur() {
    if (!readOnly) {
      flushSave(noteRef.current);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
        <Loader2 className="h-4 w-4 animate-spin" />
        加载周报...
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-muted-foreground py-8 text-center">暂无周报数据</div>;
  }

  const s = data.summary;
  const weekLabel = `${data.periodStart.slice(0, 10)} ~ ${data.periodEnd.slice(0, 10)}`;

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground">
        统计周期：{weekLabel}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MapPin className="h-4 w-4" />
              <span className="text-xs">本周签到</span>
            </div>
            <p className="text-2xl font-bold">{s.visitCheckinCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Users className="h-4 w-4" />
              <span className="text-xs">本周新增客户</span>
            </div>
            <p className="text-2xl font-bold">{s.newCustomerCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <ShoppingCart className="h-4 w-4" />
              <span className="text-xs">本周下单数</span>
            </div>
            <p className="text-2xl font-bold">{s.reservedOrderCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-3 pb-2 px-3">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <MessageSquare className="h-4 w-4" />
              <span className="text-xs">本周沟通客户</span>
            </div>
            <p className="text-2xl font-bold">{s.communicatedCustomerCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Note textarea */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">本周汇报备注</label>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            {saveStatus === "saving" && <><Loader2 className="h-3 w-3 animate-spin" />保存中...</>}
            {saveStatus === "saved" && <><Check className="h-3 w-3 text-green-500" />已保存</>}
            {saveStatus === "error" && <span className="text-red-500">保存失败</span>}
          </div>
        </div>
        <Textarea
          value={note}
          onChange={(e) => handleNoteChange(e.target.value)}
          onBlur={handleNoteBlur}
          placeholder="本周主要拜访客户、需求、下一步计划..."
          rows={4}
          readOnly={readOnly}
          className={readOnly ? "bg-muted" : ""}
        />
      </div>

      {/* Customer table */}
      <div>
        <h3 className="text-sm font-medium mb-2">本周客户 ({data.customers.length})</h3>
        {data.customers.length === 0 ? (
          <div className="text-sm text-muted-foreground py-4 text-center">本周暂无客户数据</div>
        ) : (
          <div className="border rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2 font-medium">客户</th>
                  <th className="text-left p-2 font-medium hidden md:table-cell">机构</th>
                  <th className="text-left p-2 font-medium hidden lg:table-cell">阶段</th>
                  <th className="text-left p-2 font-medium hidden lg:table-cell">重要度</th>
                  <th className="text-left p-2 font-medium hidden lg:table-cell">分类</th>
                  <th className="text-left p-2 font-medium hidden xl:table-cell">毕业状态</th>
                  <th className="text-center p-2 font-medium">拜访</th>
                  <th className="text-left p-2 font-medium hidden xl:table-cell">最近拜访</th>
                  <th className="text-left p-2 font-medium">需求摘要</th>
                  <th className="text-center p-2 font-medium">下单</th>
                </tr>
              </thead>
              <tbody>
                {data.customers.map((c) => (
                  <tr key={c.customerId} className="border-t hover:bg-muted/30">
                    <td className="p-2">
                      <Link href={`/crm/customers/${c.customerId}`} className="text-primary hover:underline text-sm">
                        {c.customerName}
                      </Link>
                      <div className="text-[11px] text-muted-foreground">{c.customerCode}</div>
                    </td>
                    <td className="p-2 hidden md:table-cell text-muted-foreground text-sm">{c.organization || "-"}</td>
                    <td className="p-2 hidden lg:table-cell"><StageBadge stage={c.stage} /></td>
                    <td className="p-2 hidden lg:table-cell"><ImportanceBadge importance={c.importance} /></td>
                    <td className="p-2 hidden lg:table-cell">{c.personCategory ? <PersonCategoryBadge category={c.personCategory} /> : "-"}</td>
                    <td className="p-2 hidden xl:table-cell">{c.graduationStatus ? <GraduationStatusBadge status={c.graduationStatus} /> : "-"}</td>
                    <td className="p-2 text-center text-sm">{c.weeklyVisitCount}</td>
                    <td className="p-2 hidden xl:table-cell text-sm text-muted-foreground">{c.lastVisitAt ? new Date(c.lastVisitAt).toLocaleDateString("zh-CN") : "—"}</td>
                    <td className="p-2 text-sm text-muted-foreground max-w-[200px] truncate">{c.latestDemand || "-"}</td>
                    <td className="p-2 text-center">{c.hasOrderThisWeek ? <Badge variant="default" className="text-xs">是</Badge> : <span className="text-muted-foreground">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
