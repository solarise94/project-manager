"use client";

import { useState } from "react";
import { Search, Loader2, Check, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

interface OrgCandidate {
  organizationId: string;
  organizationSiteId: string | null;
  canonicalName: string;
  siteName: string | null;
  address: string | null;
  confidence: number;
  source: "db";
}

interface ResolveResponse {
  status: "exact" | "candidate" | "unmatched";
  organizationId: string | null;
  organizationSiteId: string | null;
  canonicalName: string | null;
  siteName: string | null;
  address: string | null;
  candidates: OrgCandidate[];
  source: "db" | "none";
}

export interface OrgMatchSelection {
  organizationId: string | null;
  organizationSiteId: string | null;
  canonicalName: string;
  siteName: string | null;
  address: string | null;
  rawInput: string;
}

interface OrgSearchFieldProps {
  orgValue: string;
  onOrgChange: (org: string) => void;
  onMatch: (selection: OrgMatchSelection) => void;
}

export function OrgSearchField({ orgValue, onOrgChange, onMatch }: OrgSearchFieldProps) {
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<OrgCandidate[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [searchedQuery, setSearchedQuery] = useState("");
  const [lastStatus, setLastStatus] = useState<string>("");

  const resultsStale = orgValue.trim() !== searchedQuery;

  async function handleSearch() {
    if (!orgValue.trim()) {
      toast.error("请先输入单位名称");
      return;
    }

    const query = orgValue.trim();
    setSearching(true);
    setCandidates([]);
    setShowResults(false);
    setSearchedQuery(query);
    setLastStatus("");

    try {
      const res = await fetch("/api/customers/org-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const data: ResolveResponse & { error?: string } = await res.json();

      if (!res.ok) {
        toast.error(data.error || "搜索失败");
        return;
      }

      setLastStatus(data.status);

      if (data.status === "exact") {
        onMatch({
          organizationId: data.organizationId,
          organizationSiteId: data.organizationSiteId,
          canonicalName: data.canonicalName || query,
          siteName: data.siteName,
          address: data.address || "",
          rawInput: query,
        });
        const label = data.siteName
          ? `${data.canonicalName} (${data.siteName})`
          : data.canonicalName;
        toast.success(`已匹配: ${label}`);
      } else if (data.status === "candidate" && data.candidates.length > 0) {
        setCandidates(data.candidates);
        setShowResults(true);
      } else {
        toast.info("未在主数据中找到匹配的机构，请手动输入或联系管理员添加");
      }
    } catch {
      toast.error("网络错误");
    } finally {
      setSearching(false);
    }
  }

  function selectCandidate(c: OrgCandidate) {
    onMatch({
      organizationId: c.organizationId,
      organizationSiteId: c.organizationSiteId,
      canonicalName: c.canonicalName,
      siteName: c.siteName,
      address: c.address || "",
      rawInput: searchedQuery,
    });
    setShowResults(false);
    const label = c.siteName ? `${c.canonicalName} (${c.siteName})` : c.canonicalName;
    toast.success(`已选择: ${label}`);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={orgValue}
          onChange={(e) => onOrgChange(e.target.value)}
          placeholder="输入单位名称"
          className="flex-1"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 gap-1"
          disabled={searching || !orgValue.trim()}
          onClick={handleSearch}
        >
          {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          匹配主数据
        </Button>
      </div>

      {lastStatus === "exact" && !resultsStale && (
        <div className="flex items-center gap-1.5 text-xs text-green-600">
          <Check className="h-3.5 w-3.5" />
          已精确匹配到主数据
        </div>
      )}

      {showResults && !resultsStale && candidates.length > 0 && (
        <div className="rounded-md border bg-card shadow-sm">
          <div className="px-3 py-2 text-xs text-muted-foreground border-b flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" />
            找到 {candidates.length} 个候选机构（点击选择）
          </div>
          {candidates.map((c, i) => (
            <button
              key={i}
              type="button"
              className="w-full text-left px-3 py-2 hover:bg-muted/50 flex items-start gap-2 border-b last:border-b-0 transition-colors"
              onClick={() => selectCandidate(c)}
            >
              <Check className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  {c.canonicalName}
                  {c.siteName && <Badge variant="outline" className="text-[10px] px-1.5 py-0">{c.siteName}</Badge>}
                </div>
                {c.address && <div className="text-xs text-muted-foreground truncate">{c.address}</div>}
                <div className="text-xs text-muted-foreground">
                  置信度: {Math.round(c.confidence * 100)}%
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {lastStatus === "unmatched" && !resultsStale && (
        <div className="text-xs text-muted-foreground">
          未找到匹配机构。可以继续手动输入，或联系管理员在主数据中添加。
        </div>
      )}
    </div>
  );
}
