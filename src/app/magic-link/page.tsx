"use client";

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { Loader2, FlaskConical } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type VerifyState = { status: "loading" | "success" | "error"; message: string };

function MagicLinkContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get("token");
  const redirect = searchParams.get("redirect") || "/dashboard";
  const initialState: VerifyState = token
    ? { status: "loading", message: "正在验证登录链接..." }
    : { status: "error", message: "无效的登录链接，缺少 token" };
  const [state, setState] = useState<VerifyState>(initialState);

  const verify = useCallback(async (t: string, r: string) => {
    const result = await signIn("representative", {
      token: t,
      redirect: false,
      callbackUrl: r,
    });

    if (result?.error) {
      const message = result.error === "ARCHIVED"
        ? "该代表账号已归档，无法登录。请联系管理员恢复账号。"
        : "登录链接已过期或无效，请重新获取 Magic Link";
      return { status: "error" as const, message };
    }

    const safeUrl = r.startsWith("/") ? r : "/dashboard";
    window.location.assign(safeUrl);
    return { status: "success" as const, message: "登录成功，正在跳转..." };
  }, []);

  useEffect(() => {
    if (!token) return;

    let cancelled = false;
    verify(token, redirect).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => { cancelled = true; };
  }, [token, redirect, verify]);

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-muted/30">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary">
            <FlaskConical className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">SciManage</CardTitle>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          {state.status === "loading" && (
            <div className="flex flex-col items-center gap-3">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-muted-foreground">{state.message}</p>
            </div>
          )}
          {state.status === "success" && (
            <div className="space-y-2">
              <p className="text-green-600 font-medium">登录成功</p>
              <p className="text-muted-foreground text-sm">{state.message}</p>
            </div>
          )}
          {state.status === "error" && (
            <div className="space-y-2">
              <p className="text-red-600 font-medium">登录失败</p>
              <p className="text-muted-foreground text-sm">{state.message}</p>
              <button
                onClick={() => router.push("/login/representative")}
                className="text-primary text-sm hover:underline mt-2"
              >
                前往代表登录页重新获取链接
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function MagicLinkPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center px-4 py-12 bg-muted/30">
        <Card className="w-full max-w-sm">
          <CardContent className="p-8 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
            <p className="text-muted-foreground mt-3">加载中...</p>
          </CardContent>
        </Card>
      </div>
    }>
      <MagicLinkContent />
    </Suspense>
  );
}
