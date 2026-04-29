"use client";

import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { crmKeys } from "@/lib/crm/query-keys";
import { toast } from "sonner";
import { MapPin, Camera, Check, Loader2, Mic, MicOff } from "lucide-react";

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

  // Voice recording state
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "uploading" | "transcribing" | "done" | "failed">("idle");
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const voiceMimeRef = useRef<string>("audio/webm");

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
      const body: Record<string, unknown> = { status: "COMPLETED" };
      if (voiceUrl) body.voiceUrl = voiceUrl;
      const res = await fetch(`/api/crm/profiles/${profileId}/checkins/${checkinId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
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

  const patchVoiceUrl = useMutation({
    mutationFn: async (url: string) => {
      const res = await fetch(`/api/crm/profiles/${profileId}/checkins/${checkinId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ voiceUrl: url }),
      });
      if (!res.ok) throw new Error("保存录音地址失败");
      return res.json();
    },
    onError: () => toast.error("保存录音地址失败"),
  });

  const asrMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/checkins/${checkinId}/asr`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "语音识别失败");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setTranscript(data.text);
      setVoiceState("done");
      toast.success("语音识别完成");
      // Auto-trigger summarization
      if (data.text) summarizeMutation.mutate();
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setVoiceState("failed");
    },
  });

  const summarizeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/crm/checkins/${checkinId}/summarize`, { method: "POST" });
      if (!res.ok) return null; // Non-blocking
      return res.json();
    },
    onSuccess: (data) => {
      if (data?.title) {
        toast.success("已生成摘要");
        if (sourceCustomerId) {
          queryClient.invalidateQueries({ queryKey: crmKeys.profileByCustomer(sourceCustomerId) });
        }
      }
    },
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
        toast.error("定位失败，可上传照片或录音完成签到");
        createCheckin.mutate(null);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }, [createCheckin]);

  const startRecording = useCallback(async () => {
    if (!checkinId) return;
    if (typeof MediaRecorder === "undefined") {
      toast.error("当前浏览器不支持录音");
      return;
    }
    // Negotiate mime type
    const tryTypes = ["audio/ogg;codecs=opus", "audio/ogg", "audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
    let mimeType = "audio/webm";
    for (const t of tryTypes) {
      if (MediaRecorder.isTypeSupported(t)) { mimeType = t; break; }
    }
    voiceMimeRef.current = mimeType;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (chunksRef.current.length === 0) return;
        setVoiceState("uploading");
        const blob = new Blob(chunksRef.current, { type: mimeType });
        try {
          const formData = new FormData();
          formData.append("file", blob, `voice_${Date.now()}.${mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "m4a" : "webm"}`);
          formData.append("checkinId", checkinId);
          const res = await fetch("/api/crm/upload", { method: "POST", body: formData });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.error || "上传失败");
          }
          const uploadData = await res.json();
          const url = uploadData.media.url as string;
          setVoiceUrl(url);
          // Persist voiceUrl to DB first so ASR can read it
          await patchVoiceUrl.mutateAsync(url);
          // Now trigger ASR
          setVoiceState("transcribing");
          asrMutation.mutate();
        } catch (err) {
          toast.error(err instanceof Error ? err.message : "录音上传失败");
          setVoiceState("idle");
        }
      };
      recorder.start(250);
      setVoiceState("recording");
    } catch {
      toast.error("无法访问麦克风");
    }
  }, [checkinId, asrMutation, patchVoiceUrl]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

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
          <span className="text-yellow-600">定位失败，请上传照片或录音</span>
        )}
      </div>

      {/* Voice recording row */}
      <div className="flex items-center gap-2">
        {voiceState === "idle" && (
          <Button size="sm" variant="outline" onClick={startRecording}>
            <Mic className="h-4 w-4 mr-1" />录音
          </Button>
        )}
        {voiceState === "recording" && (
          <Button size="sm" variant="destructive" onClick={stopRecording}>
            <MicOff className="h-4 w-4 mr-1" />停止录音
          </Button>
        )}
        {voiceState === "uploading" && (
          <span className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 inline animate-spin mr-1" />上传中...</span>
        )}
        {voiceState === "transcribing" && (
          <span className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 inline animate-spin mr-1" />识别中...</span>
        )}
        {voiceState === "done" && (
          <span className="text-xs text-green-600"><Check className="h-3 w-3 inline mr-1" />识别完成</span>
        )}
        {voiceState === "failed" && (
          <>
            <span className="text-xs text-red-500">识别失败</span>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => { setVoiceState("transcribing"); asrMutation.mutate(); }}>重试</Button>
          </>
        )}
      </div>
      {transcript && (
        <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2 max-h-20 overflow-y-auto">{transcript}</p>
      )}

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
          disabled={completeCheckin.isPending || (!location && photoCount === 0 && !voiceUrl)}
        >
          {completeCheckin.isPending ? "提交中..." : "完成签到"}
        </Button>
      </div>
    </div>
  );
}
