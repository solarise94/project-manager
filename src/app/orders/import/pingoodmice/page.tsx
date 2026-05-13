"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PingoodmiceImportPage() {
  const router = useRouter();
  useEffect(() => { router.replace("/orders/import?source=PINGOODMICE"); }, [router]);
  return null;
}
