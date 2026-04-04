import type { Metadata } from "next";

import { getOptionalEnv } from "@/lib/env";

import "./globals.css";

export const metadata: Metadata = {
  title: getOptionalEnv("NEXT_PUBLIC_APP_TITLE", "B-Bikes Mekaniker Dashboard"),
  description: "Intern statistik for B-Bikes værksted",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="da">
      <body>{children}</body>
    </html>
  );
}
