"use client";

import { useEffect, useRef, useState } from "react";

import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type OfferStatus = "accepted" | "accepted_partial" | "rejected";

type OfferNotification = {
  id: string;
  customer_name: string | null;
  mechanic_name: string | null;
  work_order_id: string | null;
  total_amount: number | null;
  status: OfferStatus;
};

const DISMISS_AFTER_MS = 20_000;

function playPling() {
  try {
    const ctx = new AudioContext();
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, ctx.currentTime);
    oscillator.frequency.exponentialRampToValueAtTime(660, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + 0.6);
    oscillator.onended = () => ctx.close();
  } catch {
    // AudioContext not available (e.g. SSR guard)
  }
}

const STATUS_CONFIG: Record<
  OfferStatus,
  { label: string; accentColor: string; bgColor: string; borderColor: string }
> = {
  accepted: {
    label: "Accepterede tilbud",
    accentColor: "#86efac",
    bgColor: "rgba(20, 50, 25, 0.97)",
    borderColor: "rgba(134, 239, 172, 0.5)",
  },
  accepted_partial: {
    label: "Accepterede tilbud (delvist)",
    accentColor: "#fde047",
    bgColor: "rgba(45, 40, 5, 0.97)",
    borderColor: "rgba(253, 224, 71, 0.5)",
  },
  rejected: {
    label: "Afviste tilbud",
    accentColor: "#fca5a5",
    bgColor: "rgba(50, 15, 15, 0.97)",
    borderColor: "rgba(252, 165, 165, 0.5)",
  },
};

function formatAmount(amount: number | null): string | null {
  if (amount === null || amount <= 0) return null;
  return amount.toLocaleString("da-DK", { maximumFractionDigits: 0 }) + " kr.";
}

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: OfferNotification;
  onDismiss: (id: string) => void;
}) {
  const config = STATUS_CONFIG[notification.status];
  const amountLabel = formatAmount(notification.total_amount);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        padding: "16px 18px",
        borderRadius: "10px",
        background: config.bgColor,
        border: `1px solid ${config.borderColor}`,
        boxShadow: "0 4px 24px rgba(0,0,0,0.5)",
        minWidth: "280px",
        maxWidth: "360px",
        position: "relative",
      }}
    >
      <button
        onClick={() => onDismiss(notification.id)}
        aria-label="Luk notifikation"
        style={{
          position: "absolute",
          top: "10px",
          right: "12px",
          background: "none",
          border: "none",
          color: "rgba(255,255,255,0.4)",
          cursor: "pointer",
          fontSize: "16px",
          lineHeight: 1,
          padding: "2px 4px",
        }}
      >
        ✕
      </button>

      <p
        style={{
          margin: 0,
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: config.accentColor,
        }}
      >
        {config.label}
      </p>

      <p
        style={{
          margin: 0,
          fontSize: "18px",
          fontWeight: 700,
          color: "#f1f5f9",
          paddingRight: "20px",
        }}
      >
        {notification.mechanic_name ?? "Ukendt mekaniker"}
      </p>

      {notification.work_order_id && (
        <p
          style={{
            margin: 0,
            fontSize: "18px",
            fontWeight: 700,
            color: "rgba(255,255,255,0.55)",
          }}
        >
          #{notification.work_order_id}
        </p>
      )}

      <div
        style={{
          display: "flex",
          gap: "12px",
          flexWrap: "wrap",
          marginTop: "2px",
        }}
      >
        {amountLabel && (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 600,
              color: config.accentColor,
            }}
          >
            {amountLabel}
          </span>
        )}
      </div>
    </div>
  );
}

export function OfferNotifier() {
  const [notifications, setNotifications] = useState<OfferNotification[]>([]);
  const seenIds = useRef<Set<string>>(new Set());

  const dismiss = (id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  };

  useEffect(() => {
    const supabase = createSupabaseBrowserClient();

    const channel = supabase
      .channel("offer-response-notifications")
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "offers",
        },
        (payload) => {
          const row = payload.new as {
            id: string;
            status: string;
            customer_name: string | null;
            mechanic_name: string | null;
            work_order_id: string | null;
            total_amount: number | null;
          };

          const isResponseStatus =
            row.status === "accepted" ||
            row.status === "accepted_partial" ||
            row.status === "rejected";

          if (!isResponseStatus) return;
          if (seenIds.current.has(row.id)) return;

          seenIds.current.add(row.id);
          playPling();

          const notification: OfferNotification = {
            id: row.id,
            customer_name: row.customer_name,
            mechanic_name: row.mechanic_name,
            work_order_id: row.work_order_id,
            total_amount: row.total_amount,
            status: row.status as OfferStatus,
          };

          setNotifications((prev) => [...prev, notification]);

          window.setTimeout(() => {
            setNotifications((prev) => prev.filter((n) => n.id !== row.id));
          }, DISMISS_AFTER_MS);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  if (notifications.length === 0) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        top: "24px",
        right: "24px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "12px",
        pointerEvents: "auto",
      }}
    >
      {notifications.map((n) => (
        <NotificationCard key={n.id} notification={n} onDismiss={dismiss} />
      ))}
    </div>
  );
}
