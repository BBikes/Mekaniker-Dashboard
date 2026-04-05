"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

type DashboardRefreshProps = {
  initialRefreshToken: string | null;
  pollMs?: number;
};

type DashboardStatusResponse = {
  latestSync: {
    refreshToken: string | null;
  } | null;
};

export function DashboardRefresh({ initialRefreshToken, pollMs = 30000 }: DashboardRefreshProps) {
  const router = useRouter();
  const latestTokenRef = useRef<string | null>(initialRefreshToken);

  useEffect(() => {
    latestTokenRef.current = initialRefreshToken;
  }, [initialRefreshToken]);

  useEffect(() => {
    let cancelled = false;

    async function checkForFreshSync() {
      try {
        const response = await fetch("/api/dashboard/status", {
          method: "GET",
          cache: "no-store",
          headers: {
            Accept: "application/json",
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as DashboardStatusResponse;
        const nextToken = payload.latestSync?.refreshToken ?? null;

        if (cancelled || !nextToken) {
          return;
        }

        if (latestTokenRef.current !== nextToken) {
          latestTokenRef.current = nextToken;
          router.refresh();
        }
      } catch {
        // Silent on TV-dashboard polling failures; the next poll can recover.
      }
    }

    const interval = window.setInterval(checkForFreshSync, pollMs);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollMs, router]);

  return null;
}
