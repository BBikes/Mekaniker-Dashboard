"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function DashboardRefresh({ intervalMs = 60000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const interval = window.setInterval(() => {
      router.refresh();
    }, intervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [intervalMs, router]);

  return null;
}
