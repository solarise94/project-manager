import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { isRepresentative } from "@/lib/permissions";
import { isMinimaxConfigured } from "@/lib/minimax";

const TAVILY_API_KEY = process.env.TAVILY_API_KEY || "";
const MINIMAX_API_KEY = process.env.MINIMAX_API_KEY || "";
const MINIMAX_BASE_URL = process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1";
const MINIMAX_MODEL = process.env.MINIMAX_MODEL || "MiniMax-M2.7";

const USCC_REGEX = /[0-9A-Z]{2}[0-9]{6}[0-9A-Z]{10}/g;

interface TaxIdCandidate {
  name: string;
  taxId: string;
  confidence: number;
  source: string;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (isRepresentative(session.user.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!TAVILY_API_KEY && !isMinimaxConfigured()) {
    return NextResponse.json({ error: "查询服务未配置" }, { status: 503 });
  }

  const body = await req.json();
  const { query } = body as { query?: string };
  if (!query?.trim()) {
    return NextResponse.json({ error: "请输入机构名称" }, { status: 400 });
  }

  const q = query.trim();

  try {
    // Strategy 1: Tavily search + regex extraction (preferred)
    if (TAVILY_API_KEY) {
      const candidates = await searchTavilyForTaxId(q);
      if (candidates.length > 0) {
        return NextResponse.json({ candidates });
      }
    }

    // Strategy 2: MiniMax LLM fallback
    if (isMinimaxConfigured()) {
      const candidates = await queryMinimaxForTaxId(q);
      return NextResponse.json({ candidates });
    }

    return NextResponse.json({ candidates: [] });
  } catch (err) {
    console.error("Tax ID lookup error:", err);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}

async function searchTavilyForTaxId(query: string): Promise<TaxIdCandidate[]> {
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query: `"${query}" 统一社会信用代码`,
      max_results: 5,
      search_depth: "basic",
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!res.ok) {
    console.error("Tavily tax-id search error:", res.status);
    return [];
  }

  const data = await res.json();
  const results = (data.results || []) as Array<{
    title: string;
    url: string;
    content: string;
  }>;

  const seen = new Set<string>();
  const candidates: TaxIdCandidate[] = [];

  for (const r of results) {
    const text = `${r.title} ${r.content}`;
    const matches = text.match(USCC_REGEX) || [];
    for (const m of matches) {
      if (m.length === 18 && !seen.has(m)) {
        seen.add(m);
        candidates.push({
          name: query,
          taxId: m,
          confidence: 0.8,
          source: new URL(r.url).hostname,
        });
      }
    }
    if (candidates.length >= 3) break;
  }

  return candidates.slice(0, 3);
}

const MINIMAX_SYSTEM_PROMPT = `你是一个中国企业/机构税号查询助手。用户会输入一个机构名称，你需要根据你的知识返回该机构的统一社会信用代码（纳税人识别号）。

严格按以下 JSON 格式返回，不要包含其他文字：
[{"name":"机构全称","taxId":"统一社会信用代码","confidence":0.9,"source":"知识库"}]

规则：
- taxId 是 18 位统一社会信用代码，格式如 91110000MA01XXXXXX
- 如果不确定，confidence 应低于 0.5
- 最多返回 3 个候选
- 如果完全不知道，返回空数组 []
- source 填写信息来源描述
- 不要编造税号，如果不确定就不要返回`;

async function queryMinimaxForTaxId(query: string): Promise<TaxIdCandidate[]> {
  const res = await fetch(`${MINIMAX_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${MINIMAX_API_KEY}`,
    },
    body: JSON.stringify({
      model: MINIMAX_MODEL,
      messages: [
        { role: "system", content: MINIMAX_SYSTEM_PROMPT },
        { role: "user", content: query },
      ],
      temperature: 0.1,
      max_tokens: 512,
    }),
  });

  if (!res.ok) {
    console.error("MiniMax tax-id lookup error:", res.status);
    return [];
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "[]";
  let jsonStr = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  jsonStr = jsonStr.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(jsonStr);
    return (Array.isArray(parsed) ? parsed : [])
      .filter((c: TaxIdCandidate) => c.taxId?.trim() && /^[0-9A-Z]{18}$/.test(c.taxId.trim()))
      .slice(0, 3)
      .map((c: TaxIdCandidate) => ({
        name: c.name || query,
        taxId: c.taxId.trim(),
        confidence: Math.min(1, Math.max(0, c.confidence || 0)),
        source: c.source || "AI",
      }));
  } catch {
    console.error("Failed to parse MiniMax tax-id response:", content);
    return [];
  }
}
