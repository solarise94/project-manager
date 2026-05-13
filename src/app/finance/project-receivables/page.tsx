"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function ProjectReceivablesRedirect() {
  const router = useRouter();
  useEffect(() => { router.replace("/finance/order-receivables"); }, [router]);
  return null;
}
