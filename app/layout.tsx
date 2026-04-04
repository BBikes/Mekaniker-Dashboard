import type { Metadata } from "next";

import { getOptionalEnv } from "@/lib/env";

import "./globals.css";

export const metadata: Metadata = {
  title: getOptionalEnv("NEXT_PUBLIC_APP_TITLE", "B-Bikes Workshop Stats"),
  description: "Internal workshop production statistics for B-Bikes",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
