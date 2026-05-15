import { prisma } from "@/lib/prisma";

export type PaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

export function computePaymentStatus(totalAmount: number, receiptTotal: number): PaymentStatus {
  if (receiptTotal <= 0) return "UNPAID";
  if (receiptTotal >= totalAmount) return "PAID";
  return "PARTIAL";
}

export async function computeInvoicePaymentStatus(
  invoiceId: string,
  type: "project" | "order",
): Promise<{ receiptTotal: number; paymentStatus: PaymentStatus }> {
  let receiptTotal = 0;

  if (type === "project") {
    const receipts = await prisma.financeReceipt.findMany({
      where: { projectInvoiceId: invoiceId, deleted: false },
      select: { amount: true },
    });
    receiptTotal = receipts.reduce((sum, r) => sum + r.amount, 0);

    const invoice = await prisma.projectInvoice.findUnique({
      where: { id: invoiceId },
      select: { totalAmount: true },
    });
    return { receiptTotal, paymentStatus: computePaymentStatus(invoice?.totalAmount ?? 0, receiptTotal) };
  }

  const receipts = await prisma.financeReceipt.findMany({
    where: { externalOrderInvoiceRequestId: invoiceId, deleted: false },
    select: { amount: true },
  });
  receiptTotal = receipts.reduce((sum, r) => sum + r.amount, 0);

  const invoice = await prisma.externalOrderInvoiceRequest.findUnique({
    where: { id: invoiceId },
    select: { totalAmount: true },
  });
  return { receiptTotal, paymentStatus: computePaymentStatus(invoice?.totalAmount ?? 0, receiptTotal) };
}
