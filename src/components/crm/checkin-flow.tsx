"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { MapPin, Camera, Check, Loader2 } from "lucide-react";

interface CheckinFlowProps {
  profileId: string;
  sourceCustomerId?: string;
}

export function CheckinFlow({ profileId, sourceCustomerId }: CheckinFlowProps) {
  const [step, setStep] = useState<"idle" | "locating" | "located" | "uploading" | "done">("idle");
  const [checkinId, setCheckinId] = useState<string | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [photoCount, setPhotoCount] = useState(0);
  const queryClient = useQueryClient();

  const createCheckin = useMutation({
    mutationFn: async (geo: { lat: number; lng: number; accuracy: number } | null) => {
      const res = await fetch(`/api/crm/profiles/${profileId}/checkins`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geo || {}),
      });
      if (!res.ok) throw new Error("签到创建失败");
      return res.json();
    },
    onSuccess: (data) => {
      setCheckinId(data.checkin.id);
      setAddress(data.checkin.addressSnapshot);
      setStep("located");
    },
    onError: () => toast.error("签到创建失败"),
  });

  const completeCheckin = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/profiles/${profileId}/checkins/${checkinId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "完成签到失败");
      }
      return res.json();
    },
    onSuccess: async () => {
      toast.success("签到完成");
      setStep("done");
      const promises: Promise<void>[] = [
        queryClient.invalidateQueries({ queryKey: crmKeys.dashboard() }),
      ];
      if (sourceCustomerId) {
        promises.push(queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) }));
      }
      await Promise.all(promises);
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const startLocating = useCallback(() => {
    setStep("locating");
    if (!navigator.geolocation) {
      toast.error("浏览器不支持定位");
      createCheckin.mutate(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy };
        setLocation(geo);
        createCheckin.mutate(geo);
      },
      () => {
        toast.error("定位失败，可上传照片完成签到");
        createCheckin.mutate(null);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [createCheckin]);

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!checkinId || !e.target.files?.length) return;
    setStep("uploading");
    for (const file of Array.from(e.target.files)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("checkinId", checkinId);
      try {
        const res = await fetch("/api/crm/upload", { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json();
          toast.error(data.error || "上传失败");
        } else {
          setPhotoCount((c) => c + 1);
        }
      } catch {
        toast.error("上传失败");
      }
    }
    setStep("located");
  }, [checkinId]);

  if (step === "done") {
    return (
      <div className="flex items-center gap-2 text-green-600 text-sm">
        <Check className="h-4 w-4" />签到完成
      </div>
    );
  }

  if (step === "idle") {
    return (
      <Button onClick={startLocating} size="sm">
        <MapPin className="h-4 w-4 mr-1" />现场签到
      </Button>
    );
  }

  if (step === "locating" || createCheckin.isPending) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />正在定位...
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="text-sm">
        {location ? (
          <span className="text-green-600">定位成功{address ? `：${address}` : ""}</span>
        ) : (
          <span className="text-yellow-600">定位失败，请上传照片</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <label className="cursor-pointer">
          <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoUpload} />
          <span className="inline-flex items-center gap-1 rounded-md border px-3 py-1.5 text-sm hover:bg-accent">
            <Camera className="h-4 w-4" />
            {step === "uploading" ? "上传中..." : `拍照/上传${photoCount > 0 ? ` (${photoCount})` : ""}`}
          </span>
        </label>
        <Button
          size="sm"
          onClick={() => completeCheckin.mutate()}
          disabled={completeCheckin.isPending || (!location && photoCount === 0)}
        >
          {completeCheckin.isPending ? "提交中..." : "完成签到"}
        </Button>
      </div>
    </div>
  );
}
