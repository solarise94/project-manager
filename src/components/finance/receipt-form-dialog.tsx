"use client";

import { useState, useEffect, useMemo } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectDisplay, SelectItem, SelectTrigger,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";

interface ReceiptFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultOrderId?: string;
  defaultAmount?: number;
  receipt?: {
    id: string;
    amount: number;
    receivedAt: string;
    source: string;
    remark: string | null;
    orderId: string | null;
  } | null;
  onSuccess: () => void;
}

const SOURCE_LABELS: Record<string, string> = {
  MANUAL: "人工录入",
  BANK: "银行转账",
  PINGOODMICE_ORDER: "平台订单",
  OTHER: "其他",
};

export function ReceiptFormDialog({ open, onOpenChange, defaultOrderId, defaultAmount, receipt, onSuccess }: ReceiptFormDialogProps) {
  const isEdit = !!receipt;
  const effectiveOrderId = receipt?.orderId || defaultOrderId;

  const initialAmount = useMemo(() => {
    if (receipt) return String(receipt.amount);
    if (defaultAmount) return String(defaultAmount);
    return "";
  }, [receipt, defaultAmount]);

  const initialReceivedAt = useMemo(() => {
    if (receipt) return receipt.receivedAt.slice(0, 10);
    return new Date().toISOString().slice(0, 10);
  }, [receipt]);

  const initialSource = useMemo(() => {
    if (receipt) return receipt.source;
    return "MANUAL";
  }, [receipt]);

  const initialRemark = useMemo(() => {
    if (receipt) return receipt.remark || "";
    return "";
  }, [receipt]);

  const [amount, setAmount] = useState(initialAmount);
  const [receivedAt, setReceivedAt] = useState(initialReceivedAt);
  const [source, setSource] = useState(initialSource);
  const [remark, setRemark] = useState(initialRemark);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (open) {
        setAmount(initialAmount);
        setReceivedAt(initialReceivedAt);
        setSource(initialSource);
        setRemark(initialRemark);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, initialAmount, initialReceivedAt, initialSource, initialRemark]);

  async function handleSubmit() {
    if (!effectiveOrderId) {
      toast.error("请先从订单详情页进入");
      return;
    }
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("请输入有效的金额");
      return;
    }
    if (!receivedAt) {
      toast.error("请选择到款日期");
      return;
    }
    const receivedDate = new Date(receivedAt);
    if (Number.isNaN(receivedDate.getTime())) {
      toast.error("请选择有效的到款日期");
      return;
    }
    setSubmitting(true);
    try {
      let res: Response;
      const payload = {
        amount: amt,
        receivedAt: receivedDate.toISOString(),
        source,
        remark: remark || null,
      };
      if (isEdit && receipt) {
        res = await fetch(`/api/finance/receipts/${receipt.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/api/finance/receipts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, orderId: effectiveOrderId }),
        });
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || (isEdit ? "保存失败" : "创建失败"));
      }
      toast.success(isEdit ? "回款记录已更新" : "回款记录已创建");
      onSuccess();
      onOpenChange(false);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : (isEdit ? "保存失败" : "创建失败"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑回款" : "添加回款"}</DialogTitle>
        </DialogHeader>
        {!effectiveOrderId ? (
          <div className="text-sm text-muted-foreground py-4 text-center">
            请先从订单详情页进入，回款必须关联订单。
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>金额</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>到款日期</Label>
              <Input
                type="date"
                value={receivedAt}
                onChange={(e) => setReceivedAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>来源</Label>
              <Select value={source} onValueChange={(v) => v && setSource(v)}>
                <SelectTrigger><SelectDisplay label="来源" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="MANUAL">人工录入</SelectItem>
                  <SelectItem value="BANK">银行转账</SelectItem>
                  <SelectItem value="PINGOODMICE_ORDER">平台订单</SelectItem>
                  <SelectItem value="OTHER">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>备注</Label>
              <Input
                placeholder="备注信息（可选）"
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || !effectiveOrderId}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            {isEdit ? "保存修改" : "确认添加"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
