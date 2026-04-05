import type { CSSProperties } from "react";

type RgbColor = [number, number, number];

const RED: RgbColor = [180, 35, 24];
const YELLOW: RgbColor = [234, 179, 8];
const GREEN: RgbColor = [21, 128, 61];

function clampRatio(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(Math.max(value, 0), 1);
}

function mixChannel(start: number, end: number, ratio: number) {
  return Math.round(start + (end - start) * ratio);
}

function mixColor(start: RgbColor, end: RgbColor, ratio: number): RgbColor {
  return [
    mixChannel(start[0], end[0], ratio),
    mixChannel(start[1], end[1], ratio),
    mixChannel(start[2], end[2], ratio),
  ];
}

export function getFulfillmentColor(ratio: number) {
  const clamped = clampRatio(ratio);

  if (clamped <= 0.7) {
    const relativeRatio = clamped / 0.7;
    const [r, g, b] = mixColor(RED, YELLOW, relativeRatio);
    return `rgb(${r}, ${g}, ${b})`;
  }

  const relativeRatio = (clamped - 0.7) / 0.3;
  const [r, g, b] = mixColor(YELLOW, GREEN, relativeRatio);
  return `rgb(${r}, ${g}, ${b})`;
}

export function getFulfillmentStyle(ratio: number): CSSProperties {
  return {
    color: getFulfillmentColor(ratio),
  };
}
