"use client";

import { useState, useEffect } from "react";
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
  defaultCustomerId?: string;
  defaultProjectId?: string;
  defaultProjectInvoiceId?: string;
  defaultOrderId?: string;
  defaultAmount?: number;
  onCreated: () => void;
}

export function ReceiptFormDialog({ open, onOpenChange, defaultCustomerId, defaultProjectId, defaultProjectInvoiceId, defaultOrderId, defaultAmount, onCreated }: ReceiptFormDialogProps) {
  const [amount, setAmount] = useState("");
  const [receivedAt, setReceivedAt] = useState(new Date().toISOString().slice(0, 10));
  const [source, setSource] = useState("MANUAL");
  const [remark, setRemark] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Prefill or reset amount when dialog opens/closes
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      if (open && defaultAmount) {
        setAmount(String(defaultAmount));
      } else if (!open) {
        setAmount("");
        setRemark("");
      } else {
        setAmount("");
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [open, defaultAmount]);

  async function handleSubmit() {
    const amt = parseFloat(amount);
    if (!amt || amt <= 0) {
      toast.error("请输入有效的金额");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/finance/receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          receivedAt: new Date(receivedAt).toISOString(),
          source,
          remark: remark || null,
          customerId: defaultCustomerId || null,
          projectId: defaultProjectId || null,
          projectInvoiceId: defaultProjectInvoiceId || null,
          orderId: defaultOrderId || null,
        }),
      });
      if (!res.ok) throw new Error("创建失败");
      toast.success("回款记录已创建");
      onCreated();
      onOpenChange(false);
      setAmount("");
      setRemark("");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "创建失败");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>添加回款</DialogTitle>
        </DialogHeader>
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
                <SelectItem value="PINGOODMICE_ORDER">拼好鼠订单</SelectItem>
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
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            确认添加
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
