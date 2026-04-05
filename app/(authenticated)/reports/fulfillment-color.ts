export function getFulfillmentStyle(pct: number): React.CSSProperties {
  if (pct >= 1) {
    return { color: "var(--color-ok)" };
  }

  if (pct >= 0.8) {
    return { color: "var(--color-warn)" };
  }

  return { color: "var(--color-error)" };
}
